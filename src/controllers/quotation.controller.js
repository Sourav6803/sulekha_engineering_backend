// src/controllers/quotation.controller.js
import { ApiResponse } from '../utils/ApiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import { quotationService } from '../services/quotation.service.js';
import { quotationImportService } from '../services/quotationImport.service.js';
import { quotationPdfService } from '../services/quotationPdf.service.js';
import logger from '../utils/logger.js';

/**
 * Quotation controller - thin HTTP layer over quotationService.
 * All business rules (numbering, limits, soft delete rules) live in the service.
 */

/**
 * GET /api/v1/quotations/defaults
 * The fixed terms / payment terms plus the sizing and scheme defaults, so the
 * form shows exactly what the document will print.
 */
export const getDefaults = async (req, res) => {
  const defaults = await quotationService.getDefaults();
  return ApiResponse.send(res, defaults, 'Quotation defaults fetched');
};

/** GET /api/v1/quotations/next-number */
export const getNextNumber = async (req, res) => {
  const result = await quotationService.previewNextNumber({
    schemeCode: req.query.schemeCode,
    issueDate: req.query.issueDate,
  });

  return ApiResponse.send(res, result, 'Next quotation number');
};

/** GET /api/v1/quotations */
export const listQuotations = async (req, res) => {
  const { items, pagination } = await quotationService.listQuotations(req.query);

  return ApiResponse.sendPaginated(res, items, pagination, 'Quotations fetched');
};

/** GET /api/v1/quotations/register */
export const getRegister = async (req, res) => {
  const { rows, pagination } = await quotationService.getRegister(req.query);

  // The "next number will be …" banner is served by GET /quotations/next-number.
  return ApiResponse.sendPaginated(res, rows, pagination, 'Quotation register fetched');
};

/** GET /api/v1/quotations/stats */
export const getStats = async (req, res) => {
  const stats = await quotationService.getStats(req.query);

  return ApiResponse.send(res, stats, 'Quotation statistics');
};

/** POST /api/v1/quotations */
export const createQuotation = async (req, res) => {
  const { quotation } = await quotationService.createQuotation(req.body, req.user?._id ?? null);

  return ApiResponse.sendCreated(res, quotation, `Quotation created: ${quotation.quotationNo}`);
};

/** GET /api/v1/quotations/:id */
export const getQuotation = async (req, res) => {
  const includeDeleted = req.query.includeDeleted === 'true' || req.query.includeDeleted === true;
  const quotation = await quotationService.getQuotationById(req.params.id, { includeDeleted });

  return ApiResponse.send(res, quotation, 'Quotation fetched');
};

/** PUT /api/v1/quotations/:id */
export const updateQuotation = async (req, res) => {
  const result = await quotationService.updateQuotation(req.params.id, req.body, req.user?._id ?? null);

  return ApiResponse.send(
    res,
    { quotation: result.quotation, changedFields: result.changedFields, warnings: result.warnings },
    result.message
  );
};

/** PATCH /api/v1/quotations/:id/status */
export const changeStatus = async (req, res) => {
  const result = await quotationService.changeStatus(req.params.id, req.body.status, req.user?._id ?? null);

  return ApiResponse.send(res, result.quotation, result.message);
};

/** DELETE /api/v1/quotations/:id — soft delete */
export const deleteQuotation = async (req, res) => {
  const reason = req.body?.reason || '';
  const result = await quotationService.deleteQuotation(req.params.id, req.user?._id ?? null, reason);

  return ApiResponse.send(
    res,
    {
      quotation: result.quotation,
      numberFreed: result.numberFreed,
      deletedSequence: result.deletedSequence,
      nextSequence: result.nextSequence,
      financialYear: result.financialYear,
    },
    result.message
  );
};

/** POST /api/v1/quotations/:id/restore */
export const restoreQuotation = async (req, res) => {
  const result = await quotationService.restoreQuotation(req.params.id, req.user?._id ?? null, {
    assignNewNumber: req.body?.assignNewNumber === true,
  });

  return ApiResponse.send(
    res,
    { quotation: result.quotation, reassigned: result.reassigned, previousNumber: result.previousNumber },
    result.message
  );
};

/** POST /api/v1/quotations/:id/attachments */
export const addAttachment = async (req, res) => {
  if (!req.file) {
    throw ApiError.badRequest('A file is required. Send it as the "file" field.');
  }

  const attachment = await quotationService.addAttachment(
    req.params.id,
    req.file,
    req.body?.kind || 'original_manual',
    req.user?._id ?? null
  );

  return ApiResponse.sendCreated(res, attachment, 'Attachment uploaded');
};

/** DELETE /api/v1/quotations/:id/attachments/:attachmentId */
export const removeAttachment = async (req, res) => {
  const result = await quotationService.removeAttachment(
    req.params.id,
    req.params.attachmentId,
    req.user?._id ?? null
  );

  return ApiResponse.send(res, result, 'Attachment removed');
};

// ===========================================================================
// Document (PDF / print)
// ===========================================================================

/**
 * GET /api/v1/quotations/:id/pdf
 * One A4 page. `?inline=1` displays it in the browser instead of downloading.
 */
export const getQuotationPdf = async (req, res) => {
  const quotation = await quotationService.getQuotationById(req.params.id);
  const inline = req.query.inline === 'true' || req.query.inline === '1' || req.query.inline === true;

  const { buffer, fontSize, contentHeightPx } = await quotationPdfService.renderQuotationPdf(
    quotation.toObject({ virtuals: true })
  );

  const pages = quotationPdfService.countPdfPages(buffer);
  if (pages !== 1) {
    // The height measurement should have prevented this; log it so a layout
    // regression is visible instead of silently shipping a two page quotation.
    logger.error(`Quotation ${quotation.quotationNo} rendered ${pages} pages at ${fontSize}pt`);
  }

  const fileName = `${quotation.quotationNo.replace(/[/\\]/g, '-')}-${quotation.customerName}`
    .replace(/[^\w.\- ]+/g, '')
    .slice(0, 120);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${fileName}.pdf"`);
  res.setHeader('Content-Length', buffer.length);
  res.setHeader('X-Document-Pages', String(pages));
  res.setHeader('X-Document-Font-Size', String(fontSize));
  res.setHeader('X-Document-Height-Px', String(contentHeightPx));

  return res.send(buffer);
};

/**
 * GET /api/v1/quotations/:id/print
 * The same markup as the PDF, served as HTML for the print / preview frame.
 */
export const printQuotation = async (req, res) => {
  const quotation = await quotationService.getQuotationById(req.params.id);
  const html = await quotationPdfService.renderQuotationHtml(quotation.toObject({ virtuals: true }), {
    includeToolbar: req.query.toolbar !== 'false',
  });

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  return res.send(html);
};

// ===========================================================================
// Import / back-fill (admin only)
// ===========================================================================

/**
 * POST /api/v1/quotations/import/register
 * Accepts either an uploaded sheet (.xlsx / .csv in the "file" field), an
 * explicit `rows` array, or `useLegacy: true` for the built-in 24 rows.
 * dryRun defaults to true - nothing is written unless dryRun=false is sent.
 */
export const importRegister = async (req, res) => {
  const { dryRun = true, useLegacy = false, source, rows } = req.body || {};

  let rawRows = [];
  let usedSource = source;
  let sheetRows = null;

  if (req.file) {
    sheetRows = await quotationImportService.readRegisterSheet(req.file.path, req.file.originalname);
    rawRows = sheetRows;
    usedSource = usedSource || req.file.originalname;
  }

  if (Array.isArray(rows) && rows.length > 0) {
    rawRows = rows;
    usedSource = usedSource || 'API payload';
  }

  if (!req.file && (!Array.isArray(rows) || rows.length === 0) && useLegacy) {
    rawRows = quotationImportService.LEGACY_REGISTER_ROWS;
    usedSource = usedSource || quotationImportService.LEGACY_REGISTER_SOURCE;
  }

  if (rawRows.length === 0) {
    throw ApiError.badRequest(
      'Nothing to import. Upload a register sheet, send a rows array, or set useLegacy=true.'
    );
  }

  const result = await quotationImportService.importRegisterRows(rawRows, {
    userId: req.user?._id ?? null,
    source: usedSource,
    dryRun: dryRun !== false && dryRun !== 'false',
  });

  return ApiResponse.send(
    res,
    result,
    result.dryRun
      ? `Dry run: ${result.summary.valid} valid rows, ${result.summary.conflicts} conflicts. Nothing was written.`
      : `Register import finished: ${result.summary.created} created, ${result.summary.skipped} skipped`
  );
};

/**
 * POST /api/v1/quotations/import/attachments
 * Uploads the old quotation PDFs and returns the proposed matches. Files are
 * stored but NOT attached - call /import/confirm with the accepted matches.
 * Max 10 files per request (upload limits); batch larger sets.
 */
export const importAttachments = async (req, res) => {
  const files = Array.isArray(req.files) ? req.files : req.file ? [req.file] : [];
  if (files.length === 0) {
    throw ApiError.badRequest('No files received. Send them in the "files" field.');
  }

  const result = await quotationImportService.stageAttachments(files, {
    financialYear: req.query.financialYear || null,
    minScore: req.query.minScore !== undefined ? Number(req.query.minScore) : 0.5,
  });

  return ApiResponse.send(
    res,
    result,
    `${result.summary.exactMatches} matched automatically, ${result.summary.needsReview} need review, ${result.summary.unmatched} unmatched`
  );
};

/** POST /api/v1/quotations/import/confirm - attach the reviewed matches */
export const confirmImport = async (req, res) => {
  const result = await quotationImportService.confirmAttachments(req.body.attachments, {
    userId: req.user?._id ?? null,
  });

  return ApiResponse.send(res, result, `${result.attached} attachment(s) linked to quotations`);
};

export default {
  getDefaults,
  getNextNumber,
  getQuotationPdf,
  printQuotation,
  importRegister,
  importAttachments,
  confirmImport,
  listQuotations,
  getRegister,
  getStats,
  createQuotation,
  getQuotation,
  updateQuotation,
  changeStatus,
  deleteQuotation,
  restoreQuotation,
  addAttachment,
  removeAttachment,
};
