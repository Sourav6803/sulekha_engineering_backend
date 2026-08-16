// src/jobs/pdfGeneration.job.js
import { addPDFJob, pdfQueue } from './queue.js';
import { Installation } from '../models/index.js';
import { pdfService } from '../services/pdf.service.js';
import { installationService } from '../services/installation.service.js';
import logger from '../utils/logger.js';
import { redisSet, redisGet } from '../config/redis.js';

/**
 * PDF Generation Job Handler
 * This file contains additional utilities for PDF generation jobs
 */
export const pdfGenerationJob = {
  /**
   * Generate BOM PDF asynchronously
   * @param {String} installationId - Installation ID
   * @param {Object} options - Generation options
   * @returns {Promise<Object>} Job info
   */
  async generateBOMAsync(installationId, options = {}) {
    try {
      // Check if installation exists
      const installation = await Installation.findById(installationId);
      if (!installation) {
        throw new Error(`Installation ${installationId} not found`);
      }

      // Check if PDF already generated recently
      const cacheKey = `pdf:bom:${installationId}`;
      const cached = await redisGet(cacheKey);
      if (cached && !options.forceRegenerate) {
        logger.info(`BOM PDF for ${installationId} found in cache`);
        return {
          cached: true,
          ...cached,
        };
      }

      // Add job to queue
      const job = await addPDFJob(installationId, 'bom', {
        priority: options.priority || 0,
        delay: options.delay || 0,
      });

      logger.info(`BOM PDF job ${job.id} queued for installation ${installationId}`);

      return {
        jobId: job.id,
        installationId,
        status: 'queued',
        estimatedWaitTime: job.queue.getJobCounts(),
      };

    } catch (error) {
      logger.error('BOM PDF async generation failed:', error);
      throw error;
    }
  },

  /**
   * Generate BOM PDF synchronously (direct generation)
   * @param {String} installationId - Installation ID
   * @returns {Promise<Buffer>} PDF buffer
   */
  async generateBOMSync(installationId) {
    try {
      // Get installation with details
      const installation = await installationService.getInstallationWithDetails(installationId);
      if (!installation) {
        throw new Error(`Installation ${installationId} not found`);
      }

      // Check if there are materials
      if (!installation.materialsUsed || installation.materialsUsed.length === 0) {
        throw new Error('No materials assigned to generate BOM');
      }

      // Generate PDF
      const pdfBuffer = await pdfService.generateBOMPDF(installation);

      // Cache the PDF (store as base64 or metadata)
      const cacheKey = `pdf:bom:${installationId}`;
      await redisSet(cacheKey, {
        installationId,
        generatedAt: new Date().toISOString(),
        size: pdfBuffer.length,
        cached: true,
      }, 3600); // Cache for 1 hour

      logger.info(`BOM PDF generated synchronously for ${installationId}`);

      return pdfBuffer;

    } catch (error) {
      logger.error('BOM PDF sync generation failed:', error);
      throw error;
    }
  },

  /**
   * Get PDF generation status
   * @param {String} jobId - Job ID
   * @returns {Promise<Object>} Job status
   */
  async getPDFStatus(jobId) {
    try {
      const job = await pdfQueue.getJob(jobId);
      
      if (!job) {
        return {
          jobId,
          status: 'not_found',
          message: 'Job not found or already completed',
        };
      }

      const state = await job.getState();
      const progress = job.progress;
      const result = job.returnvalue;

      return {
        jobId,
        status: state,
        progress,
        result: state === 'completed' ? result : undefined,
        failedReason: state === 'failed' ? job.failedReason : undefined,
        timestamp: {
          created: job.timestamp,
          processed: job.processedOn,
          finished: job.finishedOn,
        },
      };

    } catch (error) {
      logger.error('PDF status check failed:', error);
      throw error;
    }
  },

  /**
   * Cancel PDF generation job
   * @param {String} jobId - Job ID
   * @returns {Promise<Boolean>} Success status
   */
  async cancelPDFJob(jobId) {
    try {
      const job = await pdfQueue.getJob(jobId);
      
      if (!job) {
        return false;
      }

      const state = await job.getState();
      if (state === 'waiting' || state === 'delayed') {
        await job.remove();
        logger.info(`PDF job ${jobId} cancelled`);
        return true;
      }

      return false;

    } catch (error) {
      logger.error('PDF job cancellation failed:', error);
      throw error;
    }
  },

  /**
   * Cleanup old PDF cache
   * @param {Number} olderThan - Delete cache older than these many hours
   * @returns {Promise<Number>} Number of cache entries cleaned
   */
  async cleanupPDFCache(olderThan = 24) {
    try {
      // This would require a pattern-based deletion
      // Implementation depends on Redis configuration
      // For now, just log
      logger.info(`PDF cache cleanup requested (older than ${olderThan} hours)`);
      return 0;
    } catch (error) {
      logger.error('PDF cache cleanup failed:', error);
      throw error;
    }
  },

  /**
   * Get PDF generation statistics
   * @returns {Promise<Object>} Statistics
   */
  async getPDFStats() {
    try {
      const [waiting, active, completed, failed] = await Promise.all([
        pdfQueue.getWaitingCount(),
        pdfQueue.getActiveCount(),
        pdfQueue.getCompletedCount(),
        pdfQueue.getFailedCount(),
      ]);

      return {
        queue: {
          waiting,
          active,
          completed,
          failed,
          total: waiting + active + completed + failed,
        },
        pdfTypes: {
          bom: 'Available',
          invoice: 'Not Implemented',
          custom: 'Available',
        },
        cache: {
          ttl: '1 hour',
          maxSize: '100 MB (estimated)',
        },
      };

    } catch (error) {
      logger.error('PDF stats fetch failed:', error);
      throw error;
    }
  },
};

// Export individual functions for convenience
export const generateBOMAsync = pdfGenerationJob.generateBOMAsync.bind(pdfGenerationJob);
export const generateBOMSync = pdfGenerationJob.generateBOMSync.bind(pdfGenerationJob);
export const getPDFStatus = pdfGenerationJob.getPDFStatus.bind(pdfGenerationJob);
export const cancelPDFJob = pdfGenerationJob.cancelPDFJob.bind(pdfGenerationJob);

export default pdfGenerationJob;