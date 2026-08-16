import { Router } from 'express';
import { authenticate, authorize } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as customerController from '../controllers/customer.controller.js';
import * as customerValidation from '../validations/customer.validation.js';
import { uploadSingle, uploadMultiple } from '../middlewares/upload.js';

const router = Router();

router.use(authenticate);

router.get('/', validate(customerValidation.listCustomersValidation, 'query'), asyncHandler(customerController.listCustomers));
router.get('/search', validate(customerValidation.searchCustomersValidation, 'query'), asyncHandler(customerController.searchCustomers));
router.get('/:id', validate(customerValidation.getCustomerValidation, 'params'), asyncHandler(customerController.getCustomer));
router.get('/:id/installations', validate(customerValidation.getCustomerInstallationsValidation, 'params'), asyncHandler(customerController.getCustomerInstallations));
router.get('/:id/history', validate(customerValidation.getCustomerHistoryValidation, 'params'), asyncHandler(customerController.getCustomerHistory));
router.post('/', authorize('admin', 'manager'), validate(customerValidation.createCustomerValidation), asyncHandler(customerController.createCustomer));
router.put('/:id', authorize('admin', 'manager'), validate(customerValidation.updateCustomerValidation), asyncHandler(customerController.updateCustomer));
router.delete('/:id', authorize('admin'), validate(customerValidation.deleteCustomerValidation, 'params'), asyncHandler(customerController.deleteCustomer));
router.post('/:id/documents', authorize('admin', 'manager'), uploadMultiple('documents', 10), validate(customerValidation.uploadDocumentBodyValidation, 'body'), validate(customerValidation.uploadDocumentParamsValidation, 'params'), asyncHandler(customerController.uploadCustomerDocument));
router.delete('/:id/documents/:documentId', authorize('admin', 'manager'), validate(customerValidation.deleteDocumentValidation, 'params'), asyncHandler(customerController.deleteCustomerDocument));

export default router;
