// src/routes/application.routes.js
import { Router } from 'express';
import { authenticate, authorize } from '../middlewares/auth.js';
import { validate, validateParams, validateQuery } from '../middlewares/validate.js';
import { uploadSingleToMemory } from '../middlewares/upload.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as applicationController from '../controllers/application.controller.js';
import {
  createApplicationSchema,
  updateApplicationSchema,
  electricBillSchema,
  verifyElectricBillSchema,
  addDocumentSchema,
  reviewDocumentSchema,
  submitApplicationSchema,
  reviewApplicationSchema,
  updateStatusSchema,
  listApplicationsQuerySchema,
  applicationIdParamSchema,
  documentParamSchema,
  creditCheckPreviewSchema,
} from '../validations/application.validation.js';

const router = Router();

// Everyone on this router is signed in; the per-route `authorize` calls below
// decide who may do what. Reading is shared, writing consumer data is not.
router.use(authenticate);

/**
 * Reading is open to the whole pipeline: the service scopes an agent to the
 * applications they collected, while the office sees every one of them.
 */
const READ_ROLES = ['admin', 'manager', 'agent'];

/**
 * Who may fill in, correct and submit an application once it exists.
 *
 * This used to be the field agent alone, because the agent was the one typing
 * the consumer's details. That changed: the consumer is now a Customer record,
 * collected by an agent or by the office, and the application is filed *from*
 * that verified customer. The office therefore has to be able to complete the
 * wizard steps that follow — scheme, documents, bill, submission — so the write
 * roles are the whole pipeline, not one half of it.
 *
 * Creating is narrower: see the POST '/' route, which stays with the office
 * because it is the office that decides a verified customer becomes an
 * application.
 */
const APPLICATION_WRITE_ROLES = ['admin', 'manager', 'agent'];

/**
 * The office's half: verdicts, workflow status and the signed copies.
 *
 * Exported so the new-application notice can be tested against it â€” that notice
 * is addressed to `OFFICE_ROLES`, and a test asserts the two lists agree. A
 * reworded role group here must not silently send this work to nobody.
 */
export const REVIEW_ROLES = ['admin', 'manager'];

/**
 * GET /api/v1/applications/checklist
 * The form definition (documents, site types, statuses, bill portal URL).
 * Declared before /:id so "checklist" is never read as an id.
 */
router.get('/checklist', authorize(...READ_ROLES), asyncHandler(applicationController.getChecklist));

/** GET /api/v1/applications/stats â€” the agent / office dashboard numbers. */
router.get('/stats', authorize(...READ_ROLES), asyncHandler(applicationController.getStats));

/**
 * GET /api/v1/applications/lender-criteria
 * The per-lender credit rules. Declared before /:id, like /checklist, so
 * "lender-criteria" is never read as an application id.
 */
router.get(
  '/lender-criteria',
  authorize(...READ_ROLES),
  asyncHandler(applicationController.getLenderCriteria)
);

/**
 * POST /api/v1/applications/credit-check
 * The credit verdict for a consumer's answers before an application exists.
 * Nothing is stored and nothing is refused â€” a doubtful verdict comes back as a
 * notice for the agent, because the flow must never stop here.
 */
router.post(
  '/credit-check',
  authorize(...APPLICATION_WRITE_ROLES),
  validate(creditCheckPreviewSchema),
  asyncHandler(applicationController.previewCreditCheck)
);

/** GET /api/v1/applications â€” agents see their own, the office sees all. */
router.get(
  '/',
  authorize(...READ_ROLES),
  validateQuery(listApplicationsQuerySchema),
  asyncHandler(applicationController.listApplications)
);

/**
 * POST /api/v1/applications — file an application for a verified customer.
 *
 * Office only. The payload names a customer (see createApplicationSchema) and
 * the consumer's identity is read from that record, so this route is a decision
 * ("this customer becomes an application"), not data entry.
 */
router.post(
  '/',
  authorize(...REVIEW_ROLES),
  validate(createApplicationSchema),
  asyncHandler(applicationController.createApplication)
);

/** GET /api/v1/applications/:id */
router.get(
  '/:id',
  authorize(...READ_ROLES),
  validateParams(applicationIdParamSchema),
  asyncHandler(applicationController.getApplication)
);

/** PATCH /api/v1/applications/:id â€” the agent edits while draft / correction. */
router.patch(
  '/:id',
  authorize(...APPLICATION_WRITE_ROLES),
  validateParams(applicationIdParamSchema),
  validate(updateApplicationSchema),
  asyncHandler(applicationController.updateApplication)
);

/** POST /api/v1/applications/:id/submit â€” leaves the agent's hands. */
router.post(
  '/:id/submit',
  authorize(...APPLICATION_WRITE_ROLES),
  validateParams(applicationIdParamSchema),
  validate(submitApplicationSchema),
  asyncHandler(applicationController.submitApplication)
);

// ===================== documents =====================

/**
 * POST /api/v1/applications/:id/documents
 * Upload one checklist document. Rejected here when the picture is not clear â€”
 * the response carries the reasons so the form can say "picture clear nahi hai".
 */
router.post(
  '/:id/documents',
  authorize(...APPLICATION_WRITE_ROLES),
  validateParams(applicationIdParamSchema),
  uploadSingleToMemory('file'),
  validate(addDocumentSchema),
  asyncHandler(applicationController.uploadDocument)
);

/** DELETE /api/v1/applications/:id/documents/:documentId â€” the agent withdraws their own upload. */
router.delete(
  '/:id/documents/:documentId',
  authorize(...APPLICATION_WRITE_ROLES),
  validateParams(documentParamSchema),
  asyncHandler(applicationController.deleteDocument)
);

/** PATCH /api/v1/applications/:id/documents/:documentId/review â€” office verdict. */
router.patch(
  '/:id/documents/:documentId/review',
  authorize(...REVIEW_ROLES),
  validateParams(documentParamSchema),
  validate(reviewDocumentSchema),
  asyncHandler(applicationController.reviewDocument)
);

// ================== electricity bill ==================

/** PUT /api/v1/applications/:id/electric-bill â€” the agent records the two ids. */
router.put(
  '/:id/electric-bill',
  authorize(...APPLICATION_WRITE_ROLES),
  validateParams(applicationIdParamSchema),
  validate(electricBillSchema),
  asyncHandler(applicationController.setElectricBill)
);

/** GET /api/v1/applications/:id/electric-bill/portal â€” where to download the bill. */
router.get(
  '/:id/electric-bill/portal',
  authorize(...READ_ROLES),
  validateParams(applicationIdParamSchema),
  asyncHandler(applicationController.getElectricBillPortal)
);

/** PATCH /api/v1/applications/:id/electric-bill/verify â€” office confirms the ids match the bill. */
router.patch(
  '/:id/electric-bill/verify',
  authorize(...REVIEW_ROLES),
  validateParams(applicationIdParamSchema),
  validate(verifyElectricBillSchema),
  asyncHandler(applicationController.verifyElectricBill)
);

// ==================== name match ====================

/** POST /api/v1/applications/:id/name-match â€” recompute the three-name check from the agent's files. */
router.post(
  '/:id/name-match',
  authorize(...APPLICATION_WRITE_ROLES),
  validateParams(applicationIdParamSchema),
  asyncHandler(applicationController.runNameMatch)
);

// ====================== review ======================

/** PATCH /api/v1/applications/:id/review â€” approve / send back / reject. */
router.patch(
  '/:id/review',
  authorize(...REVIEW_ROLES),
  validateParams(applicationIdParamSchema),
  validate(reviewApplicationSchema),
  asyncHandler(applicationController.reviewApplication)
);

/** PATCH /api/v1/applications/:id/status â€” move along the workflow. */
router.patch(
  '/:id/status',
  authorize(...REVIEW_ROLES),
  validateParams(applicationIdParamSchema),
  validate(updateStatusSchema),
  asyncHandler(applicationController.updateStatus)
);

/**
 * POST /api/v1/applications/:id/signed-document
 * The scanned, consumer-signed copy of the quotation or the agreement.
 */
router.post(
  '/:id/signed-document',
  authorize(...REVIEW_ROLES),
  validateParams(applicationIdParamSchema),
  uploadSingleToMemory('file'),
  asyncHandler(applicationController.uploadSignedDocument)
);

/** DELETE /api/v1/applications/:id â€” the agent discards a draft or a sent-back one. */
router.delete(
  '/:id',
  authorize(...APPLICATION_WRITE_ROLES),
  validateParams(applicationIdParamSchema),
  asyncHandler(applicationController.deleteApplication)
);

export default router;
