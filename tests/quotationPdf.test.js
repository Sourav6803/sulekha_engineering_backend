// tests/quotationPdf.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildQuotationHTML,
  formatDocumentDate,
  renderQuotationPdf,
  renderQuotationHtml,
  countPdfPages,
  PAGE_CONTENT_HEIGHT_PX,
  FONT_STEPS,
  closeBrowser,
} from '../src/services/quotationPdf.service.js';
import { buildFixtureQuotation } from './helpers/quotationFixture.js';

// ===========================================================================
// pure HTML / formatting
// ===========================================================================

test('formatDocumentDate: prints the date the way the documents do', () => {
  assert.equal(formatDocumentDate(new Date(2026, 8, 21)), '21 sep 2026');
  assert.equal(formatDocumentDate(new Date(2026, 0, 3)), '03 jan 2026');
  assert.equal(formatDocumentDate('2027-02-10T00:00:00.000Z').slice(-4), '2027');
  assert.equal(formatDocumentDate(null), '');
  assert.equal(formatDocumentDate('not a date'), '');
});

test('html: the header carries every detail from the sample document', () => {
  const html = buildQuotationHTML(buildFixtureQuotation());

  assert.match(html, /Quotation for PM Surya Ghar Muft Bijli Yojana/);
  assert.match(html, /SULEKHA ENGINEERING/);
  assert.match(html, /Uttarsura, Surekalna, Purba Bardhaman/);
  assert.match(html, /West Bengal, 713408/);
  assert.match(html, /9832117393, sulekhaengineering@gmail\.com/);
  assert.match(html, /GSTN NO-19ADXFS9993G1ZW/);
  assert.match(html, /STATE CODE/);
  assert.match(html, /Quote No: SE\/PMSGY\/2026-27\/38/);
  assert.match(html, /Date: 21 sep 2026/);
});

test('html: bill to and ship to blocks', () => {
  const html = buildQuotationHTML(buildFixtureQuotation());

  assert.match(html, /Bill To:/);
  assert.match(html, /Ship To:/);
  assert.match(html, /Souvik Ghosh/);
  assert.match(html, /Consumer ID : 502178060/);
  assert.match(html, /Birpur, Gurap/);
  assert.match(html, /Hooghly, 712303/);
  assert.match(html, /Phone No - 9432665126/);
});

test('html: the empty ship to block still renders (as on the sample)', () => {
  const html = buildQuotationHTML(buildFixtureQuotation());
  const shipToCell = html.split('Ship To:</div>')[1].slice(0, 200);
  assert.match(shipToCell, /&nbsp;/);
});

test('html: the BOQ table holds every line, the brands and the amount', () => {
  const html = buildQuotationHTML(buildFixtureQuotation());

  assert.match(html, /Bill of Quantities \(BOQ\)/);
  assert.match(html, /Amount \(₹\)/);

  // Compare against the un-escaped text: descriptions containing "&"
  // (e.g. "Testing & commissioning") are correctly written as &amp; in the HTML.
  const plain = html
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

  const quotation = buildFixtureQuotation();
  quotation.items.forEach((item) => {
    assert.ok(plain.includes(item.description), `missing BOQ line: ${item.description}`);
  });

  assert.match(html, /Waaree\/Adani/);
  assert.match(html, /Deye\/any/);
  assert.match(html, /On grid Solar String Inverter \(Capacity: 3KW\)/);
  assert.match(html, /solar roof top high-rise GI structures, SS nut bolt/);
  assert.match(html, /TOTAL Including GST/);
  assert.match(html, /195000\.00/);
});

test('html: quantities are printed without trailing zeros', () => {
  const html = buildQuotationHTML(
    buildFixtureQuotation({
      items: [
        { description: 'Panel', brandModel: '', qty: 6, unit: 'nos' },
        { description: 'Cable', brandModel: '', qty: 1.5, unit: 'mtr' },
        { description: 'Kit', brandModel: '', qty: 0.5, unit: 'lot' },
      ],
    })
  );

  assert.match(html, /<td class="col-qty">6<\/td>/);
  assert.match(html, /<td class="col-qty">1\.5<\/td>/);
  assert.match(html, /<td class="col-qty">0\.5<\/td>/);
});

test('html: a line without a unit leaves the unit cell empty', () => {
  const html = buildQuotationHTML(buildFixtureQuotation());
  // the template genuinely has two lines with no unit (DCDB, ACDB)
  assert.match(html, /<td class="col-unit"><\/td>/);
});

test('html: the overview, terms, payment terms and bank footer are present', () => {
  const html = buildQuotationHTML(buildFixtureQuotation());

  assert.match(html, /3 kw solar panel system with 3 kw ongrid inverter/);
  assert.match(html, /solar roof top high rise structures/);
  assert.match(html, /Terms &amp; Condition:/);
  assert.match(html, /The cost includes design, supply, installing and commissioning of the system\./);
  assert.match(html, /No warranty on physical damage\./);
  assert.match(html, /Payment Terms/);
  assert.match(html, /50% advance with order/);
  // a raw apostrophe in a text node is valid HTML, and is what the print shows
  assert.match(html, /Company's Bank Details/);
  assert.match(html, /HDFC BANK/);
  assert.match(html, /50200041701622/);
  assert.match(html, /HDFC0009057/);
  assert.match(html, /Acceptance/);
  assert.match(html, /Client Name:/);
  assert.match(html, /Signature:/);
});

test('html: a non-GST quotation drops the "Including GST" label', () => {
  const html = buildQuotationHTML(buildFixtureQuotation({ amountIncludesGST: false }));
  assert.match(html, />TOTAL</);
  assert.doesNotMatch(html, /TOTAL Including GST/);
});

test('html: all user text is escaped', () => {
  const html = buildQuotationHTML(
    buildFixtureQuotation({
      customerName: '<script>alert("xss")</script>',
      addressLine1: 'A & B "Street"',
      items: [{ description: '<img src=x onerror=alert(1)>', brandModel: '', qty: 1, unit: 'nos' }],
      terms: [{ text: '<b>bold</b> & risky' }],
    })
  );

  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;script&gt;alert\(&quot;xss&quot;\)&lt;\/script&gt;/);
  assert.match(html, /A &amp; B &quot;Street&quot;/);
  assert.match(html, /&lt;b&gt;bold&lt;\/b&gt; &amp; risky/);
});

test('html: a quotation with no BOQ lines still renders a valid table', () => {
  const html = buildQuotationHTML(buildFixtureQuotation({ items: [] }));
  assert.match(html, /<tbody>/);
  assert.match(html, /TOTAL Including GST/);
});

test('html: the page is A4 with the configured margin, and scales with the font size', () => {
  const base = buildQuotationHTML(buildFixtureQuotation(), { fontSize: 8 });
  const small = buildQuotationHTML(buildFixtureQuotation(), { fontSize: 6.5 });

  assert.match(base, /@page \{ size: A4 portrait; margin: 8mm; \}/);
  assert.match(base, /font-size: 8pt/);
  assert.match(small, /font-size: 6\.5pt/);
});

test('html: the toolbar appears only for the print view', () => {
  const withToolbar = buildQuotationHTML(buildFixtureQuotation(), { includeToolbar: true });
  const withoutToolbar = buildQuotationHTML(buildFixtureQuotation(), { includeToolbar: false });

  assert.match(withToolbar, /class="doc-toolbar no-print"/);
  assert.match(withToolbar, /window\.print\(\)/);
  // the stylesheet always carries .doc-toolbar rules - the element is what matters
  assert.doesNotMatch(withoutToolbar, /<div class="doc-toolbar/);
});

test('html: the logo is embedded as a data uri, or omitted cleanly', () => {
  const withLogo = buildQuotationHTML(buildFixtureQuotation(), { logoDataUri: 'data:image/jpeg;base64,AAAA' });
  assert.match(withLogo, /<img src="data:image\/jpeg;base64,AAAA"/);

  const without = buildQuotationHTML(buildFixtureQuotation(), { logoDataUri: null });
  assert.doesNotMatch(without, /<img/);
});

test('html: a quotation without its own terms falls back to the fixed company terms', () => {
  // This is the shape an imported register-only record has.
  const quotation = buildFixtureQuotation({ terms: [], paymentTerms: [] });
  const html = buildQuotationHTML(quotation);

  assert.match(html, /Terms &amp; Condition:/);
  assert.match(html, /No warranty on physical damage\./);
  assert.match(html, /50% advance with order/);
});

test('print html: uses the same template as the pdf', async () => {
  const quotation = buildFixtureQuotation();
  const html = await renderQuotationHtml(quotation, { logoDataUri: null, includeToolbar: false });
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.match(html, /Quote No: SE\/PMSGY\/2026-27\/38/);
  // the markup is identical to what the PDF path renders
  assert.equal(html, buildQuotationHTML(quotation, { logoDataUri: null, includeToolbar: false }));
});

// ===========================================================================
// real rendering (headless Chrome)
// ===========================================================================

test('pdf: the sample quotation renders as exactly one A4 page', async () => {
  const quotation = buildFixtureQuotation();

  const { buffer, fontSize, contentHeightPx } = await renderQuotationPdf(quotation, { logoDataUri: null });

  assert.equal(buffer.subarray(0, 5).toString(), '%PDF-');
  assert.ok(buffer.length > 5000, `suspiciously small pdf: ${buffer.length} bytes`);
  assert.equal(countPdfPages(buffer), 1, 'the document must be a single page');
  assert.equal(fontSize, FONT_STEPS[0], 'the sample layout should fit at the base font size');
  assert.ok(
    contentHeightPx <= PAGE_CONTENT_HEIGHT_PX,
    `content ${contentHeightPx}px exceeded the printable ${PAGE_CONTENT_HEIGHT_PX}px`
  );
});

test('pdf: a quotation with long names and a three line address still fits', async () => {
  const quotation = buildFixtureQuotation({
    customerName: 'Arindam Chakrabartty',
    addressLine1: 'Village: Uttar Chandipur, Post Office: Chandipur Bazar',
    addressLine2: 'Near Sitala Mandir, Block: Ausgram II',
    district: 'Purba Bardhaman',
    pincode: '713408',
  });

  const { buffer, fontSize } = await renderQuotationPdf(quotation, { logoDataUri: null });

  assert.equal(countPdfPages(buffer), 1);
  assert.ok(FONT_STEPS.includes(fontSize));
});

test('pdf: 14 BOQ lines (the configured limit) still fit on one page', async () => {
  const items = Array.from({ length: 14 }, (_, index) => ({
    description: `Solar Modules Bifacial TOPcon Panel (610 wp) - batch ${index + 1}`,
    brandModel: 'Waaree/Adani',
    qty: 6,
    unit: 'nos',
  }));

  const { buffer, fontSize } = await renderQuotationPdf(buildFixtureQuotation({ items }), { logoDataUri: null });

  assert.equal(countPdfPages(buffer), 1);
  assert.ok(fontSize <= FONT_STEPS[0]);
});

test('pdf: an impossible layout is refused with QUOTATION_OVERFLOW, never a second page', async () => {
  const items = Array.from({ length: 24 }, (_, index) => ({
    description: `Extremely long BOQ line number ${index + 1} describing a component in unnecessary detail so that it wraps over several lines`,
    brandModel: 'A very long brand and model description',
    qty: 12,
    unit: 'nos',
  }));
  const terms = Array.from({ length: 12 }, (_, index) => ({
    text: `Term ${index + 1}: ${'additional wording '.repeat(12)}`,
  }));

  let result = null;
  let failure = null;
  try {
    result = await renderQuotationPdf(buildFixtureQuotation({ items, terms }), { logoDataUri: null });
  } catch (error) {
    failure = error;
  }

  if (failure) {
    assert.equal(failure.code, 'QUOTATION_OVERFLOW');
    assert.equal(failure.statusCode, 422);
    assert.equal(failure.details.itemCount, 24);
    assert.ok(failure.details.contentHeightPx > failure.details.pageHeightPx);
  } else {
    // If it did fit, it must have shrunk the font and still be a single page.
    assert.equal(countPdfPages(result.buffer), 1);
    assert.ok(result.fontSize < FONT_STEPS[0], 'an overflowing layout must have shrunk the font');
  }
});

test('pdf: rendering does not leave a browser process behind', async () => {
  await closeBrowser();
  const quotation = buildFixtureQuotation();

  const first = await renderQuotationPdf(quotation, { logoDataUri: null });
  assert.equal(countPdfPages(first.buffer), 1);

  await closeBrowser();
  const second = await renderQuotationPdf(quotation, { logoDataUri: null });
  assert.equal(countPdfPages(second.buffer), 1);

  await closeBrowser();
});
