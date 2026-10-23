// src/routes/banner.routes.js
import { Router } from 'express';
import { authenticate, authorize } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { uploadBannerImage } from '../middlewares/upload.js';
import * as bannerController from '../controllers/banner.controller.js';
import * as bannerValidation from '../validations/banner.validation.js';

const router = Router();
const canManage = [authenticate, authorize('admin', 'manager')];

// ===========================================================================
// MANAGEMENT
// ===========================================================================

router.get(
  '/admin',
  ...canManage,
  validate(bannerValidation.listBannerValidation, 'query'),
  asyncHandler(bannerController.adminList)
);

// Upload first, then send the returned url in the create/update body.
router.post(
  '/admin/upload',
  ...canManage,
  uploadBannerImage('image'),
  asyncHandler(bannerController.uploadImage)
);

// Static segment before `/:id` so "reorder" is never read as an id.
router.post(
  '/admin/reorder',
  ...canManage,
  validate(bannerValidation.reorderValidation),
  asyncHandler(bannerController.reorder)
);

router.post(
  '/admin',
  ...canManage,
  validate(bannerValidation.createBannerValidation),
  asyncHandler(bannerController.create)
);

router.put(
  '/admin/:id',
  ...canManage,
  validate(bannerValidation.idParamValidation, 'params'),
  validate(bannerValidation.updateBannerValidation),
  asyncHandler(bannerController.update)
);

router.patch(
  '/admin/:id/active',
  ...canManage,
  validate(bannerValidation.idParamValidation, 'params'),
  validate(bannerValidation.activeValidation),
  asyncHandler(bannerController.setActive)
);

router.delete(
  '/admin/:id',
  authenticate,
  authorize('admin'),
  validate(bannerValidation.idParamValidation, 'params'),
  asyncHandler(bannerController.remove)
);

// ===========================================================================
// PUBLIC
// ===========================================================================

router.get(
  '/',
  validate(bannerValidation.listBannerValidation, 'query'),
  asyncHandler(bannerController.list)
);

export default router;
