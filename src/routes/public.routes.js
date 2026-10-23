// src/routes/public.routes.js
import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as siteController from '../controllers/site.controller.js';

const router = Router();

/**
 * Everything the marketing site reads in one request.
 *
 * Anonymous by design: the landing page is the first thing a visitor sees, and it
 * carries no customer data — published stories, aggregate counts, the company's
 * public contact details and the savings arithmetic.
 */
router.get('/home', asyncHandler(siteController.getHome));

export default router;
