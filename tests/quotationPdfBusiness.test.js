// tests/quotationPdfBusiness.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildQuotationHTML,
  renderQuotationPdf,
  countPdfPages,
  maxPagesFor,
  MAX_PAGES,
  closeBrowser,
} from '../src/services/quotationPdf.service.js';
import { buildFixtureQuotation } from './helpers/quotationFixture.js';
import {
  buildBusinessFixtureQuotation,
  ON_GRID_SECTION,
  OFF_GRID_SECTION,
} from './helpers/quotationBusinessFixture.js';

/** Amounts may print with the Indian digit grouping, so match tolerantly. */
const amountPattern = (digits) => new RegExp(digits.split('').join(',?'));

// ===========================================================================
// the two sheets are different documents
// ===========================================================================

test('business sheet: prints its own heading and tagline, not the domestic one', () => {
  const html = buildQuotationHTML(buildBusinessFixtureQuotation());

  assert.match(html, /QUOTATION FOR GRID CONNECTED SOLAR POWER PLANT ON-GRID &amp; OFF-GRID|QUOTATION FOR GRID CONNECTED SOLAR POWER PLANT ON-GRID & OFF-GRID/);
  assert.match(html, /PM Surya Ghar Muft Bijli Yojana Empanelled Vendor/);
  // The domestic heading must not leak onto the project sheet.
  assert.doesNotMatch(html, /Quotation for PM Surya Ghar Muft Bijli Yojana<|Quotation for PM Surya Ghar Muft Bijli Yojana<\/td>/);
  // The emblem and the wording share one merged cell that sits beside the
  // Sulekha logo, so both merged cells run down the same seven header rows.
  assert.match(html, /class="hdr-brand-cell" rowspan="7"/);
  assert.match(html, /class="brand-tagline"/);
  assert.match(html, /hdr-logo-cell" rowspan="7"/);
  // The header gained a fifth column for it.
  assert.match(html, /<col style="width:42%"><col style="width:8%"><col style="width:24%"><col style="width:13%">/);
});

test('business sheet: the BOQ carries the serial and specification columns', () => {
  const html = buildQuotationHTML(buildBusinessFixtureQuotation());

  assert.match(html, /<th>SL NO<\/th>/);
  assert.match(html, /<th>Description<\/th>/);
  assert.match(html, /<th>Specification<\/th>/);
  assert.match(html, /<th>Brand\/Model<\/th>/);
  assert.match(html, /<th>Unit<\/th>/);
  assert.match(html, /<th>Quantity<\/th>/);
  assert.match(html, /<th>Amount \(₹\)<\/th>/);

  // A specification from each section is printed in its own cell.
  assert.match(html, /col-spec/);
  assert.match(html, /Hot dip galvanized, 80 microns thick/);
  assert.match(html, /12V 200Ah solar tubular low maintenance lead acid/);
});

test('business sheet: both plant sections print with their own sub-total', () => {
  const html = buildQuotationHTML(buildBusinessFixtureQuotation());

  assert.ok(html.includes(ON_GRID_SECTION), 'the on-grid section heading prints');
  assert.ok(html.includes(OFF_GRID_SECTION), 'the off-grid section heading prints');
  assert.match(html, /class="section-row"/);

  // Each section's figure, and the grand total across both.
  assert.match(html, amountPattern('298246'));
  assert.match(html, amountPattern('187050'));
  assert.match(html, amountPattern('485296'));

  // The figures sit in merged cells, one per section.
  const mergedCells = html.match(/merged-amount" rowspan="\d+"/g) || [];
  assert.equal(mergedCells.length, 2, 'one merged figure per section');
});

test('business sheet: the total is struck before tax and says so', () => {
  const html = buildQuotationHTML(buildBusinessFixtureQuotation());

  assert.match(html, /TOTAL AMOUNT/);
  assert.doesNotMatch(html, /TOTAL Including GST/);

  // The rate itself is stated in the terms, as on the sheet.
  assert.match(html, /8\.9%/);
  assert.match(html, /70% of project cost @5%/);
});

test('business sheet: the vendor signs, the consumer does not', () => {
  const html = buildQuotationHTML(buildBusinessFixtureQuotation());

  assert.match(html, /For SULEKHA ENGINEERING/);
  assert.match(html, /Authorised Signatory/);
  assert.match(html, /Full Signature/);
  assert.doesNotMatch(html, /Client Name:/);
});

test('business sheet: the 50/50 schedule prints, not the domestic 50/40/10', () => {
  const html = buildQuotationHTML(buildBusinessFixtureQuotation());

  assert.match(html, /Balance 50% within 7-10 days of net-metering/);
  assert.doesNotMatch(html, /On commissioning/i);
});

test('consumer sheet is unchanged: no serial or specification column, client signs', () => {
  const html = buildQuotationHTML(buildFixtureQuotation());

  assert.doesNotMatch(html, /<th>SL NO<\/th>/);
  assert.doesNotMatch(html, /<th>Specification<\/th>/);
  assert.doesNotMatch(html, /Empanelled Vendor/);
  // ...and no brand cell at all, so the emblem can never appear on it. (The
  // shared stylesheet defines the classes, so match the markup, not the name.)
  assert.doesNotMatch(html, /class="hdr-brand-cell"/);
  assert.doesNotMatch(html, /class="brand-tagline"/);
  assert.match(html, /Client Name:/);
  assert.doesNotMatch(html, /Authorised Signatory/);
  // Still seven header rows with the logo merged down them.
  assert.match(html, /rowspan="7"/);
});

// ===========================================================================
// page allowance
// ===========================================================================

test('page allowance: one page for the domestic sheet, two for the business sheet', () => {
  assert.equal(maxPagesFor('consumer'), 1);
  assert.equal(maxPagesFor('partner'), 2);
  assert.equal(maxPagesFor(undefined), 1);
  assert.equal(maxPagesFor('something-else'), 1);
  assert.deepEqual(MAX_PAGES, { consumer: 1, partner: 2 });
});

test('pdf: the 29-line business sheet renders within its two pages', async () => {
  const result = await renderQuotationPdf(buildBusinessFixtureQuotation());

  assert.ok(result.buffer.length > 0, 'a pdf came back');
  assert.equal(result.fontSize, 8, 'it fits at the largest font size');
  assert.ok(result.pages >= 1 && result.pages <= 2, `expected 1-2 pages, got ${result.pages}`);
  assert.equal(countPdfPages(result.buffer), result.pages);
});

test('pdf: an oversized business sheet is refused, never spilled further', async () => {
  const business = buildBusinessFixtureQuotation();

  await assert.rejects(
    () =>
      renderQuotationPdf({
        ...business,
        terms: Array.from({ length: 40 }, (_, i) => ({ text: `Clause ${i + 1} `.repeat(12) })),
      }),
    (error) => {
      assert.equal(error.code, 'QUOTATION_OVERFLOW', 'the same error code as the domestic sheet');
      assert.equal(error.details.allowedPages, 2, 'the allowance is reported');
      return true;
    }
  );
});

test('pdf: rendering does not leave a browser process behind', async () => {
  await closeBrowser();
});
