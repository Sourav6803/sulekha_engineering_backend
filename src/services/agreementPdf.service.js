// src/services/agreementPdf.service.js
import { ApiError } from '../utils/ApiError.js';
import logger from '../utils/logger.js';
import { renderPdf, withPage, countPdfPages, closeBrowser } from './pdfBrowser.js';
import {
  fillTemplate,
  composeConsumerLine,
  formatRupeeTotal,
  formatAgreementDateParts,
} from '../utils/agreementText.js';
import {
  AGREEMENT_TITLE,
  AGREEMENT_EXECUTION,
  AGREEMENT_PREAMBLE,
  FIRST_PARTY_ITEMS,
  SECOND_PARTY_ITEMS,
  AMOUNT_SENTENCE,
  SIGNATURE_DISCLAIMER,
  DEFAULT_DISCOM,
  DEFAULT_REGISTERED_OFFICE,
} from '../data/agreementContent.js';

/**
 * The consumer agreement, matched to the issued document
 * ("Arindam Chakraborty_Agreement.pdf", ₹10 non-judicial stamp paper, 4 pages).
 *
 * Measured from that file and from the Word template:
 *   - body font 11 pt, Calibri;
 *   - page 1 opens with a blank area (~118 mm) where the stamp paper sits, with
 *     the agreement text starting below it;
 *   - every page carries a footer: the vendor's signature block at the right and
 *     "Guidelines for PM-Surya Ghar…" centred at the bottom, plus the page number;
 *   - the pages break after the 6 consumer clauses + 5 vendor clauses (page 2)
 *     and after vendor clause 18 (page 3), so page 4 opens with clause 19.
 *
 * The pagination is explicit (one block per page) so the content that the user
 * edits always lands on the same page; the layout is measured and the rendered
 * PDF is asserted to be exactly four pages.
 */

const PAGE = { top: 24, right: 20, bottom: 32, left: 22.5 };
const CONTENT_HEIGHT_MM = 297 - PAGE.top - PAGE.bottom; // 241mm
const CONTENT_HEIGHT_PX = Math.floor((CONTENT_HEIGHT_MM / 25.4) * 96);

/** Blank area at the top of page 1 for the stamp paper. */
export const STAMP_PAPER_GAP_MM = 118;

/** Where the vendor's obligations are split across pages 2 and 3. */
const VENDOR_CLAUSES_ON_PAGE_2 = 5; // clauses 1..5 stay on page 2
const PAGE_4_CLAUSE_INDEX = 18; // "19. Mutually Agreed Terms of Payment"

const FONT_STEPS = [11, 10.5, 10, 9.5, 9];
const EXPECTED_PAGES = 4;

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const buildStyles = (fontSize) => `
  /* Chrome gives the CSS @page margin precedence over the pdf() margin option,
     so the two must agree or the text runs into the paper edge. */
  @page { size: A4 portrait; margin: ${PAGE.top}mm ${PAGE.right}mm ${PAGE.bottom}mm ${PAGE.left}mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: Calibri, Carlito, "Segoe UI", "DejaVu Sans", Arial, sans-serif;
    font-size: ${fontSize}pt;
    line-height: 1.38;
    color: #000;
  }
  p { margin: 0 0 2pt; text-align: justify; }
  .page {
    width: 100%;
    height: ${CONTENT_HEIGHT_MM}mm;
    overflow: hidden;
    page-break-after: always;
    break-after: page;
  }
  .page:last-of-type { page-break-after: auto; break-after: auto; }
  .stamp-gap { height: ${STAMP_PAPER_GAP_MM}mm; }
  .doc-title { text-align: center; font-weight: 700; font-size: ${fontSize + 1}pt; margin-bottom: 6pt; }
  .label { text-align: center; font-weight: 400; display: block; margin: 4pt 0 2pt; }
  .aside { font-style: italic; }
  .heading { font-weight: 700; text-decoration: underline; margin: 6pt 0 2pt; }
  .clause { margin: 0 0 4pt; }
  .stage { margin-bottom: 3pt; }
  .spacer-26 { height: 26mm; }
  .spacer-28 { height: 28mm; }
  .spacer-82 { height: 82mm; }
  .sign-block table { width: 100%; border-collapse: collapse; }
  .sign-block td { vertical-align: top; width: 50%; padding: 0 8pt 0 0; }
  .sign-title { font-weight: 700; margin-bottom: 3pt; }
  .sign-row { margin-bottom: 1pt; text-align: left; }
  .disclaimer { border-top: 1px solid #000; padding-top: 4pt; font-size: ${Math.max(9, fontSize - 1)}pt; }
`;

/** "1. text" with the number inline, as the issued document prints it. */
const renderNumberedClauses = (items, { start = 1, from = 0 } = {}) =>
  items
    .slice(from)
    .map(
      (item, index) => `
    <p class="clause">${start + index}. ${escapeHtml(item)}</p>`
    )
    .join('');

/**
 * Footer drawn by Chrome on every page: the scheme guidelines centred at the
 * bottom plus the page number on the right.
 *
 * The vendor's name and signature block are deliberately NOT printed. The pages
 * are signed by hand on the company's own stamp paper once the agreement comes
 * off the printer, so a printed stamp would be a duplicate.
 */
const buildFooterTemplate = () => {
  const printableWidth = 210 - PAGE.left - PAGE.right; // 167.5mm

  // Laid out with a table: absolute positioning inside Chrome's footer container
  // pushed the right column past the paper edge.
  return `
<table style="width:${printableWidth}mm; margin:0 auto; border-collapse:collapse; color:#000;
              font-family: Calibri, Carlito, Arial, sans-serif; font-size:10.5px;">
  <tr>
    <td style="width:20%;"></td>

    <td style="width:60%; text-align:center; vertical-align:bottom; font-weight:700;">
      <div>Guidelines for PM-Surya Ghar: Muft Bijli Yojana</div>
      <div>Central Financial Assistance to Residential Consumers</div>
    </td>

    <td style="width:20%; text-align:right; vertical-align:bottom; font-weight:700;">
      <span class="pageNumber"></span>
    </td>
  </tr>
</table>`;
};

export const buildAgreementHTML = (agreement = {}, options = {}) => {
  const fontSize = options.fontSize || FONT_STEPS[0];
  const company = agreement.companySnapshot || {};

  const dateParts = formatAgreementDateParts(agreement.agreementDate || new Date()) || {
    day: '',
    month: '',
    year: '',
  };

  const consumerName = escapeHtml(agreement.consumerName || '');
  const consumerId = escapeHtml(agreement.consumerId || '');
  const discom = escapeHtml(agreement.discom || company.discom || DEFAULT_DISCOM);
  const companyName = escapeHtml(company.name || 'SULEKHA ENGINEERING');
  const registeredOffice = escapeHtml(company.registeredOffice || DEFAULT_REGISTERED_OFFICE);
  const consumerLine = escapeHtml(
    composeConsumerLine({ relationLine: agreement.relationLine, address: agreement.address })
  );

  const amountText = formatRupeeTotal(agreement.amount);
  const stages = Array.isArray(agreement.paymentSchedule) ? agreement.paymentSchedule : [];

  const firstPartyItems = FIRST_PARTY_ITEMS;
  const page2VendorItems = SECOND_PARTY_ITEMS.slice(0, VENDOR_CLAUSES_ON_PAGE_2);
  const page3VendorItems = SECOND_PARTY_ITEMS.slice(
    VENDOR_CLAUSES_ON_PAGE_2,
    PAGE_4_CLAUSE_INDEX
  );
  const page4Clause = SECOND_PARTY_ITEMS[PAGE_4_CLAUSE_INDEX];

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>${escapeHtml(AGREEMENT_TITLE)}</title><style>${buildStyles(fontSize)}</style></head>
<body>

  <!-- ================= PAGE 1 ================= -->
  <section class="page" data-page="1">
    <div class="stamp-gap" data-mark="stamp-gap-end"></div>

    <p class="doc-title">${escapeHtml(AGREEMENT_TITLE)}</p>

    <p>${fillTemplate(escapeHtml(AGREEMENT_EXECUTION), {
      day: dateParts.day,
      month: dateParts.month,
      year: dateParts.year,
    })}</p>

    <span class="label">Between</span>
    <p>${consumerName} having a residential electricity connection with consumer id ${consumerId} From ${discom} (DISCOM) at ${consumerLine}</p>
    <p class="aside">(here in after referred to as first Party i.e./consumer/consumer/purchaser /owner of system).</p>

    <span class="label">And</span>
    <p>${companyName} having registered/empanelled with the ${discom} (hereinafter referred as DISCOM) and is having registered office at ${registeredOffice}.</p>
    <p class="aside">(here in after referred to as second Party i.e. Vendor/ contractor/System Integrator).</p>

    <span class="label">Whereas</span>
    <p>${escapeHtml(AGREEMENT_PREAMBLE[1])}</p>

    <span class="label">And whereas</span>
  </section>

  <!-- ================= PAGE 2 ================= -->
  <section class="page" data-page="2">
    <p data-mark="page-2-start">${escapeHtml(AGREEMENT_PREAMBLE[3])}</p>

    <p>${escapeHtml(AGREEMENT_PREAMBLE[4])}</p>
    <p class="heading">${escapeHtml(AGREEMENT_PREAMBLE[5])}</p>
    ${renderNumberedClauses(firstPartyItems, { start: 1 })}

    <p class="heading" data-mark="second-party-heading">The Second Party hereby undertakes to perform the following activities:</p>
    ${renderNumberedClauses(page2VendorItems, { start: 1 })}
  </section>

  <!-- ================= PAGE 3 ================= -->
  <section class="page" data-page="3">
    ${renderNumberedClauses(page3VendorItems, { start: VENDOR_CLAUSES_ON_PAGE_2 + 1 })}
    <span data-mark="page-3-end"></span>
  </section>

  <!-- ================= PAGE 4 ================= -->
  <section class="page" data-page="4">
    <p class="clause" data-mark="clause-19"><strong>${PAGE_4_CLAUSE_INDEX + 1}. ${escapeHtml(page4Clause)}</strong></p>
    <p>${fillTemplate(escapeHtml(AMOUNT_SENTENCE), { amount: amountText })}</p>
    ${stages
      .map(
        (stage) => `
    <p class="stage">
      <strong>${escapeHtml(stage.label)}</strong>
      ${escapeHtml(String(stage.percent))}%(Rs. ${escapeHtml(stage.amountText)}) ${escapeHtml(stage.note)}
    </p>`
      )
      .join('')}

    <div class="spacer-26"></div>
    <div class="sign-block" data-mark="signature-block">
      <table>
        <tr>
          <td><p class="sign-title">First Party</p></td>
          <td><p class="sign-title">Second Party</p></td>
        </tr>
        <tr>
          <td>
            <p class="sign-row">Name:- ${consumerName}</p>
            <p class="sign-row">Address:- ${consumerLine}</p>
          </td>
          <td>
            <p class="sign-row">Name:- ${companyName}</p>
            <p class="sign-row">Address:- ${registeredOffice}</p>
          </td>
        </tr>
      </table>
    </div>

    <div class="spacer-28"></div>
    <table style="width:100%; border-collapse:collapse">
      <tr>
        <td style="width:50%; vertical-align:top">
          <p class="sign-row">Sign:-</p>
          <p class="sign-row">Date:-</p>
        </td>
        <td style="width:50%; vertical-align:top">
          <p class="sign-row">Sign:-</p>
          <p class="sign-row">Date:-</p>
        </td>
      </tr>
    </table>

    <div class="spacer-82"></div>
    <p class="disclaimer">${escapeHtml(SIGNATURE_DISCLAIMER)}</p>
  </section>

</body>
</html>`;
};

/** The on-screen / print twin: same markup plus a toolbar that is hidden on paper. */
export const buildAgreementPrintHtml = (agreement = {}, options = {}) => {
  const html = buildAgreementHTML(agreement, options);
  if (options.includeToolbar === false) return html;

  const toolbar = `
  <div class="doc-toolbar no-print">
    <button type="button" onclick="window.print()">Print</button>
    <span>4 pages · A4 · 11 pt</span>
  </div>
  <style>
    .doc-toolbar {
      position: fixed; top: 0; left: 0; right: 0; z-index: 50;
      display: flex; align-items: center; gap: 10px; justify-content: flex-end;
      padding: 8px 14px; background: #F4F4F2; border-bottom: 1px solid #C9C9C4;
      font-family: Arial, Helvetica, sans-serif; font-size: 13px;
    }
    .doc-toolbar button {
      background: #1F6F3F; color: #fff; border: 0; border-radius: 6px;
      padding: 7px 16px; font-size: 13px; cursor: pointer;
    }
    .doc-toolbar span { color: #5C5C5C; }
    body { padding-top: 46px; }
    .page { height: auto; min-height: ${CONTENT_HEIGHT_MM}mm; }
    @media print { .doc-toolbar { display: none; } body { padding-top: 0; } }
  </style>`;

  return html.replace('<body>', `<body>${toolbar}`);
};

/** Per-page block heights, used to decide whether the font size fits. */
export const measureAgreementLayout = (agreement = {}, { fontSize } = {}) =>
  withPage(buildAgreementHTML(agreement, { fontSize }), async (page) =>
    page.evaluate((limit) => {
      const blocks = Array.from(document.querySelectorAll('.page')).map((node) => ({
        page: node.getAttribute('data-page'),
        height: Math.round(node.scrollHeight),
        // the box has a fixed height, so scrollHeight > clientHeight means the
        // content would be clipped - measured in the box, not against a
        // rounded millimetre value (which is off by a pixel either way)
        overflows: node.scrollHeight > node.clientHeight + 1,
        headroom: node.clientHeight - node.scrollHeight,
      }));

      const marks = {};
      document.querySelectorAll('[data-mark]').forEach((node) => {
        marks[node.getAttribute('data-mark')] = Math.floor(
          node.closest('.page')?.getAttribute('data-page') || 0
        );
      });

      return { blocks, marks, limitPx: limit, fits: blocks.every((block) => !block.overflows) };
    }, CONTENT_HEIGHT_PX)
  );

export const renderAgreementPdf = async (agreement, options = {}) => {
  const steps = options.fontSize ? [options.fontSize] : FONT_STEPS;
  let chosen = null;
  let layout = null;

  for (const fontSize of steps) {
    const measured = await measureAgreementLayout(agreement, { fontSize });
    layout = measured;

    if (measured.fits && measured.blocks.length === EXPECTED_PAGES) {
      chosen = fontSize;
      break;
    }
  }

  if (!chosen) {
    logger.error('Agreement does not fit its four pages', { layout });
    throw new ApiError(
      422,
      'This agreement does not fit on four pages. Please shorten the consumer address.',
      'AGREEMENT_OVERFLOW',
      { layout, smallestFontSize: FONT_STEPS[FONT_STEPS.length - 1] }
    );
  }

  const buffer = await renderPdf(buildAgreementHTML(agreement, { fontSize: chosen }), {
    pdfOptions: {
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: buildFooterTemplate(),
      margin: {
        top: `${PAGE.top}mm`,
        right: `${PAGE.right}mm`,
        bottom: `${PAGE.bottom}mm`,
        left: `${PAGE.left}mm`,
      },
    },
  });

  const pages = countPdfPages(buffer);
  if (pages !== EXPECTED_PAGES) {
    logger.error(`Agreement rendered as ${pages} pages at ${chosen}pt (expected ${EXPECTED_PAGES})`, {
      blocks: layout?.blocks,
      marks: layout?.marks,
    });
  }

  return { buffer, fontSize: chosen, pages, layout };
};

export const agreementPdfService = {
  buildAgreementHTML,
  buildAgreementPrintHtml,
  buildFooterTemplate,
  measureAgreementLayout,
  renderAgreementPdf,
  countPdfPages,
  closeBrowser,
  FONT_STEPS,
  EXPECTED_PAGES,
  CONTENT_HEIGHT_MM,
  CONTENT_HEIGHT_PX,
  STAMP_PAPER_GAP_MM,
};

export {
  countPdfPages,
  closeBrowser,
  buildFooterTemplate,
  EXPECTED_PAGES,
  FONT_STEPS,
  CONTENT_HEIGHT_PX,
};
export default agreementPdfService;
