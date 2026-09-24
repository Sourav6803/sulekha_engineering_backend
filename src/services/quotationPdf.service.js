// src/services/quotationPdf.service.js
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import config from '../config/env.js';
import logger from '../utils/logger.js';
import { ApiError } from '../utils/ApiError.js';
import { formatQuotationAmount } from '../utils/quotationNumber.js';

/**
 * Quotation document renderer.
 *
 * ONE template produces three outputs:
 *   - the downloadable PDF            (GET /quotations/:id/pdf)
 *   - the printable HTML              (GET /quotations/:id/print)
 *   - the on-screen preview           (the client embeds one of the two above)
 *
 * so what you see, what prints and what downloads are always the same markup.
 *
 * Layout fidelity comes from measurements taken off the existing manual PDF
 * (`Souvik Ghosh_Quotation.pdf`): the page is a single flattened image with no
 * text layer, so colours and geometry were sampled from a 200 dpi raster.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Sampled from the existing quotations. */
export const DOC_COLORS = {
  /** the BILL TO / SHIP TO band and the BOQ header row */
  green: '#68B060',
  /** section headings: System Overview, Bill of Quantities (BOQ), Payment Terms, Acceptance */
  heading: '#8098C0',
  /** the title bar text */
  title: '#8098C0',
  border: '#000000',
  text: '#000000',
};

/**
 * The existing documents were produced from a wide Excel sheet scaled to fit,
 * which left a 2.9 mm left margin and a 7.1 mm right margin. A clean, symmetric
 * 8 mm margin is used instead: 3 mm is inside the printable area of most
 * printers, and the asymmetry is an artefact of the scan, not the design.
 */
export const DOC_MARGIN_MM = 8;

/** A4 = 210 x 297 mm. */
export const PAGE_CONTENT_WIDTH_MM = 210 - DOC_MARGIN_MM * 2;
export const PAGE_CONTENT_HEIGHT_MM = 297 - DOC_MARGIN_MM * 2;

/** CSS pixels at 96 dpi - what the browser layout engine reports. */
const MM_TO_PX = 96 / 25.4;
export const PAGE_CONTENT_HEIGHT_PX = Math.floor(PAGE_CONTENT_HEIGHT_MM * MM_TO_PX);

/** Shrink steps applied when the content does not fit on one page. */
export const FONT_STEPS = [8, 7.5, 7, 6.5, 6];

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** The document prints dates as "21 sep 2026". */
export const formatDocumentDate = (value) => {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const day = String(date.getDate()).padStart(2, '0');
  return `${day} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
};

// ============================================================================
// logo
// ============================================================================
let logoCache = null;

/**
 * Resolve the logo as a base64 data URI so the print browser never depends on a
 * file path or a network fetch.
 */
export const loadLogoDataUri = async (logoPathOverride = null) => {
  if (logoCache && !logoPathOverride) return logoCache;
  if (logoPathOverride && !fs.existsSync(logoPathOverride)) return null;

  const candidates = [
    logoPathOverride,
    path.join(__dirname, '..', '..', 'assets', 'sulekha-logo.jpeg'),
    path.join(__dirname, '..', '..', 'assets', 'sulekha-logo.png'),
    path.join(__dirname, '..', '..', '..', 'client', 'public', 'sulekha_engineering_logo.jpeg'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate)) continue;
      const buffer = await fsp.readFile(candidate);
      const extension = path.extname(candidate).toLowerCase();
      const mime = extension === '.png' ? 'image/png' : 'image/jpeg';
      const dataUri = `data:${mime};base64,${buffer.toString('base64')}`;
      if (!logoPathOverride) logoCache = dataUri;
      return dataUri;
    } catch (error) {
      logger.warn(`Quotation logo could not be read from ${candidate}: ${error.message}`);
    }
  }

  logger.warn('Quotation logo not found - the document will print without it');
  return null;
};

// ============================================================================
// HTML
// ============================================================================
const buildCss = (fontSizePt) => `
  @page { size: A4 portrait; margin: ${DOC_MARGIN_MM}mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body {
    font-family: Arial, "Helvetica Neue", Helvetica, sans-serif;
    color: ${DOC_COLORS.text};
    font-size: ${fontSizePt}pt;
    line-height: 1.28;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  #sheet { width: ${PAGE_CONTENT_WIDTH_MM}mm; }

  table { border-collapse: collapse; width: 100%; table-layout: fixed; }
  td, th { border: 0.5pt solid ${DOC_COLORS.border}; padding: 1.05mm 1.3mm; vertical-align: top; }
  .no-border td { border: none; }

  .doc-title {
    text-align: center;
    font-weight: bold;
    color: ${DOC_COLORS.title};
    font-size: 1.38em;
    padding: 1.5mm 1.3mm;
  }
  .doc-company { text-align: center; font-weight: bold; font-size: 1.28em; padding: 1.5mm 1.3mm; }
  .hdr-name { font-weight: bold; }
  .hdr-logo-cell { text-align: center; vertical-align: middle; padding: 0.8mm; }
  .hdr-logo-cell img { width: 100%; max-height: 40mm; object-fit: contain; }
  .state-code-row { display: flex; justify-content: space-between; gap: 2mm; }
  .state-code-label { white-space: nowrap; }
  .quote-line { font-weight: normal; }
  .quote-line b { font-weight: bold; }

  .band {
    background: ${DOC_COLORS.green};
    color: #fff;
    font-weight: bold;
    padding: 1.2mm 1.3mm;
    text-transform: uppercase;
    font-size: 1.05em;
  }
  .band-row td { border: 0.5pt solid ${DOC_COLORS.border}; padding: 0; }
  .billto td { border: 0.5pt solid ${DOC_COLORS.border}; padding: 1.05mm 1.3mm; vertical-align: top; }
  .billto .band { border: none; }

  .section-heading { color: ${DOC_COLORS.heading}; font-weight: bold; margin: 2.1mm 0 1.1mm; font-size: 1.08em; }
  .section-heading-black { color: #000; font-weight: bold; margin: 2.1mm 0 1.1mm; font-size: 1.05em; }
  .overview { text-align: justify; }

  .boq th {
    background: ${DOC_COLORS.green};
    color: #fff;
    font-weight: bold;
    text-align: center;
    padding: 1.3mm 1.2mm;
    font-size: 1em;
  }
  .boq td { padding: 1.05mm 1.3mm; }
  .boq .col-desc { text-align: left; }
  .boq .col-mid { text-align: left; }
  .boq .col-qty { text-align: center; }
  .boq .col-unit { text-align: center; }
  .boq .col-amount { text-align: right; }
  .boq .merged-amount { text-align: right; vertical-align: middle; }
  .boq .total-label { text-align: center; font-weight: bold; }
  .boq .total-amount { text-align: right; font-weight: bold; }

  .terms p { margin: 0 0 1.15mm; text-align: justify; }
  .footer-table td { border: none; padding: 0; vertical-align: top; }
  .footer-table .inner td { border: none; padding: 0.4mm 0; }
  .bank-title { font-weight: bold; }

  /* Print / preview chrome - never printed. */
  .doc-toolbar {
    position: sticky; top: 0; z-index: 5;
    display: flex; gap: 8px; align-items: center;
    padding: 8px 12px; margin: 0 0 10px;
    background: #0f172a; color: #fff;
    font-size: 11px;
  }
  .doc-toolbar button {
    font: inherit; padding: 6px 14px; border-radius: 6px; border: 1px solid #d96c2c;
    background: #d96c2c; color: #fff; cursor: pointer;
  }
  .doc-toolbar button.secondary { background: transparent; border-color: #94a3b8; }
  @media print {
    .doc-toolbar, .no-print { display: none !important; }
    body { margin: 0; }
    #sheet { width: auto; }
  }
  @media screen {
    body { background: #f3f4f6; padding: 0 0 16px; }
    #sheet { background: #fff; margin: 0 auto; box-shadow: 0 1px 6px rgba(0,0,0,.18); padding: ${DOC_MARGIN_MM}mm; }
  }
`;

/**
 * BOQ rows.
 *
 * The existing documents carry one amount for the whole BOQ, printed in a single
 * cell merged vertically across the item rows (that is why the total appears to
 * sit in the middle of the table). That layout is reproduced here with a
 * `rowspan` cell. If any line carries its own amount, the amount column is
 * printed per line instead.
 */
const renderItemRows = (items, amountText) => {
  const rows = items.length > 0 ? items : [{ description: '', brandModel: '', qty: '', unit: '' }];
  const perLineAmounts = rows.some((item) => item.amount !== null && item.amount !== undefined);

  return rows
    .map((item, index) => {
      let amountCell = '';
      if (perLineAmounts) {
        amountCell = `<td class="col-amount">${
          item.amount === null || item.amount === undefined ? '' : escapeHtml(formatQuotationAmount(item.amount))
        }</td>`;
      } else if (index === 0) {
        amountCell = `<td class="merged-amount" rowspan="${rows.length}">${escapeHtml(amountText)}</td>`;
      }

      return `
      <tr>
        <td class="col-desc">${escapeHtml(item.description)}</td>
        <td class="col-mid">${escapeHtml(item.brandModel)}</td>
        <td class="col-qty">${escapeHtml(formatQty(item.qty))}</td>
        <td class="col-unit">${item.unit ? escapeHtml(item.unit) : ''}</td>
        ${amountCell}
      </tr>`;
    })
    .join('');
};

/** 6 -> "6", 1.5 -> "1.5" */
const formatQty = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3)));
};

/**
 * Build the complete A4 document.
 *
 * @param {Object} quotation  plain object (lean doc is fine) with companySnapshot
 * @param {Object} [options]  { fontSize, logoDataUri, includeToolbar }
 * @returns {String} full HTML document
 */
export const buildQuotationHTML = (quotation = {}, options = {}) => {
  const fontSize = options.fontSize || FONT_STEPS[0];
  const company = quotation.companySnapshot || {};
  const items = Array.isArray(quotation.items) ? quotation.items : [];
  // Terms are fixed company-wide. Records imported from the old register carry
  // none of their own, so the snapshot's copy is printed instead of a blank block.
  const terms =
    Array.isArray(quotation.terms) && quotation.terms.length > 0 ? quotation.terms : company.terms || [];
  const paymentTerms =
    Array.isArray(quotation.paymentTerms) && quotation.paymentTerms.length > 0
      ? quotation.paymentTerms
      : company.paymentTerms || [];
  const shipTo = quotation.shipTo || {};

  const amount = quotation.amount === null || quotation.amount === undefined ? '' : formatQuotationAmount(quotation.amount);
  const amountLabel = quotation.amountIncludesGST === false ? 'TOTAL' : 'TOTAL Including GST';

  const addressLines = (company.addressLines || []).filter(Boolean);
  const phoneAndEmail = [company.phone, company.email].filter(Boolean).join(', ');

  const billToLines = [
    quotation.customerName,
    quotation.consumerId ? `Consumer ID : ${quotation.consumerId}` : null,
    [quotation.addressLine1, quotation.addressLine2].filter(Boolean).join(', '),
    [quotation.district, quotation.pincode].filter(Boolean).join(', '),
    quotation.phoneNo ? `Phone No - ${quotation.phoneNo}` : null,
  ].filter((line) => line && String(line).trim());

  const shipToLines = [
    shipTo.name,
    ...(shipTo.addressLines || []),
    shipTo.phone ? `Phone No - ${shipTo.phone}` : null,
  ].filter((line) => line && String(line).trim());

  const logoCell = options.logoDataUri
    ? `<td class="hdr-logo-cell" rowspan="7"><img src="${options.logoDataUri}" alt=""></td>`
    : '<td class="hdr-logo-cell" rowspan="7"></td>';

  const toolbar = options.includeToolbar
    ? `<div class="doc-toolbar no-print">
         <strong>${escapeHtml(quotation.quotationNo || '')}</strong>
         <span style="opacity:.75">${escapeHtml(quotation.customerName || '')}</span>
         <span style="flex:1"></span>
         <button type="button" onclick="window.print()">Print</button>
       </div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(quotation.quotationNo || 'Quotation')} - ${escapeHtml(quotation.customerName || '')}</title>
<style>${buildCss(fontSize)}</style>
</head>
<body>
${toolbar}
<div id="sheet">

  <!-- ================= HEADER ================= -->
  <table class="hdr">
    <colgroup>
      <col style="width:42%"><col style="width:8%"><col style="width:24%"><col style="width:26%">
    </colgroup>
    <tr>
      <td class="doc-title" colspan="3">${escapeHtml(company.quotationTitle || 'Quotation for PM Surya Ghar Muft Bijli Yojana')}</td>
      ${logoCell}
    </tr>
    <tr>
      <td class="doc-company" colspan="3">${escapeHtml(company.name || '')}</td>
    </tr>
    <tr>
      <td class="hdr-name">${escapeHtml(company.name || '')}</td>
      <td></td>
      <td>${company.gstn ? `GSTN NO-${escapeHtml(company.gstn)}` : ''}</td>
    </tr>
    <tr>
      <td>${escapeHtml(addressLines[0] || '')}</td>
      <td></td>
      <td>
        <div class="state-code-row">
          <span class="state-code-label">${company.stateCode ? 'STATE CODE' : ''}</span>
          <span>${escapeHtml(company.stateCode || '')}</span>
        </div>
      </td>
    </tr>
    <tr>
      <td>${escapeHtml(addressLines[1] || '')}</td>
      <td></td>
      <td></td>
    </tr>
    <tr>
      <td>${escapeHtml(phoneAndEmail)}</td>
      <td></td>
      <td></td>
    </tr>
    <tr>
      <td class="quote-line"><b>Quote No: ${escapeHtml(quotation.quotationNo || '')}</b></td>
      <td></td>
      <td class="quote-line"><b>Date: ${escapeHtml(formatDocumentDate(quotation.issueDate))}</b></td>
    </tr>
  </table>

  <!-- ================= BILL TO / SHIP TO ================= -->
  <table class="billto">
    <tr>
      <td style="width:50%;padding:0;border:0.5pt solid ${DOC_COLORS.border}"><div class="band">Bill To:</div></td>
      <td style="width:50%;padding:0;border:0.5pt solid ${DOC_COLORS.border}"><div class="band">Ship To:</div></td>
    </tr>
    <tr>
      <td style="width:50%">${billToLines.map((line) => escapeHtml(line)).join('<br>') || '&nbsp;'}</td>
      <td style="width:50%">${shipToLines.map((line) => escapeHtml(line)).join('<br>') || '&nbsp;'}</td>
    </tr>
  </table>

  <!-- ================= SYSTEM OVERVIEW ================= -->
  <div class="section-heading">System Overview</div>
  <div class="overview">${escapeHtml(quotation.systemOverview || '')}</div>

  <!-- ================= BOQ ================= -->
  <div class="section-heading">Bill of Quantities (BOQ)</div>
  <table class="boq">
    <colgroup>
      <col style="width:44%"><col style="width:20%"><col style="width:11%"><col style="width:9%"><col style="width:16%">
    </colgroup>
    <thead>
      <tr>
        <th>Description</th>
        <th>Brand/Model</th>
        <th>Quantity</th>
        <th>Unit</th>
        <th>Amount (₹)</th>
      </tr>
    </thead>
    <tbody>
      ${renderItemRows(items, amount)}
      <tr>
        <td colspan="4" class="total-label">${escapeHtml(amountLabel)}</td>
        <td class="total-amount">${escapeHtml(amount)}</td>
      </tr>
    </tbody>
  </table>

  <!-- ================= TERMS ================= -->
  <div class="section-heading-black">Terms &amp; Condition:</div>
  <div class="terms">
    ${terms.map((term) => `<p>${escapeHtml(term.text)}</p>`).join('')}
  </div>

  <div class="section-heading">Payment Terms</div>
  <div>${paymentTerms.map((term) => escapeHtml(term.text)).join('<br>')}</div>

  <!-- ================= FOOTER ================= -->
  <table class="footer-table" style="margin-top:3.2mm">
    <tr>
      <td style="width:52%">
        <div class="bank-title">Company's Bank Details</div>
        <table class="inner">
          ${company.bankName ? `<tr><td style="width:30%">Bank Name :</td><td>${escapeHtml(company.bankName)}</td></tr>` : ''}
          ${company.accountName ? `<tr><td>Name -</td><td>${escapeHtml(company.accountName)}</td></tr>` : ''}
          ${company.accountNumber ? `<tr><td>Bank Ac -</td><td>${escapeHtml(company.accountNumber)}</td></tr>` : ''}
          ${company.ifsc ? `<tr><td>IFSC Code : -</td><td>${escapeHtml(company.ifsc)}</td></tr>` : ''}
        </table>
      </td>
      <td style="width:48%">
        <div class="section-heading" style="margin-top:0">Acceptance</div>
        <div>Client Name:</div>
        <div style="margin-top:6mm">Signature:</div>
      </td>
    </tr>
  </table>

</div>
</body>
</html>`;
};

// ============================================================================
// browser
// ============================================================================
let browserPromise = null;
let idleTimer = null;
const IDLE_CLOSE_MS = 120000;

/**
 * Launch options follow the existing pdf.service conventions: an explicit
 * executablePath is only used when the configured file actually exists, so a
 * stale Linux value cannot break a Windows box. Puppeteer otherwise discovers
 * its own Chromium.
 */
const launchOptions = () => {
  const configured = config.PUPPETEER_EXECUTABLE_PATH;
  const executablePath = configured && fs.existsSync(configured) ? configured : undefined;

  return {
    headless: true,
    executablePath,
    ignoreHTTPSErrors: true,
    args: config.PUPPETEER_LAUNCH_ARGS?.length
      ? config.PUPPETEER_LAUNCH_ARGS
      : ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
  };
};

const getBrowser = async () => {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }

  if (!browserPromise) {
    browserPromise = puppeteer.launch(launchOptions()).catch((error) => {
      browserPromise = null;
      logger.error('Quotation PDF: browser launch failed:', error);
      throw new ApiError(
        503,
        'The document renderer is unavailable. Chrome could not be started on the server.',
        'PDF_RENDERER_UNAVAILABLE'
      );
    });
  }

  const browser = await browserPromise;
  if (!browser.connected) {
    browserPromise = null;
    return getBrowser();
  }

  // Release the browser after a quiet period so a long running server does not
  // hold a Chrome process forever.
  idleTimer = setTimeout(() => {
    closeBrowser().catch(() => {});
  }, IDLE_CLOSE_MS);
  if (typeof idleTimer.unref === 'function') idleTimer.unref();

  return browser;
};

export const closeBrowser = async () => {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (!browserPromise) return;
  const pending = browserPromise;
  browserPromise = null;
  try {
    const browser = await pending;
    await browser.close();
  } catch {
    /* already gone */
  }
};

// ============================================================================
// rendering
// ============================================================================

/**
 * Render the document, shrinking the font until it fits one A4 page.
 *
 * The height is measured in the browser (CSS pixels at 96 dpi) against the
 * printable area, so overflow is detected before the PDF is produced instead of
 * silently spilling onto page two.
 *
 * @returns {Promise<{buffer: Buffer, fontSize: number, contentHeightPx: number}>}
 */
export const renderQuotationPdf = async (quotation, options = {}) => {
  const logoDataUri = options.logoDataUri !== undefined ? options.logoDataUri : await loadLogoDataUri();
  const browser = await getBrowser();
  let page;

  try {
    page = await browser.newPage();
    page.setDefaultTimeout(30000);

    let chosen = null;
    let lastHeight = 0;

    for (const fontSize of FONT_STEPS) {
      const html = buildQuotationHTML(quotation, { ...options, fontSize, logoDataUri, includeToolbar: false });
      await page.setContent(html, { waitUntil: 'load' });

      // eslint-disable-next-line no-await-in-loop
      const height = await page.evaluate(() => {
        const sheet = document.getElementById('sheet');
        return sheet ? sheet.getBoundingClientRect().height : 0;
      });
      lastHeight = height;

      if (height > 0 && height <= PAGE_CONTENT_HEIGHT_PX + 1) {
        chosen = fontSize;
        break;
      }
    }

    if (chosen === null) {
      throw new ApiError(
        422,
        'This quotation is too long to fit on a single page. Reduce the number of BOQ lines or shorten the terms.',
        'QUOTATION_OVERFLOW',
        {
          contentHeightPx: Math.round(lastHeight),
          pageHeightPx: PAGE_CONTENT_HEIGHT_PX,
          smallestFontPt: FONT_STEPS[FONT_STEPS.length - 1],
          itemCount: Array.isArray(quotation.items) ? quotation.items.length : 0,
        }
      );
    }

    const buffer = Buffer.from(await page.pdf({ printBackground: true, preferCSSPageSize: true }));

    return { buffer, fontSize: chosen, contentHeightPx: Math.round(lastHeight) };
  } finally {
    if (page) {
      try {
        await page.close();
      } catch {
        /* ignore */
      }
    }
  }
};

/**
 * Count the pages in a generated PDF. Chrome writes an uncompressed page tree,
 * so counting page objects is reliable; the result is used as an assertion, not
 * as the primary control (the height measurement is).
 */
export const countPdfPages = (buffer) => {
  const text = Buffer.isBuffer(buffer) ? buffer.toString('latin1') : String(buffer);
  const matches = text.match(/\/Type\s*\/Page[^s]/g);
  return matches ? matches.length : 0;
};

/** The printable HTML for the /print route (and the client's iframe). */
export const renderQuotationHtml = async (quotation, options = {}) => {
  const logoDataUri = options.logoDataUri !== undefined ? options.logoDataUri : await loadLogoDataUri();
  return buildQuotationHTML(quotation, { ...options, logoDataUri, includeToolbar: options.includeToolbar !== false });
};

export const quotationPdfService = {
  DOC_COLORS,
  FONT_STEPS,
  PAGE_CONTENT_HEIGHT_PX,
  buildQuotationHTML,
  formatDocumentDate,
  loadLogoDataUri,
  renderQuotationPdf,
  renderQuotationHtml,
  countPdfPages,
  closeBrowser,
};

export default quotationPdfService;
