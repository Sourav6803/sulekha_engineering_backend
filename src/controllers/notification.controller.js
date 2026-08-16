// src/controllers/notification.controller.js
import { Notification } from '../models/index.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import logger from '../utils/logger.js';

/**
 * List notifications with pagination
 */
export const listNotifications = async (req, res) => {
  const {
    page = 1,
    limit = 20,
    unread = false,
    type,
    sortBy = 'createdAt',
    sortOrder = 'desc',
  } = req.query;

  // Build filter
  const filter = {};
  if (unread === 'true') filter.isRead = false;
  if (type) filter.type = type;

  // Build sort
  const sort = {};
  sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

  // Execute query
  const [notifications, total] = await Promise.all([
    Notification.find(filter)
      .populate('material', 'name materialCode')
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Notification.countDocuments(filter),
  ]);

  const pagination = {
    page: parseInt(page),
    limit: parseInt(limit),
    total,
    pages: Math.ceil(total / limit),
  };

  return ApiResponse.sendPaginated(res, notifications, pagination, 'Notifications fetched successfully');
};

/**
 * Get unread notification count
 */
export const getUnreadCount = async (req, res) => {
  const count = await Notification.countDocuments({ isRead: false });

  return ApiResponse.send(res, { unreadCount: count }, 'Unread count fetched successfully');
};

/**
 * Mark notification as read
 */
export const markAsRead = async (req, res) => {
  const { id } = req.params;

  const notification = await Notification.findById(id);
  if (!notification) {
    throw ApiError.notFound('Notification');
  }

  notification.isRead = true;
  await notification.save();

  return ApiResponse.send(res, notification, 'Notification marked as read');
};

/**
 * Mark all notifications as read
 */
export const markAllAsRead = async (req, res) => {
  await Notification.updateMany({ isRead: false }, { isRead: true });

  return ApiResponse.send(res, null, 'All notifications marked as read');
};