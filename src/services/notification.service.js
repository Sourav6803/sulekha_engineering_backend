// src/services/notification.service.js
import { Notification, Material } from '../models/index.js';
import logger from '../utils/logger.js';

/**
 * Notification Service - Handles all notification related logic
 */
export const notificationService = {
  /**
   * Create low stock notification
   * @param {String} materialId - Material ID
   * @param {Number} currentStock - Current stock level
   * @param {Number} reorderLevel - Reorder level
   * @param {Object} session - Mongoose session for transactions
   * @returns {Promise<Object>} Created notification
   */
  async createLowStockNotification(materialId, currentStock, reorderLevel, session = null) {
    try {
      // Get material details
      const material = await Material.findById(materialId).session(session);
      if (!material) {
        logger.warn(`Material ${materialId} not found for low stock notification`);
        return null;
      }

      // Check if notification already exists for this material
      const existing = await Notification.findOne({
        material: materialId,
        type: 'low_stock',
        isRead: false,
      }).session(session);

      if (existing) {
        // Update existing notification with latest stock info
        existing.message = this.buildLowStockMessage(material, currentStock, reorderLevel);
        await existing.save({ session });
        return existing;
      }

      // Create new notification
      const notification = await Notification.create([{
        type: 'low_stock',
        material: materialId,
        message: this.buildLowStockMessage(material, currentStock, reorderLevel),
        isRead: false,
        metadata: {
          currentStock,
          reorderLevel,
          materialName: material.name,
          materialCode: material.materialCode,
        },
      }], { session });

      logger.warn(`Low stock notification created for ${material.name} (${material.materialCode})`);

      return notification[0];

    } catch (error) {
      logger.error('Low stock notification creation failed:', error);
      throw error;
    }
  },

  /**
   * Build low stock message
   * @param {Object} material - Material object
   * @param {Number} currentStock - Current stock level
   * @param {Number} reorderLevel - Reorder level
   * @returns {string} Notification message
   */
  buildLowStockMessage(material, currentStock, reorderLevel) {
    const urgency = currentStock === 0 ? 'CRITICAL' : 'WARNING';
    const emoji = currentStock === 0 ? '🚨' : '⚠️';
    
    return `${emoji} ${urgency}: ${material.name} (${material.materialCode}) stock is ${currentStock === 0 ? 'COMPLETELY OUT' : 'LOW'}. ` +
           `Current stock: ${currentStock} ${material.unit}, Reorder level: ${reorderLevel} ${material.unit}. ` +
           `Please reorder immediately.`;
  },

  /**
   * Get all unread notifications
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Unread notifications
   */
  async getUnreadNotifications(options = {}) {
    try {
      const { limit = 20, page = 1 } = options;

      const [notifications, total] = await Promise.all([
        Notification.find({ isRead: false })
          .populate('material', 'name materialCode unit')
          .sort({ createdAt: -1 })
          .limit(limit)
          .skip((page - 1) * limit)
          .lean(),
        Notification.countDocuments({ isRead: false }),
      ]);

      return {
        notifications,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
        unreadCount: total,
      };

    } catch (error) {
      logger.error('Unread notifications fetch failed:', error);
      throw error;
    }
  },

  /**
   * Mark notification as read
   * @param {String} notificationId - Notification ID
   * @returns {Promise<Object>} Updated notification
   */
  async markAsRead(notificationId) {
    try {
      const notification = await Notification.findByIdAndUpdate(
        notificationId,
        { isRead: true },
        { new: true }
      );

      if (!notification) {
        throw new ApiError(404, 'Notification not found');
      }

      return notification;

    } catch (error) {
      logger.error('Mark notification as read failed:', error);
      throw error;
    }
  },

  /**
   * Mark all notifications as read
   * @returns {Promise<Object>} Update result
   */
  async markAllAsRead() {
    try {
      const result = await Notification.updateMany(
        { isRead: false },
        { isRead: true }
      );

      logger.info(`Marked ${result.modifiedCount} notifications as read`);

      return {
        modifiedCount: result.modifiedCount,
        message: `Marked ${result.modifiedCount} notifications as read`,
      };

    } catch (error) {
      logger.error('Mark all notifications as read failed:', error);
      throw error;
    }
  },

  /**
   * Delete old notifications
   * @param {Number} daysToKeep - Days to keep notifications
   * @returns {Promise<Object>} Delete result
   */
  async deleteOldNotifications(daysToKeep = 30) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

      // Only delete read notifications older than cutoff
      const result = await Notification.deleteMany({
        isRead: true,
        createdAt: { $lt: cutoffDate },
      });

      logger.info(`Deleted ${result.deletedCount} old notifications`);

      return {
        deletedCount: result.deletedCount,
        message: `Deleted ${result.deletedCount} notifications older than ${daysToKeep} days`,
      };

    } catch (error) {
      logger.error('Delete old notifications failed:', error);
      throw error;
    }
  },

  /**
   * Get notification statistics
   * @returns {Promise<Object>} Notification statistics
   */
  async getNotificationStats() {
    try {
      const [total, unread, lowStock] = await Promise.all([
        Notification.countDocuments(),
        Notification.countDocuments({ isRead: false }),
        Notification.countDocuments({ type: 'low_stock', isRead: false }),
      ]);

      // Get low stock notifications with material details
      const lowStockNotifications = await Notification.find({
        type: 'low_stock',
        isRead: false,
      })
        .populate('material', 'name materialCode unit currentStock minimumStockLevel')
        .sort({ createdAt: -1 })
        .limit(10)
        .lean();

      return {
        total,
        unread,
        lowStock,
        lowStockNotifications,
        readPercentage: total > 0 ? ((total - unread) / total) * 100 : 0,
      };

    } catch (error) {
      logger.error('Notification stats fetch failed:', error);
      throw error;
    }
  },

  /**
   * Send email notification (placeholder)
   * @param {String} email - Recipient email
   * @param {String} subject - Email subject
   * @param {String} message - Email message
   * @returns {Promise<Boolean>} Success status
   */
  async sendEmailNotification(email, subject, message) {
    try {
      // TODO: Implement actual email sending
      // This is a placeholder for future implementation
      logger.info(`Email notification would be sent to ${email}: ${subject}`);
      return true;
    } catch (error) {
      logger.error('Email notification failed:', error);
      return false;
    }
  },

  /**
   * Send SMS notification (placeholder)
   * @param {String} phone - Recipient phone
   * @param {String} message - SMS message
   * @returns {Promise<Boolean>} Success status
   */
  async sendSMSNotification(phone, message) {
    try {
      // TODO: Implement actual SMS sending
      // This is a placeholder for future implementation
      logger.info(`SMS notification would be sent to ${phone}: ${message.substring(0, 50)}...`);
      return true;
    } catch (error) {
      logger.error('SMS notification failed:', error);
      return false;
    }
  },
};