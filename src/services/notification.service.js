// src/services/notification.service.js
import { Notification, Material } from '../models/index.js';
import { redisDel } from '../config/redis.js';
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
   * Tell one named user that the office has filed a signed copy.
   *
   * Addressed to the agent who owns the application, so it is the only person
   * who sees it — unlike the staff-wide low-stock alerts, which leave `recipient`
   * unset. The copy comes in ready-made from `data/signedDocumentNotice.js`,
   * which is what keeps the app notification and the email saying the same thing.
   *
   * @param {Object} args
   * @param {Object} args.application - The application the document was filed on.
   * @param {String} args.recipient - The agent's user id.
   * @param {Object} args.notice - The Bengali copy, from buildSignedDocumentNotice.
   * @returns {Promise<Object>} The stored notification.
   */
  async createSignedDocumentNotification({ application, recipient, notice }) {
    const created = await Notification.create({
      type: 'document',
      source: 'internal',
      recipient,
      title: notice.title,
      message: notice.message,
      // The client routes on this: a leading slash means an in-app destination,
      // not something to open in a new tab.
      link: `/applications/${application._id}`,
      category: 'info',
      priority: 'medium',
      isExternal: false,
      metadata: {
        applicationId: String(application._id),
        applicationNo: application.applicationNo,
        consumerName: application.consumerName,
        kinds: notice.kinds,
      },
    });

    // The list endpoints cache for an hour, so without this the agent's bell
    // would not ring until the cache aged out. Best-effort: the cache layer is a
    // no-op when Redis is down.
    await redisDel('notifications:list:*');
    await redisDel('notifications:unified:*');

    logger.info(
      { applicationNo: application.applicationNo, kinds: notice.kinds, recipient: String(recipient) },
      'Signed-document notification created'
    );

    return created;
  },

  /**
   * Tell one office user that a field agent has filed an application — either
   * opened a draft on it or submitted it.
   *
   * Addressed to the named recipient for the same reason the signed-copy notice
   * is: the office reads these, not the agents. Leaving `recipient` unset would
   * put every agent's filings in every agent's own bell, and the agent who filed
   * it already knows what they just did. The service fans this out to each
   * office user (see newApplicationNotice.service.js).
   *
   * The copy comes ready-made from `data/newApplicationNotice.js`, which is what
   * keeps the app notification and the email saying the same thing.
   *
   * @param {Object} args
   * @param {Object} args.application - The application that was filed.
   * @param {String} args.recipient - The office user's id.
   * @param {Object} args.notice - The Bengali copy, from buildNewApplicationNotice.
   * @returns {Promise<Object>} The stored notification.
   */
  async createNewApplicationNotification({ application, recipient, notice }) {
    const created = await Notification.create({
      type: 'application',
      source: 'internal',
      recipient,
      title: notice.title,
      message: notice.message,
      // The client routes on this: a leading slash means an in-app destination,
      // not something to open in a new tab.
      link: `/applications/${application._id}`,
      category: notice.category,
      priority: notice.priority,
      isExternal: false,
      metadata: {
        applicationId: String(application._id),
        applicationNo: application.applicationNo,
        consumerName: application.consumerName,
        agentName: application.agentNameSnapshot,
        stage: notice.stage,
        resubmitted: notice.resubmitted === true,
        systemSizeKW: application.deal?.systemSizeKW ?? null,
      },
    });

    // The list endpoints cache for an hour, so without this the office bell would
    // not ring until the cache aged out. Best-effort: the cache layer is a no-op
    // when Redis is down.
    await redisDel('notifications:list:*');
    await redisDel('notifications:unified:*');

    logger.info(
      {
        applicationNo: application.applicationNo,
        stage: notice.stage,
        recipient: String(recipient),
      },
      'New-application notification created'
    );

    return created;
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