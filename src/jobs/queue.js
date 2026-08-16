// src/jobs/queue.js
import BullMQ from 'bullmq';
import Redis from 'ioredis';
import config from '../config/env.js';
import logger from '../utils/logger.js';
import { pdfService } from '../services/pdf.service.js';
import { notificationService } from '../services/notification.service.js';
import { installationService } from '../services/installation.service.js';

const { Queue, Worker } = BullMQ;

// ============================================
// REDIS CONNECTION
// ============================================

const connection = new Redis({
  host: config.BULL_REDIS_HOST || config.REDIS_HOST,
  port: parseInt(config.BULL_REDIS_PORT || config.REDIS_PORT, 10),
  username: config.BULL_REDIS_USERNAME || config.REDIS_USERNAME || (config.BULL_REDIS_PASSWORD || config.REDIS_PASSWORD ? 'default' : undefined),
  password: config.BULL_REDIS_PASSWORD || config.REDIS_PASSWORD,
  db: parseInt(config.BULL_REDIS_DB, 10),
  tls: config.REDIS_TLS ? { servername: config.BULL_REDIS_HOST || config.REDIS_HOST, rejectUnauthorized: false } : undefined,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  retryStrategy: (times) => {
    if (times > 3) {
      logger.error(`Redis connection failed after ${times} retries`);
      return null;
    }
    return Math.min(times * 100, 2000);
  },
});

console.log('DEBUG queue.js connection DB:', connection.options.db, 'host:', connection.options.host);

const queueOptions = {
  connection,
  skipVersionCheck: true,
};

const workerOptions = {
  connection,
  skipVersionCheck: true,
};

// ============================================
// QUEUE DEFINITIONS
// ============================================

// PDF Generation Queue
export const pdfQueue = new Queue('pdf-generation', {
  ...queueOptions,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: {
      age: 3600, // 1 hour
      count: 100,
    },
    removeOnFail: {
      age: 86400, // 24 hours
    },
    timeout: 300000, // 5 minutes
  },
});

// Low Stock Alert Queue
export const lowStockQueue = new Queue('low-stock-alerts', {
  ...queueOptions,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: {
      age: 86400, // 24 hours
    },
    removeOnFail: {
      age: 604800, // 7 days
    },
  },
});

// Notification Queue
export const notificationQueue = new Queue('notifications', {
  ...queueOptions,
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
    removeOnComplete: {
      age: 3600, // 1 hour
    },
    removeOnFail: {
      age: 86400, // 24 hours
    },
  },
});

// Report Generation Queue
export const reportQueue = new Queue('reports', {
  ...queueOptions,
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: 'exponential',
      delay: 10000,
    },
    removeOnComplete: {
      age: 86400, // 24 hours
    },
    removeOnFail: {
      age: 604800, // 7 days
    },
  },
});

// Email Queue
export const emailQueue = new Queue('emails', {
  ...queueOptions,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 3000,
    },
    removeOnComplete: {
      age: 3600, // 1 hour
    },
    removeOnFail: {
      age: 86400, // 24 hours
    },
  },
});

// ============================================
// WORKER DEFINITIONS
// ============================================

// PDF Generation Worker
export const pdfWorker = new Worker(
  'pdf-generation',
  async (job) => {
    const { installationId, type, options } = job.data;
    
    logger.info(`Processing PDF generation job ${job.id} for installation ${installationId}`);

    try {
      let result;
      
      switch (type) {
        case 'bom':
          // Get installation with details
          const installation = await installationService.getInstallationWithDetails(installationId);
          if (!installation) {
            throw new Error(`Installation ${installationId} not found`);
          }
          
          // Generate PDF
          const pdfBuffer = await pdfService.generateBOMPDF(installation);
          
          result = {
            installationId,
            type: 'bom',
            buffer: pdfBuffer,
            size: pdfBuffer.length,
            generatedAt: new Date().toISOString(),
          };
          break;

        case 'invoice':
          // Placeholder for invoice PDF generation
          throw new Error('Invoice PDF generation not implemented yet');

        default:
          throw new Error(`Unknown PDF type: ${type}`);
      }

      logger.info(`PDF generation job ${job.id} completed successfully`);

      return result;

    } catch (error) {
      logger.error(`PDF generation job ${job.id} failed:`, error);
      throw error;
    }
  },
  {
    ...workerOptions,
    concurrency: 2, // PDF generation is CPU intensive
    limiter: {
      max: 10,
      duration: 60000, // 10 jobs per minute
    },
    stalledInterval: 30000,
    maxStalledCount: 3,
  }
);

// Low Stock Alert Worker
export const lowStockWorker = new Worker(
  'low-stock-alerts',
  async (job) => {
    const { materialId, currentStock, reorderLevel, checkAll } = job.data;
    
    logger.info(`Processing low stock alert job ${job.id} for material ${materialId}`);

    try {
      if (checkAll) {
        // Check all materials for low stock
        const { Material } = await import('../models/index.js');
        
        const lowStockMaterials = await Material.find({
          isActive: true,
          status: 'active',
          $expr: {
            $lte: ['$currentStock', '$minimumStockLevel'],
          },
        });

        const results = [];
        for (const material of lowStockMaterials) {
          const notification = await notificationService.createLowStockNotification(
            material._id,
            material.currentStock,
            material.minimumStockLevel
          );
          results.push({
            materialId: material._id,
            materialName: material.name,
            currentStock: material.currentStock,
            reorderLevel: material.minimumStockLevel,
            notificationCreated: !!notification,
          });
        }

        return {
          totalChecked: lowStockMaterials.length,
          notificationsCreated: results.filter(r => r.notificationCreated).length,
          results,
        };
      } else {
        // Check specific material
        const notification = await notificationService.createLowStockNotification(
          materialId,
          currentStock,
          reorderLevel
        );

        return {
          materialId,
          currentStock,
          reorderLevel,
          notificationCreated: !!notification,
        };
      }

    } catch (error) {
      logger.error(`Low stock alert job ${job.id} failed:`, error);
      throw error;
    }
  },
  {
    ...workerOptions,
    concurrency: 5,
    stalledInterval: 30000,
    maxStalledCount: 2,
  }
);

// Notification Worker
export const notificationWorker = new Worker(
  'notifications',
  async (job) => {
    const { type, data, channels } = job.data;
    
    logger.info(`Processing notification job ${job.id} of type ${type}`);

    try {
      const results = {};

      // Process different notification types
      switch (type) {
        case 'low_stock':
          if (channels.includes('email')) {
            // Send email notification
            // results.email = await notificationService.sendEmailNotification(
            //   data.email,
            //   'Low Stock Alert',
            //   data.message
            // );
          }
          
          if (channels.includes('sms')) {
            // Send SMS notification
            // results.sms = await notificationService.sendSMSNotification(
            //   data.phone,
            //   data.message
            // );
          }
          
          if (channels.includes('in_app')) {
            // In-app notification already created
            results.in_app = true;
          }
          break;

        case 'installation_complete':
          // Handle installation completion notifications
          break;

        case 'purchase_created':
          // Handle purchase creation notifications
          break;

        default:
          throw new Error(`Unknown notification type: ${type}`);
      }

      return results;

    } catch (error) {
      logger.error(`Notification job ${job.id} failed:`, error);
      throw error;
    }
  },
  {
    ...workerOptions,
    concurrency: 10,
    stalledInterval: 30000,
    maxStalledCount: 2,
  }
);

// Report Generation Worker
export const reportWorker = new Worker(
  'reports',
  async (job) => {
    const { type, options } = job.data;
    
    logger.info(`Processing report generation job ${job.id} of type ${type}`);

    try {
      let result;

      switch (type) {
        case 'installation_summary':
          // Generate installation summary report
          // result = await installationService.getInstallationSummary(
          //   options.startDate,
          //   options.endDate
          // );
          break;

        case 'stock_report':
          // Generate stock report
          // result = await generateStockReport(options);
          break;

        case 'purchase_report':
          // Generate purchase report
          // result = await generatePurchaseReport(options);
          break;

        default:
          throw new Error(`Unknown report type: ${type}`);
      }

      return result;

    } catch (error) {
      logger.error(`Report generation job ${job.id} failed:`, error);
      throw error;
    }
  },
  {
    ...workerOptions,
    concurrency: 1,
    stalledInterval: 30000,
    maxStalledCount: 2,
  }
);

// Email Worker
export const emailWorker = new Worker(
  'emails',
  async (job) => {
    const { to, subject, template, data } = job.data;
    
    logger.info(`Processing email job ${job.id} to ${to}`);

    try {
      // Placeholder for email sending
      // const result = await emailService.sendEmail(to, subject, template, data);
      
      // Simulate email sending
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      return {
        to,
        subject,
        sent: true,
        timestamp: new Date().toISOString(),
      };

    } catch (error) {
      logger.error(`Email job ${job.id} failed:`, error);
      throw error;
    }
  },
  {
    ...workerOptions,
    concurrency: 5,
    stalledInterval: 30000,
    maxStalledCount: 3,
  }
);

// ============================================
// QUEUE SCHEDULERS
// ============================================

// BullMQ v5 no longer requires a QueueScheduler instance.
export const queueScheduler = null;

// ============================================
// QUEUE EVENT HANDLERS
// ============================================

// PDF Queue Events
pdfQueue.on('completed', (job, result) => {
  logger.info(`PDF job ${job.id} completed successfully`);
});

pdfQueue.on('failed', (job, err) => {
  logger.error(`PDF job ${job.id} failed:`, err);
});

pdfQueue.on('stalled', (jobId) => {
  logger.warn(`PDF job ${jobId} stalled`);
});

// Low Stock Queue Events
lowStockQueue.on('completed', (job, result) => {
  logger.info(`Low stock check job ${job.id} completed:`, result);
});

lowStockQueue.on('failed', (job, err) => {
  logger.error(`Low stock check job ${job.id} failed:`, err);
});

// Notification Queue Events
notificationQueue.on('completed', (job, result) => {
  logger.info(`Notification job ${job.id} completed`);
});

notificationQueue.on('failed', (job, err) => {
  logger.error(`Notification job ${job.id} failed:`, err);
});

// Report Queue Events
reportQueue.on('completed', (job, result) => {
  logger.info(`Report job ${job.id} completed`);
});

reportQueue.on('failed', (job, err) => {
  logger.error(`Report job ${job.id} failed:`, err);
});

// Email Queue Events
emailQueue.on('completed', (job, result) => {
  logger.info(`Email job ${job.id} completed to ${job.data.to}`);
});

emailQueue.on('failed', (job, err) => {
  logger.error(`Email job ${job.id} failed:`, err);
});

// ============================================
// WORKER EVENT HANDLERS
// ============================================

pdfWorker.on('ready', () => {
  logger.info('PDF Worker is ready');
});

pdfWorker.on('error', (err) => {
  logger.error('PDF Worker error:', err);
});

pdfWorker.on('closed', () => {
  logger.info('PDF Worker closed');
});

lowStockWorker.on('ready', () => {
  logger.info('Low Stock Worker is ready');
});

lowStockWorker.on('error', (err) => {
  logger.error('Low Stock Worker error:', err);
});

notificationWorker.on('ready', () => {
  logger.info('Notification Worker is ready');
});

notificationWorker.on('error', (err) => {
  logger.error('Notification Worker error:', err);
});

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Initialize all queues and workers
 */
export const initializeQueue = async () => {
  try {
    // Clean up old jobs
    await pdfQueue.clean(86400000, 1000); // Clean jobs older than 24 hours
    await lowStockQueue.clean(86400000, 1000);
    await notificationQueue.clean(86400000, 1000);
    await reportQueue.clean(86400000, 1000);
    await emailQueue.clean(86400000, 1000);

    logger.info('✅ All queues initialized successfully');
    return true;
  } catch (error) {
    logger.error('Queue initialization failed:', error);
    throw error;
  }
};

/**
 * Close all queues and workers
 */
export const closeQueue = async () => {
  try {
    await pdfQueue.close();
    await lowStockQueue.close();
    await notificationQueue.close();
    await reportQueue.close();
    await emailQueue.close();
    
    await pdfWorker.close();
    await lowStockWorker.close();
    await notificationWorker.close();
    await reportWorker.close();
    await emailWorker.close();
    
    if (queueScheduler) await queueScheduler.close();
    await connection.quit();

    logger.info('✅ All queues and workers closed successfully');
    return true;
  } catch (error) {
    logger.error('Queue close failed:', error);
    throw error;
  }
};

/**
 * Get queue metrics
 */
export const getQueueMetrics = async () => {
  try {
    const queues = {
      pdf: pdfQueue,
      lowStock: lowStockQueue,
      notification: notificationQueue,
      report: reportQueue,
      email: emailQueue,
    };

    const metrics = {};
    
    for (const [name, queue] of Object.entries(queues)) {
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        queue.getWaitingCount(),
        queue.getActiveCount(),
        queue.getCompletedCount(),
        queue.getFailedCount(),
        queue.getDelayedCount(),
      ]);

      metrics[name] = {
        waiting,
        active,
        completed,
        failed,
        delayed,
        total: waiting + active + completed + failed + delayed,
      };
    }

    return metrics;
  } catch (error) {
    logger.error('Queue metrics fetch failed:', error);
    throw error;
  }
};

/**
 * Add PDF generation job
 */
export const addPDFJob = async (installationId, type = 'bom', options = {}) => {
  try {
    const job = await pdfQueue.add(
      `pdf-${type}-${installationId}`,
      {
        installationId,
        type,
        options,
        timestamp: Date.now(),
      },
      {
        jobId: `pdf-${type}-${installationId}-${Date.now()}`,
        ...options,
      }
    );

    logger.info(`PDF job ${job.id} added to queue for installation ${installationId}`);
    return job;
  } catch (error) {
    logger.error('PDF job addition failed:', error);
    throw error;
  }
};

/**
 * Add low stock check job
 */
export const addLowStockCheckJob = async (materialId = null, checkAll = false) => {
  try {
    const jobData = {
      checkAll,
      timestamp: Date.now(),
    };

    if (materialId) {
      const { Material } = await import('../models/index.js');
      const material = await Material.findById(materialId);
      if (material) {
        jobData.materialId = materialId;
        jobData.currentStock = material.currentStock;
        jobData.reorderLevel = material.minimumStockLevel;
      }
    }

    const job = await lowStockQueue.add(
      `low-stock-${materialId || 'all'}`,
      jobData,
      {
        jobId: `low-stock-${materialId || 'all'}-${Date.now()}`,
      }
    );

    logger.info(`Low stock check job ${job.id} added to queue`);
    return job;
  } catch (error) {
    logger.error('Low stock check job addition failed:', error);
    throw error;
  }
};

/**
 * Add notification job
 */
export const addNotificationJob = async (type, data, channels = ['in_app']) => {
  try {
    const job = await notificationQueue.add(
      `notification-${type}`,
      {
        type,
        data,
        channels,
        timestamp: Date.now(),
      },
      {
        jobId: `notification-${type}-${Date.now()}`,
      }
    );

    logger.info(`Notification job ${job.id} added to queue`);
    return job;
  } catch (error) {
    logger.error('Notification job addition failed:', error);
    throw error;
  }
};

/**
 * Add report generation job
 */
export const addReportJob = async (type, options = {}) => {
  try {
    const job = await reportQueue.add(
      `report-${type}`,
      {
        type,
        options,
        timestamp: Date.now(),
      },
      {
        jobId: `report-${type}-${Date.now()}`,
      }
    );

    logger.info(`Report job ${job.id} added to queue`);
    return job;
  } catch (error) {
    logger.error('Report job addition failed:', error);
    throw error;
  }
};

/**
 * Add email job
 */
export const addEmailJob = async (to, subject, template, data = {}) => {
  try {
    const job = await emailQueue.add(
      `email-${template}`,
      {
        to,
        subject,
        template,
        data,
        timestamp: Date.now(),
      },
      {
        jobId: `email-${to}-${Date.now()}`,
      }
    );

    logger.info(`Email job ${job.id} added to queue for ${to}`);
    return job;
  } catch (error) {
    logger.error('Email job addition failed:', error);
    throw error;
  }
};

// ============================================
// EXPORT
// ============================================

export default {
  initializeQueue,
  closeQueue,
  getQueueMetrics,
  addPDFJob,
  addLowStockCheckJob,
  addNotificationJob,
  addReportJob,
  addEmailJob,
  pdfQueue,
  lowStockQueue,
  notificationQueue,
  reportQueue,
  emailQueue,
  pdfWorker,
  lowStockWorker,
  notificationWorker,
  reportWorker,
  emailWorker,
};
