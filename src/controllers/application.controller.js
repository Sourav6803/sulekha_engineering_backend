// src/controllers/application.controller.js
import { ApiResponse } from '../utils/ApiResponse.js';
import { applicationService, collectSubmitIssues } from '../services/application.service.js';
import {
  CHECKLIST_DOCUMENTS,
  SITE_TYPES,
  APPLICATION_STATUSES,
  BILL_PORTAL_URL,
} from '../data/applicationChecklist.js';

/**
 * Application controller — thin HTTP layer over applicationService.
 * Every business rule (agent scoping, the clarity gate, the submit checklist,
 * the status machine) lives in the service so it can be tested without HTTP.
 */

/**
 * GET /api/v1/applications/checklist
 * The definition of the field form: documents, site types, statuses and the
 * bill portal URL, so the client renders exactly what the API enforces.
 */
export const getChecklist = async (req, res) => {
  return ApiResponse.send(
    res,
    {
      documents: CHECKLIST_DOCUMENTS,
      siteTypes: SITE_TYPES,
      statuses: APPLICATION_STATUSES,
      billPortalUrl: BILL_PORTAL_URL,
    },
    'Application checklist'
  );
};

/** GET /api/v1/applications */
export const listApplications = async (req, res) => {
  const { items, pagination } = await applicationService.listApplications(req.query, req.user);

  return ApiResponse.sendPaginated(res, items, pagination, 'Applications fetched');
};

/** GET /api/v1/applications/stats — the agent dashboard numbers. */
export const getStats = async (req, res) => {
  const stats = await applicationService.getStats(req.query, req.user);

  return ApiResponse.send(res, stats, 'Application statistics');
};

/** GET /api/v1/applications/:id */
export const getApplication = async (req, res) => {
  const application = await applicationService.getApplication(req.params.id, req.user);

  return ApiResponse.send(
    res,
    {
      application,
      documents: applicationService.summariseDocuments(application),
      submitIssues: collectSubmitIssues(application),
    },
    'Application fetched'
  );
};

/** POST /api/v1/applications */
export const createApplication = async (req, res) => {
  const application = await applicationService.createApplication(req.body, req.user);

  return ApiResponse.sendCreated(res, application, `Application created: ${application.applicationNo}`);
};

/** PATCH /api/v1/applications/:id */
export const updateApplication = async (req, res) => {
  const application = await applicationService.updateApplication(req.params.id, req.body, req.user);

  return ApiResponse.send(
    res,
    { application, submitIssues: collectSubmitIssues(application) },
    'Application updated'
  );
};

/** POST /api/v1/applications/:id/submit */
export const submitApplication = async (req, res) => {
  const application = await applicationService.submitApplication(req.params.id, req.body, req.user);

  return ApiResponse.send(res, application, 'Application submitted for review');
};

/** POST /api/v1/applications/:id/documents */
export const uploadDocument = async (req, res) => {
  const result = await applicationService.addDocument(
    req.params.id,
    req.file,
    req.body,
    req.user
  );

  return ApiResponse.sendCreated(
    res,
    result,
    `${req.body.kind} uploaded${result.qualityCheck?.verdict === 'skipped' ? '' : ` (clarity: ${result.qualityCheck.verdict})`}`
  );
};

/** DELETE /api/v1/applications/:id/documents/:documentId */
export const deleteDocument = async (req, res) => {
  const application = await applicationService.removeDocument(
    req.params.id,
    req.params.documentId,
    req.user
  );

  return ApiResponse.send(res, applicationService.summariseDocuments(application), 'Document removed');
};

/** PATCH /api/v1/applications/:id/documents/:documentId/review */
export const reviewDocument = async (req, res) => {
  const application = await applicationService.reviewDocument(
    req.params.id,
    req.params.documentId,
    req.body,
    req.user
  );

  return ApiResponse.send(
    res,
    {
      status: application.status,
      documents: applicationService.summariseDocuments(application),
    },
    `Document ${req.body.status}`
  );
};

// ======================= ELECTRICITY BILL =======================

/** PUT /api/v1/applications/:id/electric-bill */
export const setElectricBill = async (req, res) => {
  const result = await applicationService.setElectricBill(req.params.id, req.body, req.user);

  return ApiResponse.send(res, result, 'Consumer ID and Installation ID saved');
};

/** GET /api/v1/applications/:id/electric-bill/portal */
export const getElectricBillPortal = async (req, res) => {
  const result = await applicationService.getBillPortalLink(req.params.id, req.user);

  return ApiResponse.send(res, result, 'Bill portal link');
};

/** PATCH /api/v1/applications/:id/electric-bill/verify */
export const verifyElectricBill = async (req, res) => {
  const electricBill = await applicationService.verifyElectricBill(req.params.id, req.body, req.user);

  return ApiResponse.send(res, electricBill, 'Electricity bill verified');
};

// ========================= NAME MATCH =========================

/** POST /api/v1/applications/:id/name-match */
export const runNameMatch = async (req, res) => {
  const nameMatch = await applicationService.runNameMatch(req.params.id, req.body, req.user);

  return ApiResponse.send(res, nameMatch, nameMatch.message || 'Name check complete');
};

// =========================== REVIEW ===========================

/** PATCH /api/v1/applications/:id/review */
export const reviewApplication = async (req, res) => {
  const application = await applicationService.reviewApplication(req.params.id, req.body, req.user);

  return ApiResponse.send(res, application, `Application marked ${req.body.status}`);
};

/** PATCH /api/v1/applications/:id/status */
export const updateStatus = async (req, res) => {
  const application = await applicationService.updateStatus(req.params.id, req.body, req.user);

  return ApiResponse.send(res, application, `Application status set to ${req.body.status}`);
};

/**
 * POST /api/v1/applications/:id/signed-document
 * The consumer signs the printed quotation, the office scans it back to PDF and
 * files it here — the generated PDF is never overwritten.
 */
export const uploadSignedDocument = async (req, res) => {
  const document = await applicationService.attachSignedDocument(
    req.params.id,
    req.file,
    req.body,
    req.user
  );

  return ApiResponse.sendCreated(res, document, 'Signed copy attached');
};

/** DELETE /api/v1/applications/:id */
export const deleteApplication = async (req, res) => {
  const result = await applicationService.deleteApplication(req.params.id, req.user);

  return ApiResponse.send(res, result, 'Application deleted');
};

export default {
  getChecklist,
  listApplications,
  getStats,
  getApplication,
  createApplication,
  updateApplication,
  submitApplication,
  uploadDocument,
  deleteDocument,
  reviewDocument,
  setElectricBill,
  getElectricBillPortal,
  verifyElectricBill,
  runNameMatch,
  reviewApplication,
  updateStatus,
  uploadSignedDocument,
  deleteApplication,
};
