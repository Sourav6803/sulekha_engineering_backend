// src/routes/installation.routes.js
import { Router } from 'express';
import { authenticate, authorize, hasPermission } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { pdfRateLimiter } from '../middlewares/rateLimiter.js';
import * as installationController from '../controllers/installation.controller.js';
import * as installationValidation from '../validations/installation.validation.js';

const router = Router();

// All installation routes require authentication
router.use(authenticate);

// GET /api/v1/installations - List all installations
router.get(
  '/',
  hasPermission('view_installation'),
  validate(installationValidation.listInstallationsValidation, 'query'),
  asyncHandler(installationController.listInstallations)
);

// GET /api/v1/installations/suggested-bom - Get suggested BOM
router.get(
  '/suggested-bom',
  validate(installationValidation.getSuggestedBOMValidation, 'query'),
  asyncHandler(installationController.getSuggestedBOM)
);

// GET /api/v1/installations/:id - Get installation by ID
router.get(
  '/:id',
  hasPermission('view_installation'),
  validate(installationValidation.getInstallationValidation, 'params'),
  asyncHandler(installationController.getInstallation)
);

// POST /api/v1/installations - Create new installation
router.post(
  '/',
  authorize('admin', 'manager', 'installation_team'),
  hasPermission('create_installation'),
  validate(installationValidation.createInstallationValidation),
  asyncHandler(installationController.createInstallation)
);

// PUT /api/v1/installations/:id - Update installation
router.put(
  '/:id',
  authorize('admin', 'manager', 'installation_team'),
  hasPermission('edit_installation'),
  validate(installationValidation.updateInstallationValidation),
  asyncHandler(installationController.updateInstallation)
);

// DELETE /api/v1/installations/:id - Delete installation (soft delete)
router.delete(
  '/:id',
  authorize('admin'),
  hasPermission('delete_installation'),
  validate(installationValidation.deleteInstallationValidation, 'params'),
  asyncHandler(installationController.deleteInstallation)
);

// POST /api/v1/installations/:id/materials - Assign materials to installation
router.post(
  '/:id/materials',
  authorize('admin', 'manager', 'installation_team'),
  hasPermission('assign_material'),
  validate(installationValidation.assignMaterialsParamsValidation, 'params'),
  validate(installationValidation.assignMaterialsBodyValidation, 'body'),
  asyncHandler(installationController.assignMaterials)
);

// POST /api/v1/installations/:id/materials/:usageId/reverse - Reverse material assignment
router.post(
  '/:id/materials/:usageId/reverse',
  authorize('admin', 'manager', 'installation_team'),
  hasPermission('reverse_material'),
  validate(installationValidation.reverseMaterialValidation),
  asyncHandler(installationController.reverseMaterial)
);

// GET /api/v1/installations/:id/bom-pdf - Generate BOM PDF
// variant=final  -> confirmed actual usage (as built / customer handover)
// variant=suggested -> suggested BOM, meant to be printed and taken to site
router.get(
  '/:id/bom-pdf',
  hasPermission('generate_pdf'),
  pdfRateLimiter,
  validate(installationValidation.generateBOMPDFValidation, 'params'),
  validate(installationValidation.generateBOMPDFQueryValidation, 'query'),
  asyncHandler(installationController.generateBOMPDF)
);

// GET /api/v1/installations/:id/bom-excel - Generate BOM Excel
router.get(
  '/:id/bom-excel',
  hasPermission('generate_pdf'),
  pdfRateLimiter,
  validate(installationValidation.generateBOMPDFValidation, 'params'),
  validate(installationValidation.generateBOMPDFQueryValidation, 'query'),
  asyncHandler(installationController.generateBOMExcel)
);

// PATCH /api/v1/installations/:id/status - Update installation status
router.patch(
  '/:id/status',
  authorize('admin', 'manager', 'installation_team'),
  validate(installationValidation.updateInstallationStatusParamsValidation, 'params'),
  validate(installationValidation.updateInstallationStatusValidation),
  asyncHandler(installationController.updateInstallationStatus)
);

// GET /api/v1/installations/:id/load-analysis - Get load analysis
router.get(
  '/:id/load-analysis',
  hasPermission('view_installation'),
  validate(installationValidation.getLoadAnalysisValidation, 'params'),
  asyncHandler(installationController.getLoadAnalysis)
);

export default router;