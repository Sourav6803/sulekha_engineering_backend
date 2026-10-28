// scripts/backfill-quotation-format-remaining.js
/**
 * Back-fill the quotations in "Quotation Formet.xlsx" that were not part of the
 * first pass: sheets 48-55, plus the two business sheets that were never drawn up
 * (46 Kurmitar Thejo Solutions, 47 Raipur Thejo Solutions), which are created as
 * placeholders so the register has no gap.
 *
 * The first pass (scripts/backfill-quotation-format.js) transcribed 16-45 by hand.
 * This one reads the remaining sheets instead of copying numbers into the file, and
 * prints exactly what it read before writing anything:
 *
 *   node scripts/backfill-quotation-format-remaining.js           # dry run
 *   node scripts/backfill-quotation-format-remaining.js --commit  # writes
 *
 * Numbers are used exactly as the sheet writes them. The year in the number must
 * agree with the issue date, which the service checks.
 */
import dns from 'node:dns';
import path from 'node:path';
import os from 'node:os';
import ExcelJS from 'exceljs';
import mongoose from 'mongoose';
import config from '../src/config/env.js';
import { Quotation, User } from '../src/models/index.js';
import { quotationService } from '../src/services/quotation.service.js';

/* A mongodb+srv:// URI needs an SRV lookup and c-ares intermittently refuses it
   on this machine. Public resolvers answer reliably. */
dns.setServers(['1.1.1.1', '8.8.8.8', '9.9.9.9']);

const COMMIT = process.argv.includes('--commit');
const SHEET_SOURCE = 'Quotation Formet.xlsx';
const FILE =
  process.argv.find((arg) => arg.endsWith('.xlsx')) ||
  path.join(os.homedir(), 'Downloads', 'Quotation Formet.xlsx');

/** Sheets whose number is 48..55; everything else was handled in the first pass. */
const TARGET_SEQ = [48, 49, 50, 51, 52, 53, 54, 55];

// ---------------------------------------------------------------- cell reading

const text = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text).join('');
    if (value.text !== undefined) return String(value.text);
    if (value.result !== undefined) return String(value.result);
    if (value instanceof Date) return value.toISOString();
    return '';
  }
  return String(value);
};

const number = (value) => {
  const raw = text(value).replace(/[^0-9.]/g, '');
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

/** "5 or 6" -> 6; "5 nos" -> 5. The sheet's wording stays in the description. */
const quantity = (value) => {
  const matches = text(value).match(/\d+(?:\.\d+)?/g);
  if (!matches) return null;
  return Number(matches[matches.length - 1]);
};

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * "05 Oct 2026" -> "2026-10-05", read by hand.
 *
 * `new Date()` treats the sheet's date as local midnight, and `.toISOString()`
 * reports the day *before* in IST — every quotation would land one day early.
 */
const parseSheetDate = (raw) => {
  const value = text(raw).replace(/^date:?\s*/i, '').trim();
  const match = value.match(/^(\d{1,2})[\s./-]+([A-Za-z]{3,})[\s./-]+(\d{4})$/);
  if (match) {
    const month = MONTHS.indexOf(match[2].slice(0, 3).toLowerCase());
    if (month === -1) return null;
    return `${match[3]}-${String(month + 1).padStart(2, '0')}-${String(Number(match[1])).padStart(2, '0')}`;
  }
  const fallback = new Date(value);
  if (Number.isNaN(fallback.getTime())) return null;
  return `${fallback.getFullYear()}-${String(fallback.getMonth() + 1).padStart(2, '0')}-${String(
    fallback.getDate()
  ).padStart(2, '0')}`;
};

// -------------------------------------------------------------------- parsing

const parseSheet = (worksheet) => {
  const rows = [];
  for (let r = 1; r <= worksheet.rowCount; r += 1) {
    const row = worksheet.getRow(r);
    const cells = [];
    for (let c = 1; c <= Math.max(worksheet.columnCount, 9); c += 1) {
      cells.push(text(row.getCell(c).value).replace(/\s+/g, ' ').trim());
    }
    rows.push(cells);
  }

  const flat = rows.map((cells) => cells.join(' | '));

  // Number and date share the "Quote No:" line on every sheet.
  const noMatch = flat.join('\n').match(/SE\/[A-Z0-9]{2,12}\/\d{4}-\d{2}\/\d{1,6}/);
  const quotationNo = noMatch ? noMatch[0] : '';
  const dateMatch = flat.join('\n').match(/Date:\s*([0-9]{1,2}\s+[A-Za-z]+\s+[0-9]{4})/i);
  const issueDate = dateMatch ? parseSheetDate(dateMatch[1]) : null;

  // The consumer block: name, "Consumer ID :", the address carrying the PIN, phone.
  const billTo = rows.findIndex((cells) => cells.some((cell) => /BILL TO/i.test(cell)));
  const block = rows.slice(billTo + 1, billTo + 7).map((cells) => cells[0]).filter(Boolean);
  const consumerId = (flat.join('\n').match(/Consumer\s*ID\s*:?\s*([0-9]{6,})/i) || [])[1] || '';
  /*
   * The phone must come from the consumer's own line. Scanning for "the first
   * 10-digit number on the sheet" finds the company's own number in the letterhead
   * — every quotation came out with 9832117393 on it.
   */
  const companyPhoneLine = flat.find((line) => /sulekhaengineering@gmail\.com/i.test(line)) || '';
  const phoneMatch = flat.join('\n').match(/Phone\s*No\.?\s*[-:]\s*([6-9][0-9]{9})/i);
  const customerName = block.find((line) => !/consumer\s*id/i.test(line) && !/^\d{10}$/.test(line) && !/pin\s*-?\s*\d{6}/i.test(line)) || '';
  const addressLine = block.find((line) => /pin\s*-?\s*\d{6}/i.test(line)) || block[2] || '';
  // Older sheets end the address with "Pin- 713408", newer ones with just ", 713166".
  const pincode = (addressLine.match(/pin\s*-?\s*(\d{6})\s*$/i) || addressLine.match(/[\s,](\d{6})\s*$/) || [])[1] || '';
  const addressLine1 = addressLine
    .replace(/,?\s*pin\s*-?\s*\d{6}\s*$/i, '')
    .replace(/[\s,]*\b\d{6}\s*$/, '')
    .replace(/[\s,]+$/, '')
    .trim();

  // BOQ: header row says DESCRIPTION, the block ends at TOTAL.
  const headerRow = rows.findIndex((cells) => /^description$/i.test(cells[0]));
  const items = [];
  let total = null;
  for (let r = headerRow + 1; r < rows.length; r += 1) {
    const cells = rows[r];
    if (/^total/i.test(cells[0])) {
      total = number(cells[4]) ?? total;
      break;
    }
    if (!cells[0]) continue;
    items.push({
      description: cells[0],
      brandModel: cells[1] || '',
      qty: quantity(cells[2]),
      unit: cells[3] ? cells[3].toLowerCase() : null,
      amount: number(cells[4]),
    });
  }

  const moduleLine = items[0] || {};
  const inverterLine = items[1] || {};
  const structureLine = items[2] || {};

  const panelWp = Number(((moduleLine.description || '').match(/(\d{3})\s*wp/i) || [])[1]) || null;

  const kwFromModule = Number(((moduleLine.description || '').match(/(\d+(?:\.\d+)?)\s*kw/i) || [])[1]) || null;
  const kwFromInverter = Number(((inverterLine.description || '').match(/capacity:?\s*(\d+(?:\.\d+)?)\s*kw/i) || [])[1]) || null;
  const systemSizeKW =
    kwFromModule ||
    (panelWp && moduleLine.qty ? Number(((panelWp * moduleLine.qty) / 1000).toFixed(2)) : null) ||
    kwFromInverter;

  /*
   * The newer sheets print the module line without a quantity — the size and the
   * wattage are the only numbers present, so the count is derived from them. It is
   * flagged in the dry-run table as `*` because it is arithmetic, not a figure read
   * off the sheet.
   */
  let panelQty = moduleLine.qty ?? null;
  let panelQtyDerived = false;
  if (!panelQty && systemSizeKW && panelWp) {
    panelQty = Math.round((systemSizeKW * 1000) / panelWp);
    panelQtyDerived = true;
  }
  if (!moduleLine.qty && panelQty) moduleLine.qty = panelQty;

  const structureText = `${structureLine.description} ${structureLine.brandModel}`.toLowerCase();
  const structureType = /tin\s*shed/.test(structureText)
    ? 'tin_shed'
    : /high[\s-]*ri[cs]e/.test(structureText)
      ? 'high_rise'
      : 'rcc_rooftop';

  const quotationSeq = Number((quotationNo.match(/\/(\d{1,6})$/) || [])[1]) || null;

  return {
    sheet: worksheet.name.trim(),
    quotationNo,
    quotationSeq,
    issueDate,
    customerName,
    consumerId,
    phone: phoneMatch ? phoneMatch[1] : '',
    companyPhone: companyPhoneLine,
    addressLine1,
    addressLine2: '',
    pincode,
    systemSizeKW,
    panelWp,
    panelQty,
    panelQtyDerived,
    panelBrand: moduleLine.brandModel || '',
    inverterCapacityKW: kwFromInverter || systemSizeKW,
    inverterBrand: inverterLine.brandModel || '',
    structureType,
    amount: total,
    items,
  };
};

// ------------------------------------------------------- the two business placeholders

/**
 * 46 and 47 are business quotations that have not been drawn up yet. They are
 * created so the serial register has no hole, with the lines a project sheet
 * carries and no money on them — a placeholder that says "fill me in" is honest;
 * an invented price is not. Draft status keeps them out of the sent register.
 */
const placeholder = ({ no, scheme, name }) => ({
  quotationNo: no,
  quotationType: 'partner',
  schemeCode: scheme,
  issueDate: '2026-10-03',
  customerName: name,
  consumerId: '',
  phoneNo: '',
  addressLine1: '',
  addressLine2: '',
  pincode: '',
  systemSizeKW: null,
  amount: 0,
  amountIncludesGST: false,
  status: 'draft',
  notes: 'Placeholder — sample lines only, to be filled in from the signed quotation.',
  items: [
    { description: 'Solar PV Module', brandModel: '', specification: '', unit: 'kwp', qty: 1 },
    { description: 'Module Mounting Structure with all accessories', brandModel: '', specification: '', unit: 'kwp', qty: 1 },
    { description: 'Grid-tied Inverter with data logger', brandModel: '', specification: '', unit: 'nos', qty: 1 },
    { description: 'BOS: ACDB, cables, earthing, lightning arrestor', brandModel: '', specification: '', unit: 'set', qty: 1 },
    { description: 'Installation, testing & commissioning', brandModel: '', specification: '', unit: 'job', qty: 1 },
  ],
});

const PLACEHOLDERS = [
  placeholder({ no: 'SE/MBECL/2026-27/46', scheme: 'MBECL', name: 'Kurmitar Thejo Solutions' }),
  placeholder({ no: 'SE/MBECL/2026-27/47', scheme: 'MBECL', name: 'Raipur Thejo Solutions' }),
];

// ------------------------------------------------------------------------ run

const toPayload = (sheet) => ({
  quotationNo: sheet.quotationNo,
  quotationType: 'consumer',
  schemeCode: (sheet.quotationNo.split('/')[1] || 'PMSGY').toUpperCase(),
  issueDate: sheet.issueDate,
  customerName: sheet.customerName,
  consumerId: sheet.consumerId,
  phoneNo: sheet.phone,
  addressLine1: sheet.addressLine1,
  addressLine2: sheet.addressLine2,
  pincode: sheet.pincode,
  systemSizeKW: sheet.systemSizeKW,
  panelWp: sheet.panelWp,
  panelQty: sheet.panelQty,
  panelBrand: sheet.panelBrand,
  inverterCapacityKW: sheet.inverterCapacityKW,
  inverterBrand: sheet.inverterBrand,
  structureType: sheet.structureType,
  amount: sheet.amount,
  amountIncludesGST: true,
  status: 'sent',
  notes: `Back-filled from ${SHEET_SOURCE} (sheet: ${sheet.sheet})`,
  /*
   * The domestic sheet merges one figure down the AMOUNT column, so every line
   * reads 220000. The number belongs to the quotation, not to each line — the
   * existing back-filled records store `amount: null` per line for exactly this
   * reason, and the printer merges the total across the section.
   */
  items: sheet.items.map((item, index) => ({ ...item, amount: null, order: index + 1 })),
});

const run = async () => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(FILE);

  const parsed = workbook.worksheets.map(parseSheet).filter((sheet) => TARGET_SEQ.includes(sheet.quotationSeq));
  console.log(`file: ${FILE}`);
  console.log(`read ${workbook.worksheets.length} sheets, ${parsed.length} in the 48-55 range\n`);

  console.log('no                       | date       | kw    | panel        | Rs        | name');
  console.log('-'.repeat(118));
  for (const sheet of parsed) {
    const panel = `${sheet.panelQty ?? '?'}${sheet.panelQtyDerived ? '*' : ''} x ${sheet.panelWp ?? '?'} ${sheet.panelBrand}`;
    console.log(
      `${sheet.quotationNo.padEnd(24)} | ${String(sheet.issueDate).padEnd(10)} | ${String(sheet.systemSizeKW).padEnd(5)} | ` +
        `${String(panel).slice(0, 18).padEnd(18)} | ` +
        `${String(sheet.amount).padEnd(9)} | ${sheet.customerName} (${sheet.items.length} lines)`
    );
  }

  const missingDate = parsed.filter((sheet) => !sheet.issueDate);
  if (missingDate.length) {
    console.log(`\nWARNING: no date read for ${missingDate.map((s) => s.sheet).join(', ')}`);
  }

  if (process.argv.includes('--show')) {
    // Full records for a line-by-line read against the sheets, before committing.
    console.log(JSON.stringify(parsed.map(toPayload), null, 1));
  }

  const payloads = [...parsed.map(toPayload), ...PLACEHOLDERS];
  console.log(`\n${payloads.length} record(s) to write (${parsed.length} from sheets, ${PLACEHOLDERS.length} placeholder)`);

  await mongoose.connect(config.MONGO_URI, { serverSelectionTimeoutMS: 20000 });

  const admin = await User.findOne({ role: 'admin' }).sort({ createdAt: 1 }).lean();
  if (!admin) throw new Error('No admin user found — nothing can be created.');
  console.log(`acting as: ${admin.name} <${admin.email}>`);

  if (!COMMIT) {
    console.log('\nDRY RUN — nothing written. Re-run with --commit.');
    await mongoose.disconnect();
    return;
  }

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const payload of payloads) {
    // eslint-disable-next-line no-await-in-loop
    const existing = await Quotation.findOne({ quotationNo: payload.quotationNo, isActive: true }).lean();
    if (existing) {
      console.log(`SKIP    ${payload.quotationNo} — live record already exists`);
      skipped += 1;
      continue;
    }

    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await quotationService.createQuotation(payload, admin);
      const doc = result?.quotation ?? result ?? {};
      console.log(`CREATED ${doc.quotationNo || payload.quotationNo} — ${doc.customerName || payload.customerName}`);
      created += 1;
    } catch (error) {
      console.log(`FAILED  ${payload.quotationNo} — ${error.message}`);
      failed += 1;
    }
  }

  console.log(`\ncreated ${created} · skipped ${skipped} · failed ${failed}`);
  await mongoose.disconnect();
  if (failed) process.exit(1);
};

run().catch(async (error) => {
  console.error('FAILED:', error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
