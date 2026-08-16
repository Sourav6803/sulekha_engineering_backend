// src/routes/customer.routes.js
import { Router } from 'express';
import { authenticate, authorize, hasPermission } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as customerController from '../controllers/customer.controller.js';
import * as customerValidation from '../validations/customer.validation.js';

const router = Router();

// All customer routes require authentication
router.use(authenticate);

// GET /api/v1/customers - List all customers
router.get(
  '/',
  hasPermission('view_customer'),
  validate(customerValidation.listCustomersValidation, 'query'),
  asyncHandler(customerController.listCustomers)
);

// GET /api/v1/customers/search - Search customers
router.get(
  '/search',
  hasPermission('view_customer'),
  validate(customerValidation.searchCustomersValidation, 'query'),
  asyncHandler(customerController.searchCustomers)
);

// GET /api/v1/customers/:id - Get customer by ID
router.get(
  '/:id',
  hasPermission('view_customer'),
  validate(customerValidation.getCustomerValidation, 'params'),
  asyncHandler(customerController.getCustomer)
);

// POST /api/v1/customers - Create new customer
router.post(
  '/',
  authorize('admin', 'manager', 'sales'),
  hasPermission('create_customer'),
  validate(customerValidation.createCustomerValidation),
  asyncHandler(customerController.createCustomer)
);

// PUT /api/v1/customers/:id - Update customer
router.put(
  '/:id',
  authorize('admin', 'manager', 'sales'),
  hasPermission('edit_customer'),
  validate(customerValidation.updateCustomerValidation),
  asyncHandler(customerController.updateCustomer)
);

// DELETE /api/v1/customers/:id - Delete customer (soft delete)
router.delete(
  '/:id',
  authorize('admin'),
  hasPermission('delete_customer'),
  validate(customerValidation.deleteCustomerValidation, 'params'),
  asyncHandler(customerController.deleteCustomer)
);

// GET /api/v1/customers/:id/installations - Get customer installations
router.get(
  '/:id/installations',
  hasPermission('view_installation'),
  validate(customerValidation.getCustomerInstallationsValidation, 'params'),
  asyncHandler(customerController.getCustomerInstallations)
);

// GET /api/v1/customers/:id/history - Get customer history
router.get(
  '/:id/history',
  hasPermission('view_customer'),
  validate(customerValidation.getCustomerHistoryValidation, 'params'),
  asyncHandler(customerController.getCustomerHistory)
);

export default router;