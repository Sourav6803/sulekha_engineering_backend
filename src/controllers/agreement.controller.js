// src/controllers/agreement.controller.js
import { ApiResponse } from '../utils/ApiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import logger from '../utils/logger.js';
import { agreementService } from '../services/agreement.service.js';
import { agreementPdfService } from '../services/agreementPdf.service.js';

/**
 * Agreement controller - thin HTTP layer. All rules live in agreementService.
 */

/** GET /api/v1/agreements/defaults */
export const getDefaults = async (req, res) => {
  const defaults = await agreementService.getDefaults();
  return ApiResponse.send(res, defaults, 'Agreement defaults fetched');
};

/** GET /api/v1/agreements */
export const listAgreements = async (req, res) => {
  const { items, pagination } = await agreementService.listAgreements(req.query);
  return ApiResponse.sendPaginated(res, items, pagination, 'Agreements fetched');
};

/** POST /api/v1/agreements */
export const createAgreement = async (req, res) => {
  const agreement = await agreementService.createAgreement(req.body, req.user?._id ?? null);
  return ApiResponse.sendCreated(res, agreement, `Agreement created for ${agreement.consumerName}`);
};

/** GET /api/v1/agreements/:id */
export const getAgreement = async (req, res) => {
  const agreement = await agreementService.getAgreementById(req.params.id);
  return ApiResponse.send(res, agreement, 'Agreement fetched');
};

/** PUT /api/v1/agreements/:id */
export const updateAgreement = async (req, res) => {
  const { agreement, changedFields } = await agreementService.updateAgreement(
    req.params.id,
    req.body,
    req.user?._id ?? null
  );

  return ApiResponse.send(
    res,
    { agreement, changedFields },
    changedFields.length > 0
      ? `Agreement updated (${changedFields.join(', ')})`
      : 'Agreement saved with no changes'
  );
};

/** DELETE /api/v1/agreements/:id */
export const deleteAgreement = async (req, res) => {
  const result = await agreementService.deleteAgreement(
    req.params.id,
    req.user?._id ?? null,
    req.body?.reason || ''
  );

  return ApiResponse.send(res, result, result.message);
};

/** GET /api/v1/agreements/:id/pdf - the four page agreement (?inline=1 to view) */
export const getAgreementPdf = async (req, res) => {
  const agreement = await agreementService.getAgreementById(req.params.id);
  const inline = req.query.inline === 'true' || req.query.inline === true;

  let rendered;
  try {
    rendered = await agreementPdfService.renderAgreementPdf(agreement);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    logger.error('Agreement PDF rendering failed:', error);
    throw new ApiError(
      503,
      'The PDF renderer is unavailable right now. Please try again shortly.',
      'PDF_RENDERER_UNAVAILABLE'
    );
  }

  const safeName = `${agreement.consumerName || 'agreement'}-agreement`.replace(/[^\w.\- ]+/g, '-');

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${safeName}.pdf"`);
  res.setHeader('Content-Length', rendered.buffer.length);
  res.setHeader('X-Document-Pages', String(rendered.pages));
  res.setHeader('X-Document-Font-Size', String(rendered.fontSize));
  return res.send(rendered.buffer);
};

/** GET /api/v1/agreements/:id/print - the same four pages as printable HTML */
export const printAgreement = async (req, res) => {
  const agreement = await agreementService.getAgreementById(req.params.id);
  const html = agreementPdfService.buildAgreementPrintHtml(agreement, {
    includeToolbar: req.query.toolbar !== 'false',
  });

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.send(html);
};

export default {
  getDefaults,
  listAgreements,
  createAgreement,
  getAgreement,
  updateAgreement,
  deleteAgreement,
  getAgreementPdf,
  printAgreement,
};
