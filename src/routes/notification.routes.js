// src/routes/notification.routes.js
import { Router } from 'express';
import { authenticate } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as notificationController from '../controllers/notification.controller.js';
import * as notificationValidation from '../validations/notifications.validation.js';

const router = Router();

// All notification routes require authentication
router.use(authenticate);

// GET /api/v1/notifications - List notifications
router.get(
  '/',
  validate(notificationValidation.listNotificationsValidation, 'query'),
  asyncHandler(notificationController.listNotifications)
);

// GET /api/v1/notifications/unified - Get unified internal + external notifications
router.get(
  '/unified',
  validate(notificationValidation.listNotificationsValidation, 'query'),
  asyncHandler(notificationController.getUnifiedNotifications)
);

// GET /api/v1/notifications/unread-count - Get unread count
router.get(
  '/unread-count',
  asyncHandler(notificationController.getUnreadCount)
);

// GET /api/v1/notifications/external/pm-surya-ghar - Fetch PM Surya Ghar notifications
router.get(
  '/external/pm-surya-ghar',
  asyncHandler(notificationController.fetchPMSuryaGharNotifications)
);

// PUT /api/v1/notifications/:id/read - Mark notification as read
router.put(
  '/:id/read',
  validate(notificationValidation.markNotificationReadValidation, 'params'),
  asyncHandler(notificationController.markAsRead)
);

// PUT /api/v1/notifications/read-all - Mark all as read
router.put(
  '/read-all',
  asyncHandler(notificationController.markAllAsRead)
);

export default router;
