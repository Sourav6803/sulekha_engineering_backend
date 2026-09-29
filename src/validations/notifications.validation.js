// src/validations/notification.validation.js
import Joi from 'joi';

/** Kept in step with the Notification model's `type` enum, plus 'document'. */
const NOTIFICATION_TYPES = [
  'low_stock',
  'installation',
  'purchase',
  'system',
  'scheme',
  'external',
  'document',
];

export const listNotificationsValidation = Joi.object({
  page: Joi.number().min(1).default(1),
  limit: Joi.number().min(1).max(100).default(20),
  unread: Joi.boolean().default(false),
  type: Joi.string().valid(...NOTIFICATION_TYPES),
  sortBy: Joi.string().valid('createdAt', 'updatedAt'),
  sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
});

export const markNotificationReadValidation = Joi.object({
  id: Joi.string().hex().length(24).required(),
});