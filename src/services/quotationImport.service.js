// src/services/quotationImport.service.js
import fs from 'fs/promises';
import ExcelJS from 'exceljs';
import mongoose from 'mongoose';
import { Quotation, CompanyProfile } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import logger from '../utils/logger.js';
import {
  parseQuotationNo,
  findQuotationNumberInText,
  normaliseName,
  nameSimilarity,
} from '../utils/quotationNumber.js';
import { buildCompanySnapshot } from '../utils/quotationDefaults.js';
import { uploadToCloudinaryDetailed } from './storage.service.js';
import { LEGACY_REGISTER_ROWS, LEGACY_REGISTER_SOURCE } from '../data/legacyQuotationRegister.js';

/**
 * Quotation import / back-fill.
 *
 * Two independent jobs:
 *  1. Register import - create the historical records from the old Excel sheet
 *     ("SL NO | QUOTATION NO | DETAILS | DATE"). Numbers are taken verbatim;
 *     they are never regenerated.
 *  2. Attachment back-fill - match the old quotation PDFs to those records.
 *     The legacy PDFs are flattened images with no text layer, so the content
 *     cannot be read; matching is by file name and always ends in a human
 *     confirmation step.
 *
 * Both jobs support a dry run which returns the plan without writing anything.
 */

/** Historical records are complete, not drafts. */
const HISTORICAL_STATUS = 'sent';

// ============================================================================
// cell / date parsing helpers
// ============================================================================

/** ExcelJS cell value -> plain string. Handles rich text, formulas and links. */
export const cellText = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text).join('').trim();
    if (value.text !== undefined) return String(value.text).trim();
    if (value.result !== undefined) return cellText(value.result);
    if (value.hyperlink !== undefined) return String(value.hyperlink).trim();
  }
  return String(value).trim();
};

/** Excel serial date (days since 1899-12-30) -> Date */
const fromExcelSerial = (serial) => {
  const days = Number(serial);
  if (!Number.isFinite(days) || days <= 0 || days > 60000) return null;
  const ms = Math.round((days - 25569) * 86400 * 1000);
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * Build a local-midnight date and verify it round-trips.
 * `new Date(2026, 12, 32)` silently rolls over into February 2027, which would
 * turn a typo in the sheet into a real date. Anything that does not come back
 * exactly as written is rejected.
 */
const safeLocalDate = (year, month, day) => {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (year < 1900 || year > 2999) return null;

  const date = new Date(year, month - 1, day);
  const valid =
    date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;

  return valid ? date : null;
};

/**
 * Accept the many shapes a date can arrive in:
 * Date object, "17.06.2026", "17/06/2026", "2026-06-17", "17-06-2026",
 * Excel serial number, or an empty cell.
 * @returns {Date|null} null when there is no date (valid - 12 legacy rows have none)
 */
export const parseSheetDate = (value) => {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  if (typeof value === 'number') return fromExcelSerial(value);

  const raw = String(value).trim();
  if (!raw) return null;

  // dd.mm.yyyy / dd-mm-yyyy / dd/mm/yyyy
  const dmy = raw.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return safeLocalDate(Number(y), Number(m), Number(d));
  }

  // yyyy-mm-dd / yyyy.mm.dd / yyyy/mm/dd
  const ymd = raw.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})$/);
  if (ymd) {
    const [, y, m, d] = ymd;
    return safeLocalDate(Number(y), Number(m), Number(d));
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

// ============================================================================
// sheet reading
// ============================================================================

/** Minimal RFC4180 CSV reader (handles quoted fields containing commas). */
export const parseCsv = (text) => {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => String(cell).trim() !== ''));
};

const HEADER_ALIASES = {
  slNo: ['sl no', 'slno', 'sl number', 'serial', 'serial no', 's no', 'sr no'],
  quotationNo: ['quotation no', 'quotation number', 'quote no', 'quotationno'],
  details: ['details', 'detail', 'customer', 'customer name', 'name', 'consumer'],
  date: ['date', 'quotation date'],
};

const headerIndex = (headers) => {
  const map = {};
  headers.forEach((header, index) => {
    const key = String(header || '').trim().toLowerCase().replace(/\s+/g, ' ');
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.includes(key) && map[field] === undefined) map[field] = index;
    }
  });
  return map;
};

/** Matrix (array of arrays) -> register rows. */
const matrixToRows = (matrix) => {
  if (!Array.isArray(matrix) || matrix.length === 0) return [];

  // Find the header row within the first 5 rows.
  let headerRowIndex = -1;
  let index = {};
  for (let i = 0; i < Math.min(matrix.length, 5); i += 1) {
    const candidate = headerIndex(matrix[i]);
    if (candidate.quotationNo !== undefined || candidate.details !== undefined) {
      headerRowIndex = i;
      index = candidate;
      break;
    }
  }

  const rows = [];
  const start = headerRowIndex === -1 ? 0 : headerRowIndex + 1;

  // Positional fallback when the sheet has no recognisable header.
  const positional = { slNo: 0, quotationNo: 1, details: 2, date: 3 };

  for (let i = start; i < matrix.length; i += 1) {
    const row = matrix[i];
    if (!Array.isArray(row)) continue;

    const pick = (field) => {
      const col = index[field] !== undefined ? index[field] : positional[field];
      return col === undefined ? '' : cellText(row[col]);
    };

    const quotationNo = pick('quotationNo');
    const details = pick('details');
    const rawSl = pick('slNo');
    const rawDate = index.date !== undefined ? row[index.date] : row[positional.date];

    // Rows with neither a number nor a name are the empty numbered filler rows
    // of the legacy sheet (SL 1, 2, 27...163) - skipped silently.
    if (!quotationNo && !details) continue;

    rows.push({
      slNo: Number.parseInt(rawSl, 10) || null,
      quotationNo,
      details,
      date: rawDate,
    });
  }

  return rows;
};

/**
 * Read an uploaded register sheet (.xlsx / .csv) into plain rows.
 * @param {String} filePath
 * @param {String} originalName
 */
export const readRegisterSheet = async (filePath, originalName = '') => {
  const extension = String(originalName).toLowerCase().split('.').pop();

  if (extension === 'csv' || extension === 'txt') {
    const text = await fs.readFile(filePath, 'utf8');
    return matrixToRows(parseCsv(text));
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  // Prefer the sheet whose header mentions the quotation number.
  let sheet = workbook.worksheets.find((ws) => {
    const first = ws.getRow(1);
    const headers = [];
    first.eachCell({ includeEmpty: true }, (cell) => headers.push(cellText(cell.value).toLowerCase()));
    return headers.some((h) => h.includes('quotation'));
  });

  if (!sheet) sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const matrix = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = [];
    // row.values is 1-based; index 0 is unused.
    for (let i = 1; i <= row.cellCount; i += 1) {
      values.push(row.getCell(i).value);
    }
    matrix.push(values);
  });

  return matrixToRows(matrix);
};

// ============================================================================
// register import
// ============================================================================

/**
 * Turn raw rows into a validated plan. Nothing is written here.
 * @returns {{valid:Array, invalid:Array, duplicates:Array, warnings:Array}}
 */
export const buildRegisterPlan = (rawRows = []) => {
  const valid = [];
  const invalid = [];
  const duplicates = [];
  const warnings = [];

  const seenNumbers = new Map();
  const seenSlots = new Map();

  rawRows.forEach((raw, position) => {
    const label = raw?.quotationNo ? `"${String(raw.quotationNo).trim()}"` : `row ${raw?.slNo ?? position + 1}`;

    if (!raw || (!raw.quotationNo && !raw.details)) return;

    const parsed = parseQuotationNo(raw.quotationNo);
    if (!parsed) {
      invalid.push({ ...raw, reason: `Unrecognised quotation number at ${label}` });
      return;
    }

    const details = String(raw.details || '').trim();
    if (!details) {
      invalid.push({ ...raw, quotationNo: parsed.quotationNo, reason: `Missing customer name at ${label}` });
      return;
    }

    const date = parseSheetDate(raw.date);
    if (raw.date && !date) {
      warnings.push({
        quotationNo: parsed.quotationNo,
        message: `Date "${cellText(raw.date)}" could not be read and was imported as blank`,
      });
    }

    const slot = `${parsed.financialYear}#${parsed.seq}`;
    if (seenNumbers.has(parsed.quotationNo)) {
      duplicates.push({ quotationNo: parsed.quotationNo, reason: 'Duplicate number inside the sheet' });
      return;
    }
    if (seenSlots.has(slot)) {
      duplicates.push({
        quotationNo: parsed.quotationNo,
        reason: `Sequence ${parsed.seq} of ${parsed.financialYear} is already used by ${seenSlots.get(slot)}`,
      });
      return;
    }

    seenNumbers.set(parsed.quotationNo, true);
    seenSlots.set(slot, parsed.quotationNo);

    valid.push({
      slNo: Number.isFinite(raw.slNo) ? raw.slNo : null,
      quotationNo: parsed.quotationNo,
      quotationSeq: parsed.seq,
      financialYear: parsed.financialYear,
      schemeCode: parsed.schemeCode,
      customerName: details,
      issueDate: date,
    });
  });

  return { valid, invalid, duplicates, warnings };
};

/**
 * Compare the plan against what is already stored.
 * @returns {Promise<{toCreate:Array, toSkip:Array, conflicts:Array}>}
 */
export const diffAgainstDatabase = async (validRows = []) => {
  const toCreate = [];
  const toSkip = [];
  const conflicts = [];

  if (validRows.length === 0) return { toCreate, toSkip, conflicts };

  const financialYears = [...new Set(validRows.map((row) => row.financialYear))];

  // One query per financial year keeps this simple and index-friendly.
  const existing = await Quotation.find({ financialYear: { $in: financialYears } })
    .select('quotationNo quotationSeq financialYear customerName isActive')
    .lean();

  const byNumber = new Map(existing.map((doc) => [doc.quotationNo, doc]));
  const bySlot = new Map(existing.map((doc) => [`${doc.financialYear}#${doc.quotationSeq}`, doc]));

  for (const row of validRows) {
    const numberHit = byNumber.get(row.quotationNo);
    if (numberHit) {
      (numberHit.isActive ? toSkip : conflicts).push({
        ...row,
        reason: numberHit.isActive
          ? `Already present for "${numberHit.customerName}"`
          : `Exists as a deleted quotation for "${numberHit.customerName}"`,
        existingId: numberHit._id,
      });
      continue;
    }

    const slotHit = bySlot.get(`${row.financialYear}#${row.quotationSeq}`);
    if (slotHit) {
      conflicts.push({
        ...row,
        reason: `Sequence ${row.quotationSeq} of ${row.financialYear} is held by ${slotHit.quotationNo} ("${slotHit.customerName}")`,
        existingId: slotHit._id,
      });
      continue;
    }

    toCreate.push(row);
  }

  return { toCreate, toSkip, conflicts };
};

/**
 * Import register rows.
 * @param {Array} rawRows
 * @param {Object} options { userId, source, dryRun }
 */
export const importRegisterRows = async (rawRows = [], options = {}) => {
  const { userId = null, source = LEGACY_REGISTER_SOURCE, dryRun = false } = options;

  const plan = buildRegisterPlan(rawRows);
  const { toCreate, toSkip, conflicts } = await diffAgainstDatabase(plan.valid);

  const summary = {
    received: rawRows.length,
    valid: plan.valid.length,
    created: 0,
    skipped: toSkip.length,
    conflicts: conflicts.length,
    invalid: plan.invalid.length,
    duplicates: plan.duplicates.length,
    warnings: plan.warnings.length,
  };

  if (dryRun) {
    return {
      dryRun: true,
      source,
      summary,
      toCreate,
      toSkip,
      conflicts,
      invalid: plan.invalid,
      duplicates: plan.duplicates,
      warnings: plan.warnings,
      nextNumberAfterImport: await previewSequenceAfter(plan.valid),
    };
  }

  if (toCreate.length > 0) {
    const profile = await CompanyProfile.getProfile();
    const companySnapshot = buildCompanySnapshot(profile);
    const now = new Date();

    const documents = toCreate.map((row) => ({
      quotationNo: row.quotationNo,
      quotationSeq: row.quotationSeq,
      financialYear: row.financialYear,
      schemeCode: row.schemeCode,
      schemeLabel: (profile.schemes || []).find((s) => s.code === row.schemeCode)?.label || '',
      customerName: row.customerName,
      issueDate: row.issueDate,
      status: HISTORICAL_STATUS,
      items: [],
      terms: [],
      paymentTerms: [],
      amount: null,
      amountInWords: '',
      companySnapshot,
      isHistorical: true,
      importedFrom: source,
      importedAt: now,
      importedSlNo: row.slNo,
      notes: `Imported from ${source} (register record - BOQ and amount not recorded)`,
      createdBy: userId,
      updatedBy: userId,
    }));

    // ordered:false so one unexpected duplicate does not abort the whole batch
    try {
      const created = await Quotation.insertMany(documents, { ordered: false });
      summary.created = created.length;
    } catch (error) {
      const insertedCount = error?.insertedDocs?.length ?? 0;
      summary.created = insertedCount;
      const writeErrors = error?.writeErrors ?? [];
      for (const writeError of writeErrors) {
        const failed = documents[writeError.index];
        conflicts.push({
          quotationNo: failed?.quotationNo,
          customerName: failed?.customerName,
          reason: 'Rejected by the database (number or sequence already in use)',
        });
      }
      summary.conflicts = conflicts.length;
      if (insertedCount === 0) {
        logger.error('Quotation register import failed:', error);
        throw ApiError.conflict('No rows could be imported. Run a dry run to see the conflicts.');
      }
      logger.warn(`Quotation register import: ${insertedCount} created, ${writeErrors.length} rejected`);
    }
  }

  logger.info(
    `Quotation register imported from ${source}: ${summary.created} created, ${summary.skipped} skipped, ${summary.conflicts} conflicts`
  );

  return {
    dryRun: false,
    source,
    summary,
    created: summary.created,
    toSkip,
    conflicts,
    invalid: plan.invalid,
    duplicates: plan.duplicates,
    warnings: plan.warnings,
    nextNumberAfterImport: await previewSequenceAfter(plan.valid),
  };
};

/** Highest sequence that will remain in use, and therefore the next number. */
const previewSequenceAfter = async (validRows = []) => {
  if (validRows.length === 0) {
    return { financialYear: null, nextSequence: null, nextNumber: null };
  }

  const byYear = new Map();
  for (const row of validRows) {
    byYear.set(row.financialYear, Math.max(byYear.get(row.financialYear) || 0, row.quotationSeq));
  }

  const profile = await CompanyProfile.getProfile();
  const result = {};

  for (const [financialYear, maxInSheet] of byYear.entries()) {
    const maxStored = await Quotation.getMaxSequence(financialYear);
    const maxSequence = Math.max(maxInSheet, maxStored);
    result[financialYear] = {
      financialYear,
      maxSequence,
      nextSequence: maxSequence + 1,
      nextNumber: `${profile.quotationNumberPrefix || 'SE'}/${profile.defaultSchemeCode || 'PMSGY'}/${financialYear}/${maxSequence + 1}`,
    };
  }

  const first = Object.values(result)[0] || { financialYear: null, nextSequence: null, nextNumber: null };
  return first;
};

// ============================================================================
// attachment back-fill
// ============================================================================

/**
 * Match uploaded files to register records.
 *
 * Priority: quotation number in the file name (exact) -> customer name (exact)
 * -> fuzzy name (needs review) -> unmatched. Nothing is attached here; the
 * caller confirms the matches.
 */
export const matchAttachmentsToQuotations = async (files = [], options = {}) => {
  const { financialYear = null, minScore = 0.5 } = options;

  const filter = { isActive: true };
  if (financialYear) filter.financialYear = financialYear;

  const quotations = await Quotation.find(filter)
    .select('quotationNo quotationSeq financialYear schemeCode customerName issueDate isHistorical')
    .limit(5000)
    .lean();

  const bySlot = new Map(quotations.map((q) => [`${q.financialYear}#${q.quotationSeq}`, q]));
  const byNumber = new Map(quotations.map((q) => [q.quotationNo, q]));

  return files.map((file) => {
    const originalName = file.originalname || '';
    const base = { fileName: originalName, size: file.size ?? null, mimeType: file.mimetype || '', path: file.path };

    // 1. number inside the file name
    const detected = findQuotationNumberInText(originalName);
    if (detected) {
      const direct = detected.prefix
        ? byNumber.get(`${detected.prefix}/${detected.schemeCode}/${detected.financialYear}/${detected.seq}`)
        : null;
      const slot = detected.financialYear
        ? bySlot.get(`${detected.financialYear}#${detected.seq}`)
        : null;
      const hit = direct || slot;

      if (hit) {
        return {
          ...base,
          detectedNumber: `${hit.quotationNo}`,
          matchType: 'number',
          confidence: 1,
          quotation: {
            id: hit._id,
            quotationNo: hit.quotationNo,
            customerName: hit.customerName,
            issueDate: hit.issueDate,
            isHistorical: Boolean(hit.isHistorical),
          },
          candidates: [],
        };
      }

      return {
        ...base,
        detectedNumber: detected.financialYear
          ? `SE/${detected.schemeCode || '?'}/${detected.financialYear}/${detected.seq}`
          : null,
        matchType: 'none',
        confidence: 0,
        quotation: null,
        candidates: [],
        reason: 'The file name contains a quotation number that is not in the register',
      };
    }

    // 2 + 3. name based matching
    const scored = quotations
      .map((q) => ({ q, score: nameSimilarity(originalName, q.customerName) }))
      .filter((entry) => entry.score >= minScore)
      .sort((a, b) => b.score - a.score);

    if (scored.length > 0) {
      const best = scored[0];
      const exact = normaliseName(originalName) === normaliseName(best.q.customerName);

      return {
        ...base,
        detectedNumber: null,
        matchType: exact ? 'name' : 'fuzzy',
        confidence: exact ? 0.9 : Number(best.score.toFixed(2)),
        quotation: {
          id: best.q._id,
          quotationNo: best.q.quotationNo,
          customerName: best.q.customerName,
          issueDate: best.q.issueDate,
          isHistorical: Boolean(best.q.isHistorical),
        },
        candidates: scored.slice(0, 3).map((entry) => ({
          id: entry.q._id,
          quotationNo: entry.q.quotationNo,
          customerName: entry.q.customerName,
          score: Number(entry.score.toFixed(2)),
        })),
      };
    }

    return {
      ...base,
      detectedNumber: null,
      matchType: 'none',
      confidence: 0,
      quotation: null,
      candidates: [],
      reason: 'No register record matched this file name',
    };
  });
};

/**
 * Upload the files and return matches plus the stored location, without
 * attaching anything yet.
 */
export const stageAttachments = async (files = [], options = {}) => {
  const matches = await matchAttachmentsToQuotations(files, options);
  const results = [];

  for (const match of matches) {
    // The temp path is a server detail and must never leave the API.
    const { path: tempPath, ...safeMatch } = match;

    let uploaded = null;
    try {
      uploaded = await uploadToCloudinaryDetailed(
        { path: tempPath, originalname: match.fileName },
        { folder: 'quotations/import' }
      );
    } catch (error) {
      logger.error(`Attachment upload failed for ${match.fileName}:`, error);
      results.push({ ...safeMatch, uploaded: false, uploadError: 'The file could not be stored' });
      continue;
    }

    results.push({
      ...safeMatch,
      uploaded: true,
      url: uploaded.url,
      publicId: uploaded.publicId,
      fileSize: uploaded.bytes ?? match.size,
    });
  }

  return {
    dryRun: true,
    files: results,
    summary: {
      received: results.length,
      uploaded: results.filter((r) => r.uploaded).length,
      exactMatches: results.filter((r) => r.matchType === 'number' || r.matchType === 'name').length,
      needsReview: results.filter((r) => r.matchType === 'fuzzy').length,
      unmatched: results.filter((r) => r.matchType === 'none').length,
    },
    note: 'Nothing was attached yet. Review the matches and confirm to attach them.',
  };
};

/**
 * Attach previously staged files to their quotations.
 * @param {Array} items [{ quotationId, url, publicId, fileName, fileSize, mimeType, kind }]
 */
export const confirmAttachments = async (items = [], options = {}) => {
  const { userId = null } = options;
  const applied = [];
  const failed = [];

  for (const item of items) {
    if (!item?.quotationId || !mongoose.isValidObjectId(item.quotationId) || !item.url) {
      failed.push({ ...item, reason: 'A quotation and a stored file URL are required' });
      continue;
    }

    const quotation = await Quotation.findById(item.quotationId);
    if (!quotation) {
      failed.push({ ...item, reason: 'Quotation not found' });
      continue;
    }
    if (quotation.isActive === false) {
      failed.push({ ...item, reason: 'Quotation is deleted' });
      continue;
    }

    const duplicate = quotation.attachments.some((a) => a.url === item.url);
    if (duplicate) {
      failed.push({ ...item, reason: 'This file is already attached' });
      continue;
    }

    quotation.attachments.push({
      kind: item.kind || 'original_manual',
      url: item.url,
      publicId: item.publicId || null,
      fileName: item.fileName || '',
      fileSize: item.fileSize ?? null,
      mimeType: item.mimeType || '',
      uploadedAt: new Date(),
      uploadedBy: userId,
    });
    quotation.updatedBy = userId;
    await quotation.save();

    applied.push({ quotationId: quotation._id, quotationNo: quotation.quotationNo, fileName: item.fileName });
  }

  logger.info(`Quotation attachments confirmed: ${applied.length} attached, ${failed.length} failed`);

  return {
    attached: applied.length,
    failed: failed.length,
    applied,
    failures: failed,
  };
};

export const quotationImportService = {
  cellText,
  parseSheetDate,
  parseCsv,
  readRegisterSheet,
  buildRegisterPlan,
  diffAgainstDatabase,
  importRegisterRows,
  matchAttachmentsToQuotations,
  stageAttachments,
  confirmAttachments,
  LEGACY_REGISTER_ROWS,
  LEGACY_REGISTER_SOURCE,
};

export default quotationImportService;
