// src/routes/bomTemplate.routes.js
import { Router } from 'express';
import { authenticate, authorize, hasPermission } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as bomTemplateController from '../controllers/bomTemplate.controller.js';
import * as bomTemplateValidation from '../validations/bomTemplate.validation.js';

const router = Router();

// All BOM template routes require authentication
router.use(authenticate);

// GET /api/v1/bom-templates - List all BOM templates
router.get(
  '/',
  hasPermission('view_material'),
  validate(bomTemplateValidation.listBOMTemplatesValidation, 'query'),
  asyncHandler(bomTemplateController.listBOMTemplates)
);

// GET /api/v1/bom-templates/by-roof-type - Get BOM by roof type and size
router.get(
  '/by-roof-type',
  hasPermission('view_material'),
  validate(bomTemplateValidation.getBOMByRoofTypeValidation, 'query'),
  asyncHandler(bomTemplateController.getBOMByRoofType)
);

// GET /api/v1/bom-templates/:id - Get BOM template by ID
router.get(
  '/:id',
  hasPermission('view_material'),
  validate(bomTemplateValidation.getBOMTemplateValidation, 'params'),
  asyncHandler(bomTemplateController.getBOMTemplate)
);

// POST /api/v1/bom-templates - Create new BOM template
router.post(
  '/',
  authorize('admin', 'manager'),
  validate(bomTemplateValidation.createBOMTemplateValidation),
  asyncHandler(bomTemplateController.createBOMTemplate)
);

// PUT /api/v1/bom-templates/:id - Update BOM template
router.put(
  '/:id',
  authorize('admin', 'manager'),
  validate(bomTemplateValidation.updateBOMTemplateValidation),
  asyncHandler(bomTemplateController.updateBOMTemplate)
);

// DELETE /api/v1/bom-templates/:id - Delete BOM template
router.delete(
  '/:id',
  authorize('admin'),
  validate(bomTemplateValidation.deleteBOMTemplateValidation, 'params'),
  asyncHandler(bomTemplateController.deleteBOMTemplate)
);

// POST /api/v1/bom-templates/bulk - Bulk create BOM templates
router.post(
  '/bulk',
  authorize('admin', 'manager'),
  validate(bomTemplateValidation.bulkCreateBOMTemplatesValidation),
  asyncHandler(bomTemplateController.bulkCreateBOMTemplates)
);

export default router;