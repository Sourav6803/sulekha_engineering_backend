// src/services/pdf.service.js
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import { format } from 'date-fns';
import { ApiError } from '../utils/ApiError.js';
import logger from '../utils/logger.js';
import config from '../config/env.js';

const COMPANY = {
  name: 'SULEKHA ENGINEERING',
  tagline: 'PM Surya Ghar Registered Vendor • Solar Power Plant',
  phone: '+91 98321 17393',
};

function formatQty(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  const rounded = Math.round(n * 1000) / 1000;
  return String(rounded);
}

/**
 * Canonical BOM — transcribed verbatim from Sulekha_Engineering_BOM_List.xlsx
 * so the printed sheet never misses a material, regardless of what templates
 * exist in the database. Each item: [ITEM NAME, ITEM DESCRIPTION, UOM, REMARK,
 * quantity-key]. The quantity-key is resolved per system size (see qtyFor).
 */
const MASTER_BOM = [
  {
    title: '1. SPV MODULE',
    items: [
      ['Adani Topcon -DCR', '620 Wp', 'nos', '', 'n'],
    ],
  },
  {
    title: '2. INVERTER',
    items: [
      ['SOLAR STRING INVERTERS (Microtek)', 'PVB Link 3.3 kWp - 1 ph', 'nos', '', 1],
    ],
  },
  {
    title: '3. RCC STRUCTURE (Man hight structure)',
    items: [
      ['LEG (FRONT)-80CS40X15X2', '2060 mm', 'nos', 'Modification Required', 'n'],
      ['LEG (BACK)-80CS40X15X2', '2704 mm', 'nos', 'Modification Required', 'n'],
      ['RAFTER-60CS40X15X2', '4100 mm', 'nos', '', 'n'],
      ['FRONT BRACING -ISA50X50X5', '1330 mm', 'nos', 'Modification Required', 'n'],
      ['BACK BRACING -ISA50X50X5', '1297 mm', 'nos', 'Modification Required', 'n'],
      ['Purlin [SQ. TUBE]', '3600 mm', 'nos', '', 'n'],
      ['Nut-Bolt-Double Washer', 'M10X25', 'nos', '', 'n8'],
      ['Star Nut Bolt Washer', 'M10X100', 'nos', '', 'n4'],
      ['U CLAMP', 'M8', 'nos', '', 'n2'],
      ['Mid Clamp [75 LONG]', '25 mm', 'nos', '', 'mid'],
      ['End Clamp[75 LONG]', '30 mm', 'nos', '', 'end'],
      ['NUT PLATE', '30 mm', 'nos', '', 'n'],
      ['DR. FIXIT', '200 ml', 'nos', '', 1],
      ['GROUTED CHEMICAL', '', 'nos', '', 1],
    ],
  },
  {
    title: '4. DC PART',
    items: [
      ['DCDB', '1 in 1 out (600V SPD)', 'nos', '', 1],
      ['DC CABLE', '4 Sq mm 1 Core Type-1', 'mtr', '', 'm20'],
      ['MC4 CONNECTOR', '(M+F)', 'pair', '', 'n2'],
      ['RING LUG', '4 - 6 mm', 'nos', '', 'n2'],
      ['PIN LUG', '4 - 6 mm', 'nos', '', 'n2'],
      ['MMS PVC PIPE', '25 mm 3 mtr', 'nos', '', 'm4'],
      ['CHINA SHADDLE', '25mm', 'nos', '', 'm6'],
      ['PVC TEE', '25mm', 'nos', '', 'm3'],
      ['PVC ELBOW', '25mm', 'nos', '', 'm4'],
    ],
  },
  {
    title: '5. AC PART',
    items: [
      ['ACDB', '1 phase (16 amp)', 'nos', '', 1],
      ['AC CABLE', '4 sq mm 2 core ALU armoured', 'mtr', '', 'm15'],
      ['CHINA SHADDLE', '14 mm', 'packet', '', 2],
      ['RING LUG', '10mm', 'nos', '', 4],
      ['PIN LUG', '10 mm', 'nos', '', 4],
      ['BUSBAR (1PH / 3PH) WITH BOX', '1ph', 'nos', '', 1],
      ['PVC CABLE TRAY', '45 x 45', 'nos', '', 'm3'],
      ['MCB', '32 amp 2 Pole', 'nos', '', 1],
      ['MCB ENCLOSER', 'PVC', 'nos', '', 1],
      ['AC CABLE', '4 SQ MM AC CABLE 2 CORE Cu', 'mtr', '', 'm8'],
      ['LA', '1 mtr coper', 'nos', '', 1],
    ],
  },
  {
    title: '6. EARTHING PART 1',
    items: [
      ['MS Angke for Extension [ISA25x25x5]', 'ISA 25x25x5', 'mtr', 'LA Extension', 'm3'],
      ['Insulated Pipe (FRP Material)', '1/2 inch Dia FRP material', 'mm', '', 2],
      ['Nut Bolt Washer (M6X40)', 'M6x40mm', 'nos', '', 8],
      ['Self thread screw', '2 inch', 'nos', '', 8],
      ['LA INSULATOR', 'Big', 'nos', '', 2],
      ['EARTHING CABLE', '6 Sq mm Cu 1 core', 'mtr', '', 'm6'],
      ['EARTHING CABLE', '16 Sq mm Cu 1 core', 'mtr', '', 'm6'],
      ['EARTHING ROD', 'CU bounded 2 mtr 16 mm', 'nos', '', 2],
      ['EARTHING PIT COVER', 'PVC Small', 'nos', '', 2],
      ['EARTHING BUS BAR', '4 hole', 'nos', '', 2],
    ],
  },
  {
    title: '7. EARTHING PART 2',
    items: [
      ['GI STRIP', '19x3', 'kg', '', 'm5'],
      ['PVC INSULATOR', 'Flat', 'nos', '', 4],
      ['BUSBAR NUT BOLT WASHER', 'SS M8 x 30', 'nos', '', 8],
      ['GI STRIP JOINT NUT BOLT WASHER', 'SS M6 x 25', 'nos', '', 8],
      ['BFC', '25 kg', 'bag', '', 2],
    ],
  },
  {
    title: '8. MISCELLANEOUS',
    items: [
      ['CABLE TIE', 'PVC 200mm uv protected', 'packet', '', 2],
      ['SCREW', 'SS 8 x 35', 'nos', '', 'n10'],
      ['Cleaning Brush', '6 Mtr.', 'nos', '', 1],
      ['Zink Spray', '', 'nos', '', 2],
      ['PVC TAPE - (R,G,B)', 'R 1 G 1 B 1', 'nos', '', 3],
      ['WOODEN GUJI', 'WOODEN', 'packet', '', 2],
    ],
  },
  {
    title: '9. STICKER',
    items: [
      ['SLD STICKER', '', 'nos', '', 1],
      ['SULEKHA LOGO STICKER', '', 'nos', '', 1],
      ['EARTHING STICKER', '', 'nos', '', 1],
      ['PVC casing pin', '', 'nos', '', 'n4'],
      ['DANGER STICKER', '', 'nos', '', 1],
    ],
  },
];

/**
 * Resolve a master-BOM quantity-key against the system size. `n` is the number
 * of 620Wp panels that make up the system (3.1 kW -> 5 panels), and `m*` keys
 * scale with kW for cable/metre-based line items.
 */
function qtyFor(systemSizeKW, key) {
  const kW = Number(systemSizeKW) || 0;
  const n = Math.max(1, Math.round((kW * 1000) / 620));

  if (typeof key === 'number') return key;
  switch (key) {
    case 'n': return n;
    case 'n2': return n * 2;
    case 'n4': return n * 4;
    case 'n8': return n * 8;
    case 'n10': return n * 10;
    case 'mid': return Math.max(0, (n - 1) * 2);
    case 'end': return 4;
    case 'm': return Math.max(1, Math.ceil(kW));
    case 'm3': return Math.max(1, Math.ceil(kW * 3));
    case 'm4': return Math.max(1, Math.ceil(kW * 4));
    case 'm5': return Math.max(1, Math.ceil(kW * 5));
    case 'm6': return Math.max(1, Math.ceil(kW * 6));
    case 'm8': return Math.max(1, Math.ceil(kW * 8));
    case 'm15': return Math.max(1, Math.ceil(kW * 15));
    case 'm20': return Math.max(1, Math.ceil(kW * 20));
    default: return 1;
  }
}

/**
 * Build the printable rows from the canonical master BOM. Serial numbers are
 * continuous across sections (1..62, matching the sheet). For the "final"
 * (as-built) variant, quantities are overridden from the confirmed
 * materialsUsed where a match by code or name is found, so the sheet stays
 * complete while reflecting what was actually installed.
 */
function buildMasterRows(installation, variant) {
  const kW = installation.systemSizeKW || 0;

  // Confirmed usage lookup for the final variant.
  const usageByKey = new Map();
  if (variant === 'final') {
    const usages = Array.isArray(installation.materialsUsed) ? installation.materialsUsed : [];
    for (const usage of usages) {
      if (usage.status === 'reversed') continue;
      const code = String(usage.materialCodeSnapshot || '').toLowerCase();
      const name = String(usage.materialNameSnapshot || '').toLowerCase();
      if (code) usageByKey.set(code, usage);
      if (name) usageByKey.set(name, usage);
    }
  }

  const rows = [];
  let serial = 0;
  for (const section of MASTER_BOM) {
    for (const [name, desc, uom, remark, qtyKey] of section.items) {
      serial += 1;
      let qty = qtyFor(kW, qtyKey);

      // Override from confirmed usage for the as-built variant.
      if (usageByKey.size > 0) {
        const code = String(remark || '').toLowerCase();
        const haystack = `${name} ${desc}`.toLowerCase();
        let matched = usageByKey.get(code) || usageByKey.get(haystack);
        if (!matched) {
          // Loose name match.
          for (const usage of usageByKey.values()) {
            const uname = String(usage.materialNameSnapshot || '').toLowerCase();
            if (uname && (name.toLowerCase().includes(uname) || uname.includes(name.toLowerCase()))) {
              matched = usage;
              break;
            }
          }
        }
        if (matched && matched.qty != null) qty = matched.qty;
      }

      rows.push({ section: section.title, serial, name, desc, uom, remark, qty: formatQty(qty) });
    }
  }
  return rows;
}

/**
 * PDF Service - Handles all PDF generation
 */
export const pdfService = {
  /**
   * Generate BOM PDF for installation
   * @param {Object} installation - Installation data with populated fields
   * @param {String} variant - 'suggested' | 'final'
   * @returns {Promise<Buffer>} PDF buffer
   */
  async generateBOMPDF(installation, variant = 'final') {
    let browser = null;
    try {
      browser = await this.getBrowser();

      const page = await browser.newPage();

      const html = await this.buildBOMHTML(installation, variant);

      await page.setContent(html, {
        waitUntil: 'networkidle0',
        timeout: 30000,
      });

      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        preferCSSPageSize: true,
        margin: {
          top: '5mm',
          right: '6mm',
          bottom: '5mm',
          left: '6mm',
        },
        timeout: 30000,
      });

      logger.info(`BOM PDF generated for installation: ${installation.installationId} (${variant})`);

      return Buffer.from(pdfBuffer);

    } catch (error) {
      logger.error('BOM PDF generation failed:', error);
      throw new ApiError(500, 'Failed to generate PDF: ' + error.message);
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  },

  /**
   * Get browser instance with optimized settings.
   *
   * Only passes an `executablePath` when the configured file actually exists.
   * Puppeteer otherwise honours PUPPETEER_EXECUTABLE_PATH itself and will throw
   * for a stale/Linux value on a Windows box — the previous `/usr/bin/google-chrome`
   * default broke every launch here. When no valid path is configured we leave
   * it undefined so Puppeteer auto-discovers the Chromium it downloaded into
   * `%USERPROFILE%\.cache\puppeteer`.
   */
  async getBrowser() {
    const configuredPath = config.PUPPETEER_EXECUTABLE_PATH;
    const executablePath = configuredPath && fs.existsSync(configuredPath) ? configuredPath : undefined;

    const options = {
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920,1080',
      ],
      executablePath,
      headless: true,
      ignoreHTTPSErrors: true,
    };

    try {
      return await puppeteer.launch(options);
    } catch (error) {
      logger.error('Browser launch failed:', error);
      throw new ApiError(500, 'Failed to launch browser for PDF generation');
    }
  },

  /**
   * Build BOM HTML for installation, matching Sulekha_Engineering_BOM_List.xlsx.
   * Always renders the full canonical list (never misses a material) with the
   * customer/job details filled dynamically.
   * @param {Object} installation - Installation data
   * @param {String} variant - 'suggested' | 'final'
   * @returns {string} HTML string
   */
  async buildBOMHTML(installation, variant = 'final') {
    const customer = installation.customer || {};
    const rows = buildMasterRows(installation, variant);
    const currentDate = format(new Date(), 'dd/MM/yyyy');
    const requirement = `${formatQty(installation.systemSizeKW)} KW ON GRID System`;

    const customerName = this._esc(customer.name || installation.customerNameSnapshot || '—');
    const mobile = this._esc(customer.phone || installation.customerPhoneSnapshot || '—');
    const shipping = this._esc(this._fullAddress(customer) || '—');

    // Group rows by section for the merged-PART look (title on first row only).
    const grouped = [];
    let cursor = null;
    for (const row of rows) {
      if (!cursor || cursor.section !== row.section) {
        cursor = { section: row.section, rows: [] };
        grouped.push(cursor);
      }
      cursor.rows.push(row);
    }

    const bodyRows = grouped
      .map((g) =>
        g.rows
          .map((row, i) => `
            <tr>
              <td class="col-part">${i === 0 ? this._esc(g.section) : ''}</td>
              <td class="col-no">${row.serial}</td>
              <td class="col-name">${this._esc(row.name)}</td>
              <td class="col-desc">${this._esc(row.desc)}</td>
              <td class="col-uom">${this._esc(row.uom)}</td>
              <td class="col-qty">${row.qty}</td>
              <td class="col-remark">${this._esc(row.remark)}</td>
            </tr>`)
          .join('')
      )
      .join('');

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>${this.getBOMStyles()}</style>
        </head>
        <body>
          <div class="sheet">
            <!-- Header -->
            <header class="bom-header">
              <div class="brand">
                <div class="logo">SE</div>
                <div>
                  <h1>${COMPANY.name}</h1>
                  <p class="tagline">${COMPANY.tagline} • ${COMPANY.phone}</p>
                </div>
              </div>
              <div class="doc-title">
                <h2>SULEKHA ENGINEERING • BOM LIST</h2>
                <p>${variant === 'suggested' ? 'SUGGESTED (FOR SITE)' : 'FINAL (AS BUILT)'} • Date: ${currentDate}</p>
              </div>
            </header>

            <!-- Job details -->
            <section class="job">
              <div class="job-grid">
                <div class="job-key">Project No</div><div class="job-val">${this._esc(installation.projectNo || '—')}</div>
                <div class="job-key">Quotation No</div><div class="job-val">${this._esc(installation.quotationNo || '—')}</div>
                <div class="job-key">Customer Name</div><div class="job-val">${customerName}</div>
                <div class="job-key">GST Details</div><div class="job-val">${this._esc(customer.gstNumber || '—')}</div>
                <div class="job-key">Requirement</div><div class="job-val">${this._esc(requirement)}</div>
                <div class="job-key">Mobile No</div><div class="job-val">${mobile}</div>
                <div class="job-key">Shipping Address</div><div class="job-val job-address">${shipping}</div>
              </div>
            </section>

            <!-- Material table -->
            <section class="materials">
              <table class="bom-table">
                <thead>
                  <tr>
                    <th class="col-part">PART</th>
                    <th class="col-no">SL NO</th>
                    <th class="col-name">ITEM NAME</th>
                    <th class="col-desc">ITEM DESCRIPTION</th>
                    <th class="col-uom">UOM</th>
                    <th class="col-qty">TOTAL QTY</th>
                    <th class="col-remark">REMARK</th>
                  </tr>
                </thead>
                <tbody>
                  ${bodyRows}
                </tbody>
              </table>
            </section>

            <footer class="bom-footer">
              <div class="sig"><div class="sig-line">Prepared By</div></div>
              <div class="sig"><div class="sig-line">Authorized Signatory</div></div>
              <p>${COMPANY.name} • ${COMPANY.tagline} • ${COMPANY.phone}</p>
            </footer>
          </div>
        </body>
      </html>
    `;
  },

  _esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },

  _fullAddress(customer) {
    return [customer.address, customer.city, customer.state, customer.pincode]
      .filter(Boolean)
      .join(', ');
  },

  /**
   * Compact single-A4 styles matching Sulekha_Engineering_BOM_List.xlsx.
   * Column widths mirror the sheet's column proportions so the printed table
   * reads exactly like the master Excel.
   */
  getBOMStyles() {
    return `
      @page { size: A4 portrait; margin: 5mm 6mm 5mm 6mm; }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { margin: 0; padding: 0; }
      body { font-family: Arial, Helvetica, sans-serif; font-size: 7.5px; color: #111; }
      .sheet { width: 100%; }

      /* ---- Header (matches rows 1-3 of the sheet) ---- */
      .bom-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #D96C2C; padding-bottom: 4px; margin-bottom: 5px; }
      .brand { display: flex; gap: 7px; align-items: center; }
      .logo { width: 30px; height: 30px; border-radius: 50%; background: #D96C2C; color: #fff; font-weight: 800; font-size: 14px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
      .brand h1 { font-size: 16px; letter-spacing: 0.5px; line-height: 1.05; }
      .tagline { font-size: 7.5px; color: #444; margin-top: 1px; }
      .doc-title { text-align: right; }
      .doc-title h2 { font-size: 11px; letter-spacing: 0.5px; color: #D96C2C; }
      .doc-title p { font-size: 7px; color: #444; }

      /* ---- Job details (matches rows 5-8 of the sheet) ---- */
      .job { border: 1px solid #999; margin-bottom: 5px; }
      .job-grid { display: grid; grid-template-columns: 70px 3fr 70px 2fr; }
      .job-key, .job-val { padding: 2px 5px; font-size: 7.5px; border-bottom: 1px solid #e4e4e4; }
      .job-key { font-weight: 700; background: #f5f5f5; border-right: 1px solid #e4e4e4; white-space: nowrap; }
      .job-val { font-weight: 600; }
      .job-address { grid-column: 2 / -1; }

      /* ---- Material table (7 columns, sheet proportions) ---- */
      .bom-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
      .bom-table th, .bom-table td { border: 1px solid #a5a5a5; padding: 1.2px 3px; font-size: 7.3px; word-break: break-word; overflow-wrap: anywhere; }
      .bom-table thead th { background: #f2f2f2; font-weight: 700; text-transform: uppercase; text-align: center; letter-spacing: 0.3px; font-size: 7.2px; padding: 2px 3px; }
      .col-part { width: 11.7%; text-align: left; font-weight: 700; }
      .col-no { width: 4.2%; text-align: center; }
      .col-name { width: 24.2%; text-align: left; }
      .col-desc { width: 27.3%; text-align: left; }
      .col-uom { width: 7.7%; text-align: center; }
      .col-qty { width: 7.8%; text-align: center; }
      .col-remark { width: 17.1%; text-align: left; }
      .bom-table tbody td { vertical-align: top; }
      .bom-table tbody tr:first-child td.col-part { font-weight: 700; }

      /* ---- Footer ---- */
      .bom-footer { display: flex; justify-content: space-between; margin-top: 6px; align-items: flex-end; }
      .sig { text-align: center; }
      .sig-line { border-top: 1px solid #999; width: 110px; font-size: 7px; color: #555; padding-top: 1px; }
      .bom-footer > p { font-size: 7px; color: #777; align-self: flex-end; }
    `;
  },

  /**
   * Get header template for PDF
   * @param {Object} installation - Installation data
   * @param {String} variant - 'suggested' | 'final'
   * @returns {string} HTML string
   */
  async getHeaderTemplate(installation, variant = 'final') {
    return `
      <div style="font-size:9px; padding:3px 8px; color:#6b7280; width:100%; border-bottom:1px solid #e5e7eb;">
        <span style="font-weight:600; color:#B72B28;">SULEKHA ENGINEERING</span>
        <span style="margin-left:16px;">BOM: ${installation.installationId || 'N/A'}</span>
        <span style="margin-left:16px;">${variant === 'suggested' ? 'SUGGESTED' : 'FINAL'}</span>
        <span style="float:right;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
      </div>
    `;
  },

  /**
   * Get footer template for PDF
   * @returns {string} HTML string
   */
  async getFooterTemplate() {
    return `
      <div style="font-size:8px; padding:3px 8px; color:#9ca3af; width:100%; border-top:1px solid #e5e7eb; text-align:center;">
        <span>Generated on ${format(new Date(), 'dd/MM/yyyy HH:mm')}</span>
        <span style="margin:0 15px;">|</span>
        <span>${COMPANY.name} © ${new Date().getFullYear()}</span>
        <span style="margin:0 15px;">|</span>
        <span>${COMPANY.tagline}</span>
      </div>
    `;
  },

  /**
   * Generate invoice PDF for purchase
   * @param {Object} purchase - Purchase data
   * @returns {Promise<Buffer>} PDF buffer
   */
  async generateInvoicePDF(purchase) {
    // Similar to BOM PDF but for invoices
    // Implementation would be similar but with invoice-specific layout
    throw new ApiError(501, 'Invoice PDF generation not implemented yet');
  },
};