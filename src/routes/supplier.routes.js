// src/routes/supplier.routes.js
import { Router } from 'express';
import { authenticate, authorize } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as supplierController from '../controllers/supplier.controller.js';
import * as supplierValidation from '../validations/supplier.validation.js';

const router = Router();

// All supplier routes require authentication
router.use(authenticate);

// GET /api/v1/suppliers - List all suppliers
router.get(
  '/',
  validate(supplierValidation.listSuppliersValidation, 'query'),
  asyncHandler(supplierController.listSuppliers)
);

// GET /api/v1/suppliers/:id - Get supplier by ID
router.get(
  '/:id',
  validate(supplierValidation.getSupplierValidation, 'params'),
  asyncHandler(supplierController.getSupplier)
);

// POST /api/v1/suppliers - Create new supplier
router.post(
  '/',
  authorize('admin', 'manager'),
  validate(supplierValidation.createSupplierValidation),
  asyncHandler(supplierController.createSupplier)
);

// PUT /api/v1/suppliers/:id - Update supplier
router.put(
  '/:id',
  authorize('admin', 'manager'),
  validate(supplierValidation.updateSupplierValidation),
  asyncHandler(supplierController.updateSupplier)
);

// DELETE /api/v1/suppliers/:id - Delete supplier (soft delete)
router.delete(
  '/:id',
  authorize('admin'),
  validate(supplierValidation.deleteSupplierValidation, 'params'),
  asyncHandler(supplierController.deleteSupplier)
);

// GET /api/v1/suppliers/:id/purchases - Get supplier purchase history
router.get(
  '/:id/purchases',
  validate(supplierValidation.getSupplierPurchasesValidation, 'params'),
  asyncHandler(supplierController.getSupplierPurchases)
);

export default router;