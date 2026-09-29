// src/routes/quotation.routes.js
import { Router } from 'express';
import { authenticate, authorize } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { uploadSingle, uploadMultiple } from '../middlewares/upload.js';
import * as quotationController from '../controllers/quotation.controller.js';
import * as quotationValidation from '../validations/quotation.validation.js';

const router = Router();

// All quotation routes require authentication.
router.use(authenticate);

/**
 * Access control note: gating is role based (admin / manager, admin-only for
 * delete and restore). The dedicated quotation permissions
 * (view_quotation / create_quotation / …) are declared in the User model and can
 * be switched on with hasPermission('…') once they have been granted to the
 * existing users - enabling them today would lock those users out.
 */

// ---------------------------------------------------------------------------
// Static paths MUST be declared before '/:id', otherwise Express matches
// '/next-number' and '/register' as an id.
// ---------------------------------------------------------------------------

// GET /api/v1/quotations/defaults - fixed terms + form defaults (read only)
router.get(
  '/defaults',
  authorize('admin', 'manager'),
  asyncHandler(quotationController.getDefaults)
);

// GET /api/v1/quotations/next-number - preview the number the next save will get
router.get(
  '/next-number',
  authorize('admin', 'manager'),
  validate(quotationValidation.nextNumberValidation, 'query'),
  asyncHandler(quotationController.getNextNumber)
);

// GET /api/v1/quotations/check-number - is a typed number still free?
// Read-only; drives the inline warning on the New quotation form.
router.get(
  '/check-number',
  authorize('admin', 'manager'),
  validate(quotationValidation.checkNumberValidation, 'query'),
  asyncHandler(quotationController.checkNumber)
);

// ---------------------------------------------------------------------------
// Import / back-fill (must also precede '/:id')
// ---------------------------------------------------------------------------

// POST /api/v1/quotations/import/register - import the old serial sheet.
// Accepts an uploaded .xlsx/.csv in "file", a "rows" array, or useLegacy:true.
// dryRun defaults to true, so nothing is written unless dryRun=false is sent.
router.post(
  '/import/register',
  authorize('admin'),
  uploadSingle('file'),
  validate(quotationValidation.importRegisterValidation),
  asyncHandler(quotationController.importRegister)
);

// POST /api/v1/quotations/import/attachments - upload the old quotation PDFs and
// get the proposed matches back. Files are stored but NOT attached yet.
// Max 10 files per request (upload middleware limit) - batch larger sets.
router.post(
  '/import/attachments',
  authorize('admin', 'manager'),
  uploadMultiple('files', 10),
  validate(quotationValidation.importAttachmentsValidation, 'query'),
  asyncHandler(quotationController.importAttachments)
);

// POST /api/v1/quotations/import/confirm - attach the reviewed matches
router.post(
  '/import/confirm',
  authorize('admin', 'manager'),
  validate(quotationValidation.importConfirmValidation),
  asyncHandler(quotationController.confirmImport)
);

// GET /api/v1/quotations/register - Quotation SL Number register
router.get(
  '/register',
  validate(quotationValidation.registerValidation, 'query'),
  asyncHandler(quotationController.getRegister)
);

// GET /api/v1/quotations/stats - per financial year totals
router.get(
  '/stats',
  validate(quotationValidation.statsValidation, 'query'),
  asyncHandler(quotationController.getStats)
);

// GET /api/v1/quotations - quotation sheet (list)
router.get(
  '/',
  validate(quotationValidation.listQuotationsValidation, 'query'),
  asyncHandler(quotationController.listQuotations)
);

// POST /api/v1/quotations - create (number is assigned by the server)
router.post(
  '/',
  authorize('admin', 'manager'),
  validate(quotationValidation.createQuotationValidation),
  asyncHandler(quotationController.createQuotation)
);

// GET /api/v1/quotations/:id
router.get(
  '/:id',
  validate(quotationValidation.getQuotationValidation, 'params'),
  asyncHandler(quotationController.getQuotation)
);

// PUT /api/v1/quotations/:id - update
router.put(
  '/:id',
  authorize('admin', 'manager'),
  validate(quotationValidation.getQuotationValidation, 'params'),
  validate(quotationValidation.updateQuotationValidation),
  asyncHandler(quotationController.updateQuotation)
);

// PATCH /api/v1/quotations/:id/status
router.patch(
  '/:id/status',
  authorize('admin', 'manager'),
  validate(quotationValidation.getQuotationValidation, 'params'),
  validate(quotationValidation.updateQuotationStatusValidation),
  asyncHandler(quotationController.changeStatus)
);

// GET /api/v1/quotations/:id/pdf - the A4 one page document (?inline=1 to view)
// No dedicated pdf rate limiter here on purpose: the client previews the same
// document, so a 10/hour cap would block normal use. The global limiter applies.
router.get(
  '/:id/pdf',
  authorize('admin', 'manager'),
  validate(quotationValidation.getQuotationValidation, 'params'),
  asyncHandler(quotationController.getQuotationPdf)
);

// GET /api/v1/quotations/:id/print - the same markup as HTML for printing
router.get(
  '/:id/print',
  validate(quotationValidation.getQuotationValidation, 'params'),
  asyncHandler(quotationController.printQuotation)
);

// POST /api/v1/quotations/:id/restore - undo a soft delete
router.post(
  '/:id/restore',
  authorize('admin'),
  validate(quotationValidation.getQuotationValidation, 'params'),
  validate(quotationValidation.restoreQuotationValidation),
  asyncHandler(quotationController.restoreQuotation)
);

// POST /api/v1/quotations/:id/attachments - attach the manual PDF / signed copy
router.post(
  '/:id/attachments',
  authorize('admin', 'manager'),
  validate(quotationValidation.getQuotationValidation, 'params'),
  uploadSingle('file'),
  validate(quotationValidation.addAttachmentValidation),
  asyncHandler(quotationController.addAttachment)
);

// DELETE /api/v1/quotations/:id/attachments/:attachmentId
router.delete(
  '/:id/attachments/:attachmentId',
  authorize('admin', 'manager'),
  validate(quotationValidation.attachmentParamsValidation, 'params'),
  asyncHandler(quotationController.removeAttachment)
);

// DELETE /api/v1/quotations/:id - soft delete (removes it from the quotation
// list AND from the SL number register, and frees the number when it was last)
router.delete(
  '/:id',
  authorize('admin'),
  validate(quotationValidation.deleteQuotationValidation, 'params'),
  asyncHandler(quotationController.deleteQuotation)
);

export default router;
