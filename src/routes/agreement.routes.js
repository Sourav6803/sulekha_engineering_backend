// src/routes/agreement.routes.js
import { Router } from 'express';
import { authenticate, authorize } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as agreementController from '../controllers/agreement.controller.js';
import * as agreementValidation from '../validations/agreement.validation.js';

const router = Router();

// Everything here needs a signed-in user. Creating and updating is limited to
// admin / manager (same rule as quotations); deleting stays with admin.
router.use(authenticate);

// ---------------------------------------------------------------------------
// Static paths first - '/:id' would otherwise swallow them.
// ---------------------------------------------------------------------------

// GET /api/v1/agreements/defaults - discom, registered office, payment wording
router.get(
  '/defaults',
  authorize('admin', 'manager'),
  asyncHandler(agreementController.getDefaults)
);

// GET /api/v1/agreements - list with search and pagination
router.get(
  '/',
  validate(agreementValidation.listAgreementsValidation, 'query'),
  asyncHandler(agreementController.listAgreements)
);

// POST /api/v1/agreements - create (optionally prefilled from a quotation)
router.post(
  '/',
  authorize('admin', 'manager'),
  validate(agreementValidation.createAgreementValidation),
  asyncHandler(agreementController.createAgreement)
);

// ---------------------------------------------------------------------------
// Per agreement
// ---------------------------------------------------------------------------

// GET /api/v1/agreements/:id/pdf - the four page document (?inline=1 to view)
// No dedicated pdf rate limiter: the client previews the same document, so a low
// cap would block normal use. The global limiter still applies.
router.get(
  '/:id/pdf',
  authorize('admin', 'manager'),
  validate(agreementValidation.agreementIdValidation, 'params'),
  asyncHandler(agreementController.getAgreementPdf)
);

// GET /api/v1/agreements/:id/print - printable HTML for the same four pages
router.get(
  '/:id/print',
  validate(agreementValidation.agreementIdValidation, 'params'),
  asyncHandler(agreementController.printAgreement)
);

// GET /api/v1/agreements/:id
router.get(
  '/:id',
  validate(agreementValidation.agreementIdValidation, 'params'),
  asyncHandler(agreementController.getAgreement)
);

// PUT /api/v1/agreements/:id
router.put(
  '/:id',
  authorize('admin', 'manager'),
  validate(agreementValidation.agreementIdValidation, 'params'),
  validate(agreementValidation.updateAgreementValidation),
  asyncHandler(agreementController.updateAgreement)
);

// DELETE /api/v1/agreements/:id - soft delete
router.delete(
  '/:id',
  authorize('admin'),
  validate(agreementValidation.agreementIdValidation, 'params'),
  asyncHandler(agreementController.deleteAgreement)
);

export default router;
