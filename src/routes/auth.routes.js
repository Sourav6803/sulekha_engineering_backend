// src/routes/auth.routes.js
import { Router } from 'express';
import { authRateLimiter } from '../middlewares/rateLimiter.js';
import { validate } from '../middlewares/validate.js';
import { authenticate, authorize, refreshToken } from '../middlewares/auth.js';
import { 
  loginValidation, 
  registerValidation, 
  changePasswordValidation,
  forgotPasswordValidation,
  resetPasswordValidation 
} from '../validations/auth.validation.js';
import { 
  login,
  register,
  getProfile,
  updateProfile,
  changePassword,
  forgotPassword,
  resetPassword,
  logout
} from '../controllers/auth.controller.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

// Public routes
router.post(
  '/login',
  authRateLimiter,
  validate(loginValidation),
  asyncHandler(login)
);

router.post(
  '/register',
  // authRateLimiter,
  // authenticate,
  // authorize('admin'),
  validate(registerValidation),
  asyncHandler(register)
);

router.post(
  '/refresh-token',
  authRateLimiter,
  asyncHandler(refreshToken)
);

router.post(
  '/forgot-password',
  authRateLimiter,
  validate(forgotPasswordValidation),
  asyncHandler(forgotPassword)
);

router.post(
  '/reset-password',
  authRateLimiter,
  validate(resetPasswordValidation),
  asyncHandler(resetPassword)
);

// Protected routes
router.use(authenticate);

router.get(
  '/profile',
  asyncHandler(getProfile)
);

router.put(
  '/profile',
  asyncHandler(updateProfile)
);

router.post(
  '/change-password',
  validate(changePasswordValidation),
  asyncHandler(changePassword)
);

router.post(
  '/logout',
  asyncHandler(logout)
);

export default router;