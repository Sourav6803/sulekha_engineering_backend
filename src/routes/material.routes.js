// src/routes/material.routes.js
import { Router } from 'express';
import { authenticate, authorize, hasPermission } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { uploadSingle } from '../middlewares/upload.js';
import * as materialController from '../controllers/material.controller.js';
import * as materialValidation from '../validations/material.validation.js';

const router = Router();

// All material routes require authentication
router.use(authenticate);

// GET /api/v1/materials - List all materials
router.get(
  '/',
  validate(materialValidation.listMaterialsValidation, 'query'),
  asyncHandler(materialController.listMaterials)
);

// GET /api/v1/materials/low-stock - Get low stock materials
router.get(
  '/low-stock',
  asyncHandler(materialController.getLowStockMaterials)
);

// GET /api/v1/materials/summary - Get stock summary
router.get(
  '/summary',
  asyncHandler(materialController.getStockSummary)
);

// GET /api/v1/materials/search - Search materials
router.get(
  '/search',
  validate(materialValidation.searchMaterialsValidation, 'query'),
  asyncHandler(materialController.searchMaterials)
);

// GET /api/v1/materials/:id - Get material by ID
router.get(
  '/:id',
  validate(materialValidation.getMaterialValidation, 'params'),
  asyncHandler(materialController.getMaterial)
);

// POST /api/v1/materials - Create new material
router.post(
  '/',
  authorize('admin', 'manager', 'warehouse_staff'),
  hasPermission('create_material'),
  validate(materialValidation.createMaterialValidation),
  asyncHandler(materialController.createMaterial)
);

// PUT /api/v1/materials/:id - Update material
router.put(
  '/:id',
  authorize('admin', 'manager', 'warehouse_staff'),
  hasPermission('edit_material'),
  validate(materialValidation.updateMaterialValidation),
  asyncHandler(materialController.updateMaterial)
);

// DELETE /api/v1/materials/:id - Delete material (soft delete)
router.delete(
  '/:id',
  authorize('admin'),
  hasPermission('delete_material'),
  validate(materialValidation.deleteMaterialValidation, 'params'),
  asyncHandler(materialController.deleteMaterial)
);

// POST /api/v1/materials/:id/image - Upload material image
router.post(
  '/:id/image',
  authorize('admin', 'manager', 'warehouse_staff'),
  uploadSingle('image'),
  validate(materialValidation.uploadImageValidation, 'params'),
  asyncHandler(materialController.uploadMaterialImage)
);

// GET /api/v1/materials/:id/history - Get material stock history
router.get(
  '/:id/history',
  validate(materialValidation.getMaterialHistoryValidation, 'params'),
  asyncHandler(materialController.getMaterialHistory)
);

// PATCH /api/v1/materials/:id/stock - Adjust stock (admin only)
router.patch(
  '/:id/stock',
  authorize('admin', 'manager'),
  validate(materialValidation.adjustStockParamsValidation, 'params'),
  validate(materialValidation.adjustStockBodyValidation, 'body'),
  asyncHandler(materialController.adjustStock)
);

export default router;