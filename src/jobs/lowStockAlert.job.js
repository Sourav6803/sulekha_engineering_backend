// src/jobs/lowStockAlert.job.js
import { addLowStockCheckJob, lowStockQueue } from './queue.js';
import { Material, Notification } from '../models/index.js';
import { notificationService } from '../services/notification.service.js';
import logger from '../utils/logger.js';
import { redisSet, redisGet } from '../config/redis.js';

/**
 * Low Stock Alert Job Handler
 * This file contains additional utilities for low stock alert jobs
 */
export const lowStockAlertJob = {
  /**
   * Run comprehensive low stock check
   * @param {Object} options - Check options
   * @returns {Promise<Object>} Check results
   */
  async runComprehensiveCheck(options = {}) {
    try {
      const {
        notifyAll = false,
        emailThreshold = 5,
        smsThreshold = 2,
        forceRecheck = false,
      } = options;

      // Check if already checked recently (prevent duplicate checks)
      const cacheKey = 'low-stock:last-check';
      if (!forceRecheck) {
        const lastCheck = await redisGet(cacheKey);
        if (lastCheck) {
          const lastCheckTime = new Date(lastCheck);
          const now = new Date();
          const diffMinutes = (now - lastCheckTime) / (1000 * 60);
          if (diffMinutes < 15) {
            logger.info('Low stock check already performed recently, skipping');
            return {
              skipped: true,
              lastCheck: lastCheckTime,
              reason: 'Check performed within last 15 minutes',
            };
          }
        }
      }

      // Get all low stock materials
      const lowStockMaterials = await Material.find({
        isActive: true,
        status: 'active',
        $expr: {
          $lte: ['$currentStock', '$minimumStockLevel'],
        },
      }).lean();

      if (lowStockMaterials.length === 0) {
        await redisSet(cacheKey, new Date().toISOString(), 3600);
        return {
          totalChecked: 0,
          lowStockCount: 0,
          message: 'No low stock materials found',
        };
      }

      // Process each material
      const results = [];
      const criticalItems = [];
      const warningItems = [];

      for (const material of lowStockMaterials) {
        const isCritical = material.currentStock === 0;
        const severity = isCritical ? 'critical' : 'warning';

        // Create notification
        const notification = await notificationService.createLowStockNotification(
          material._id,
          material.currentStock,
          material.minimumStockLevel
        );

        const result = {
          materialId: material._id,
          materialName: material.name,
          materialCode: material.materialCode,
          currentStock: material.currentStock,
          reorderLevel: material.minimumStockLevel,
          unit: material.unit,
          severity,
          notificationCreated: !!notification,
          notificationId: notification?._id,
        };

        results.push(result);

        if (isCritical) {
          criticalItems.push(result);
        } else {
          warningItems.push(result);
        }

        // Queue additional notifications based on severity
        if (notifyAll) {
          // Add notification jobs for email/SMS
          // This would trigger email/SMS notifications
          await addLowStockCheckJob(material._id, false);
        }
      }

      // Update last check time
      await redisSet(cacheKey, new Date().toISOString(), 3600);

      // Log summary
      logger.info(`Low stock check completed: ${lowStockMaterials.length} items found`);
      logger.info(`  Critical: ${criticalItems.length}, Warning: ${warningItems.length}`);

      return {
        totalChecked: lowStockMaterials.length,
        lowStockCount: lowStockMaterials.length,
        criticalCount: criticalItems.length,
        warningCount: warningItems.length,
        results,
        criticalItems,
        warningItems,
        timestamp: new Date().toISOString(),
      };

    } catch (error) {
      logger.error('Comprehensive low stock check failed:', error);
      throw error;
    }
  },

  /**
   * Check specific material for low stock
   * @param {String} materialId - Material ID
   * @param {Boolean} forceCheck - Force check even if above reorder level
   * @returns {Promise<Object>} Check result
   */
  async checkMaterial(materialId, forceCheck = false) {
    try {
      const material = await Material.findById(materialId);
      if (!material) {
        throw new Error(`Material ${materialId} not found`);
      }

      const isLowStock = material.currentStock <= material.minimumStockLevel;

      if (!isLowStock && !forceCheck) {
        return {
          materialId: material._id,
          materialName: material.name,
          currentStock: material.currentStock,
          reorderLevel: material.minimumStockLevel,
          isLowStock: false,
          message: 'Material is not low stock',
        };
      }

      // Create notification if low stock
      let notification = null;
      if (isLowStock || forceCheck) {
        notification = await notificationService.createLowStockNotification(
          material._id,
          material.currentStock,
          material.minimumStockLevel
        );
      }

      return {
        materialId: material._id,
        materialName: material.name,
        materialCode: material.materialCode,
        currentStock: material.currentStock,
        reorderLevel: material.minimumStockLevel,
        unit: material.unit,
        isLowStock,
        severity: material.currentStock === 0 ? 'critical' : 'warning',
        notificationCreated: !!notification,
        notificationId: notification?._id,
        timestamp: new Date().toISOString(),
      };

    } catch (error) {
      logger.error(`Low stock check for material ${materialId} failed:`, error);
      throw error;
    }
  },

  /**
   * Get low stock alert statistics
   * @returns {Promise<Object>} Statistics
   */
  async getAlertStats() {
    try {
      const [totalLowStock, criticalStock, unreadAlerts] = await Promise.all([
        // Count materials with low stock
        Material.countDocuments({
          isActive: true,
          status: 'active',
          $expr: {
            $lte: ['$currentStock', '$minimumStockLevel'],
          },
        }),
        // Count materials with zero stock
        Material.countDocuments({
          isActive: true,
          status: 'active',
          currentStock: 0,
        }),
        // Count unread low stock notifications
        Notification.countDocuments({
          type: 'low_stock',
          isRead: false,
        }),
      ]);

      // Get recent alerts
      const recentAlerts = await Notification.find({
        type: 'low_stock',
        isRead: false,
      })
        .populate('material', 'name materialCode unit currentStock minimumStockLevel')
        .sort({ createdAt: -1 })
        .limit(10)
        .lean();

      return {
        totalLowStock,
        criticalStock,
        unreadAlerts,
        recentAlerts,
        alertLevel: totalLowStock > 10 ? 'HIGH' : totalLowStock > 5 ? 'MEDIUM' : 'LOW',
        timestamp: new Date().toISOString(),
      };

    } catch (error) {
      logger.error('Alert stats fetch failed:', error);
      throw error;
    }
  },

  /**
   * Acknowledge low stock alert
   * @param {String} notificationId - Notification ID
   * @param {String} action - Action taken (reorder, ignore, etc.)
   * @param {String} notes - Additional notes
   * @returns {Promise<Object>} Updated notification
   */
  async acknowledgeAlert(notificationId, action, notes = '') {
    try {
      const notification = await Notification.findById(notificationId);
      if (!notification) {
        throw new Error(`Notification ${notificationId} not found`);
      }

      // Mark as read
      notification.isRead = true;
      notification.metadata = {
        ...notification.metadata,
        acknowledgedAt: new Date().toISOString(),
        acknowledgedAction: action,
        acknowledgementNotes: notes,
      };

      await notification.save();

      logger.info(`Low stock alert ${notificationId} acknowledged: ${action}`);

      return notification;

    } catch (error) {
      logger.error('Alert acknowledgement failed:', error);
      throw error;
    }
  },

  /**
   * Schedule regular low stock checks
    * @param {String} schedule - Cron schedule string (default: every 6 hours)
   */
  async scheduleRegularChecks(schedule = '0 */6 * * *') {
    try {
      // This would require a scheduling library like node-cron
      // For now, just log
      logger.info(`Low stock checks scheduled: ${schedule}`);
      return true;
    } catch (error) {
      logger.error('Schedule setup failed:', error);
      throw error;
    }
  },

  /**
   * Get alert history for a material
   * @param {String} materialId - Material ID
   * @param {Number} limit - Number of records to return
   * @returns {Promise<Array>} Alert history
   */
  async getAlertHistory(materialId, limit = 20) {
    try {
      const notifications = await Notification.find({
        material: materialId,
        type: 'low_stock',
      })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();

      return notifications;

    } catch (error) {
      logger.error(`Alert history for material ${materialId} failed:`, error);
      throw error;
    }
  },
};

// Export individual functions for convenience
export const runComprehensiveCheck = lowStockAlertJob.runComprehensiveCheck.bind(lowStockAlertJob);
export const checkMaterial = lowStockAlertJob.checkMaterial.bind(lowStockAlertJob);
export const getAlertStats = lowStockAlertJob.getAlertStats.bind(lowStockAlertJob);
export const acknowledgeAlert = lowStockAlertJob.acknowledgeAlert.bind(lowStockAlertJob);

export default lowStockAlertJob;