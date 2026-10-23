// src/routes/lead.routes.js
import { Router } from 'express';
import { authenticate, authorize } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as leadController from '../controllers/lead.controller.js';
import * as leadValidation from '../validations/lead.validation.js';

const router = Router();
const canManage = [authenticate, authorize('admin', 'manager')];

/**
 * Enquiries.
 *
 * The POST on `/` is the only anonymous write in the module — it is the form on
 * the public site. Everything that touches the list is authenticated; assigning
 * and reading stats are office work, so manager and above.
 */

router.post(
  '/',
  validate(leadValidation.createLeadValidation),
  asyncHandler(leadController.create)
);

// ===========================================================================
// MANAGEMENT
// ===========================================================================

router.get(
  '/admin',
  ...canManage,
  validate(leadValidation.listLeadsValidation, 'query'),
  asyncHandler(leadController.list)
);

// Before `/:id`, otherwise "stats" is read as a lead id.
router.get('/admin/stats', ...canManage, asyncHandler(leadController.stats));

router.get(
  '/admin/:id',
  ...canManage,
  validate(leadValidation.idParamValidation, 'params'),
  asyncHandler(leadController.get)
);

router.patch(
  '/admin/:id/status',
  ...canManage,
  validate(leadValidation.idParamValidation, 'params'),
  validate(leadValidation.updateStatusValidation),
  asyncHandler(leadController.updateStatus)
);

router.post(
  '/admin/:id/notes',
  ...canManage,
  validate(leadValidation.idParamValidation, 'params'),
  validate(leadValidation.noteValidation),
  asyncHandler(leadController.addNote)
);

router.patch(
  '/admin/:id/assign',
  ...canManage,
  validate(leadValidation.idParamValidation, 'params'),
  validate(leadValidation.assignValidation),
  asyncHandler(leadController.assign)
);

export default router;
