// src/routes/purchase.routes.js
import { Router } from 'express';
import { authenticate, authorize, hasPermission } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { uploadSingle } from '../middlewares/upload.js';
import * as purchaseController from '../controllers/purchase.controller.js';
import * as purchaseValidation from '../validations/purchase.validation.js';

const router = Router();

// All purchase routes require authentication
router.use(authenticate);

// GET /api/v1/purchases - List all purchases
router.get(
  '/',
  hasPermission('view_purchase'),
  validate(purchaseValidation.listPurchasesValidation, 'query'),
  asyncHandler(purchaseController.listPurchases)
);

// GET /api/v1/purchases/:id - Get purchase by ID
router.get(
  '/:id',
  hasPermission('view_purchase'),
  validate(purchaseValidation.getPurchaseValidation, 'params'),
  asyncHandler(purchaseController.getPurchase)
);

// POST /api/v1/purchases - Create new purchase
router.post(
  '/',
  authorize('admin', 'manager'),
  hasPermission('create_purchase'),
  validate(purchaseValidation.createPurchaseValidation),
  asyncHandler(purchaseController.createPurchase)
);

// PUT /api/v1/purchases/:id - Update purchase
router.put(
  '/:id',
  authorize('admin', 'manager'),
  hasPermission('edit_purchase'),
  validate(purchaseValidation.updatePurchaseValidation),
  asyncHandler(purchaseController.updatePurchase)
);

// DELETE /api/v1/purchases/:id - Delete purchase (soft delete)
router.delete(
  '/:id',
  authorize('admin'),
  hasPermission('delete_purchase'),
  validate(purchaseValidation.deletePurchaseValidation, 'params'),
  asyncHandler(purchaseController.deletePurchase)
);

// POST /api/v1/purchases/:id/invoice - Upload purchase invoice
router.post(
  '/:id/invoice',
  authorize('admin', 'manager', 'warehouse_staff'),
  uploadSingle('invoice'),
  validate(purchaseValidation.uploadInvoiceValidation, 'params'),
  asyncHandler(purchaseController.uploadInvoice)
);

// GET /api/v1/purchases/:id/invoice - Download invoice
router.get(
  '/:id/invoice',
  hasPermission('view_purchase'),
  validate(purchaseValidation.getInvoiceValidation, 'params'),
  asyncHandler(purchaseController.getInvoice)
);

// POST /api/v1/purchases/:id/complete - Mark purchase as completed
router.patch(
  '/:id/complete',
  authorize('admin', 'manager'),
  validate(purchaseValidation.completePurchaseValidation, 'params'),
  asyncHandler(purchaseController.completePurchase)
);

export default router;