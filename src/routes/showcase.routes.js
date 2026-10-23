// src/routes/showcase.routes.js
import { Router } from 'express';
import { authenticate, authorize } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { uploadShowcaseMedia, uploadBannerImage } from '../middlewares/upload.js';
import * as showcaseController from '../controllers/showcase.controller.js';
import * as showcaseValidation from '../validations/showcase.validation.js';

const router = Router();

/**
 * Project stories.
 *
 * Public reads and management live under the same resource, so the management
 * routes are registered first and sit under `/admin`: a slug can then never
 * shadow them, and `/showcase/:slug` stays a plain read.
 *
 * Reads are anonymous because the home page is; every write is authenticated and
 * role-guarded, and deletion is admin-only.
 */
const canManage = [authenticate, authorize('admin', 'manager')];

// ===========================================================================
// MANAGEMENT  (registered before /:slug on purpose)
// ===========================================================================

router.get(
  '/admin',
  ...canManage,
  validate(showcaseValidation.adminListShowcaseValidation, 'query'),
  asyncHandler(showcaseController.adminList)
);

router.post(
  '/admin',
  ...canManage,
  validate(showcaseValidation.createProjectValidation),
  asyncHandler(showcaseController.create)
);

router.get(
  '/admin/:id',
  ...canManage,
  validate(showcaseValidation.idParamValidation, 'params'),
  asyncHandler(showcaseController.adminGet)
);

router.put(
  '/admin/:id',
  ...canManage,
  validate(showcaseValidation.updateProjectValidation),
  asyncHandler(showcaseController.update)
);

router.delete(
  '/admin/:id',
  authenticate,
  authorize('admin'),
  validate(showcaseValidation.idParamValidation, 'params'),
  asyncHandler(showcaseController.remove)
);

router.patch(
  '/admin/:id/publish',
  ...canManage,
  validate(showcaseValidation.publishValidation),
  asyncHandler(showcaseController.publish)
);

/**
 * Media. `uploadShowcaseMedia` accepts a photograph or a short clip in memory;
 * a JSON body with `url` attaches something already hosted instead.
 */
router.post(
  '/admin/:id/media',
  ...canManage,
  uploadShowcaseMedia('file'),
  validate(showcaseValidation.addMediaValidation),
  asyncHandler(showcaseController.addMedia)
);

router.delete(
  '/admin/:id/media/:mediaId',
  ...canManage,
  validate(showcaseValidation.mediaIdParamValidation, 'params'),
  asyncHandler(showcaseController.removeMedia)
);

/** Image-only uploader (10 MB); the cover is a single picture, not a gallery item. */
router.post(
  '/admin/:id/cover',
  ...canManage,
  uploadBannerImage('image'),
  asyncHandler(showcaseController.uploadCover)
);

// ===========================================================================
// PUBLIC
// ===========================================================================

router.get(
  '/',
  validate(showcaseValidation.listShowcaseValidation, 'query'),
  asyncHandler(showcaseController.list)
);

// Before `/:slug`, otherwise "summary" is read as a slug.
router.get('/summary', asyncHandler(showcaseController.summary));

router.get(
  '/:slug',
  validate(showcaseValidation.slugParamValidation, 'params'),
  asyncHandler(showcaseController.getBySlug)
);

export default router;
