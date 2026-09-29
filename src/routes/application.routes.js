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
 * Writing consumer data belongs to the field agent and to nobody else.
 *
 * The office supervises the pipeline — it reads the record, judges each
 * document against the clarity metrics, moves the application along the
 * workflow and files the signed copies — but it does not type or correct what
 * the consumer told the agent at their house. Splitting the two halves across
 * roles is what keeps an application a record of the visit rather than
 * something a desk can quietly rewrite afterwards.
 */
const FIELD_AGENT_ROLES = ['agent'];

/**
 * The office's half: verdicts, workflow status and the signed copies.
 *
 * Exported so the new-application notice can be tested against it — that notice
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

/** GET /api/v1/applications/stats — the agent / office dashboard numbers. */
router.get('/stats', authorize(...READ_ROLES), asyncHandler(applicationController.getStats));

/** GET /api/v1/applications — agents see their own, the office sees all. */
router.get(
  '/',
  authorize(...READ_ROLES),
  validateQuery(listApplicationsQuerySchema),
  asyncHandler(applicationController.listApplications)
);

/** POST /api/v1/applications — the field agent opens a new consumer application (draft). */
router.post(
  '/',
  authorize(...FIELD_AGENT_ROLES),
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

/** PATCH /api/v1/applications/:id — the agent edits while draft / correction. */
router.patch(
  '/:id',
  authorize(...FIELD_AGENT_ROLES),
  validateParams(applicationIdParamSchema),
  validate(updateApplicationSchema),
  asyncHandler(applicationController.updateApplication)
);

/** POST /api/v1/applications/:id/submit — leaves the agent's hands. */
router.post(
  '/:id/submit',
  authorize(...FIELD_AGENT_ROLES),
  validateParams(applicationIdParamSchema),
  validate(submitApplicationSchema),
  asyncHandler(applicationController.submitApplication)
);

// ===================== documents =====================

/**
 * POST /api/v1/applications/:id/documents
 * Upload one checklist document. Rejected here when the picture is not clear —
 * the response carries the reasons so the form can say "picture clear nahi hai".
 */
router.post(
  '/:id/documents',
  authorize(...FIELD_AGENT_ROLES),
  validateParams(applicationIdParamSchema),
  uploadSingleToMemory('file'),
  validate(addDocumentSchema),
  asyncHandler(applicationController.uploadDocument)
);

/** DELETE /api/v1/applications/:id/documents/:documentId — the agent withdraws their own upload. */
router.delete(
  '/:id/documents/:documentId',
  authorize(...FIELD_AGENT_ROLES),
  validateParams(documentParamSchema),
  asyncHandler(applicationController.deleteDocument)
);

/** PATCH /api/v1/applications/:id/documents/:documentId/review — office verdict. */
router.patch(
  '/:id/documents/:documentId/review',
  authorize(...REVIEW_ROLES),
  validateParams(documentParamSchema),
  validate(reviewDocumentSchema),
  asyncHandler(applicationController.reviewDocument)
);

// ================== electricity bill ==================

/** PUT /api/v1/applications/:id/electric-bill — the agent records the two ids. */
router.put(
  '/:id/electric-bill',
  authorize(...FIELD_AGENT_ROLES),
  validateParams(applicationIdParamSchema),
  validate(electricBillSchema),
  asyncHandler(applicationController.setElectricBill)
);

/** GET /api/v1/applications/:id/electric-bill/portal — where to download the bill. */
router.get(
  '/:id/electric-bill/portal',
  authorize(...READ_ROLES),
  validateParams(applicationIdParamSchema),
  asyncHandler(applicationController.getElectricBillPortal)
);

/** PATCH /api/v1/applications/:id/electric-bill/verify — office confirms the ids match the bill. */
router.patch(
  '/:id/electric-bill/verify',
  authorize(...REVIEW_ROLES),
  validateParams(applicationIdParamSchema),
  validate(verifyElectricBillSchema),
  asyncHandler(applicationController.verifyElectricBill)
);

// ==================== name match ====================

/** POST /api/v1/applications/:id/name-match — recompute the three-name check from the agent's files. */
router.post(
  '/:id/name-match',
  authorize(...FIELD_AGENT_ROLES),
  validateParams(applicationIdParamSchema),
  asyncHandler(applicationController.runNameMatch)
);

// ====================== review ======================

/** PATCH /api/v1/applications/:id/review — approve / send back / reject. */
router.patch(
  '/:id/review',
  authorize(...REVIEW_ROLES),
  validateParams(applicationIdParamSchema),
  validate(reviewApplicationSchema),
  asyncHandler(applicationController.reviewApplication)
);

/** PATCH /api/v1/applications/:id/status — move along the workflow. */
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

/** DELETE /api/v1/applications/:id — the agent discards a draft or a sent-back one. */
router.delete(
  '/:id',
  authorize(...FIELD_AGENT_ROLES),
  validateParams(applicationIdParamSchema),
  asyncHandler(applicationController.deleteApplication)
);

export default router;
