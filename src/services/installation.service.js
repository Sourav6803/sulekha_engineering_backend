// src/services/installation.service.js
import mongoose from 'mongoose';
import { Installation, Material, StockLedger } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import logger from '../utils/logger.js';
import { startSession } from '../config/db.js';
import { notificationService } from './notification.service.js';
import { bomTemplateService } from './bomTemplate.service.js';

/**
 * Installation Service - Handles all installation related business logic
 */
export const installationService = {
  /**
   * Analyze load and inverter capacity for a system
   * @param {Number} systemSizeKW - System size in kW
   * @returns {Object} Load analysis result
   */
  analyzeLoad(systemSizeKW) {
    try {
      // Constants
      const averageConsumption = 4.5; // kWh per kW per day
      const submersibleLoad = 0.746; // 1HP = 0.746 kW
      const startingCurrent = submersibleLoad * 3; // 3x starting current
      const recommendedInverter = systemSizeKW * 1.2; // 20% buffer

      const dailyGeneration = systemSizeKW * averageConsumption;
      const canRunSubmersible = systemSizeKW >= startingCurrent;

      const result = {
        systemSizeKW,
        dailyGenerationKWh: parseFloat(dailyGeneration.toFixed(2)),
        recommendedInverterKW: parseFloat(recommendedInverter.toFixed(2)),
        submersibleCanRun: canRunSubmersible,
        submersiblePowerKW: parseFloat(submersibleLoad.toFixed(3)),
        startingPowerKW: parseFloat(startingCurrent.toFixed(3)),
        loadSuitability: canRunSubmersible ? 'SUFFICIENT' : 'INSUFFICIENT',
        recommendations: [],
      };

      if (!canRunSubmersible) {
        result.recommendations.push(
          `System ${systemSizeKW}kW is insufficient for 1HP submersible pump. ` +
          `Need at least ${parseFloat(startingCurrent.toFixed(2))}kW system.`
        );
      }

      if (systemSizeKW < 1) {
        result.recommendations.push(
          'System size is very small. Consider increasing capacity for better efficiency.'
        );
      }

      return result;

    } catch (error) {
      logger.error('Load analysis failed:', error);
      throw error;
    }
  },

  /**
   * Assign materials to installation with atomic stock updates
   * @param {String} installationId - Installation ID
   * @param {Array} items - Materials to assign
   * @param {String} idempotencyKey - Idempotency key
   * @param {String} userId - User ID
   * @returns {Promise<Object>} Updated installation
   */
  async assignMaterials(installationId, items, idempotencyKey, userId) {
    const session = await startSession();
    session.startTransaction({ readPreference: 'primary' });

    try {
      // Check idempotency
      if (idempotencyKey) {
        const existing = await Installation.findOne({
          'materialsUsed.idempotencyKey': idempotencyKey,
        }).session(session);

        if (existing) {
          await session.commitTransaction();
          session.endSession();
          return existing;
        }
      }

      // Get installation
      const installation = await Installation.findById(installationId)
        .populate('customer', 'name phone')
        .session(session);

      if (!installation) {
        throw ApiError.notFound('Installation');
      }

      // Check if installation can accept materials
      if (installation.status === 'completed') {
        throw ApiError.badRequest('Cannot assign materials to a completed installation');
      }

      if (installation.status === 'cancelled') {
        throw ApiError.badRequest('Cannot assign materials to a cancelled installation');
      }

      // Validate and prepare items
      const preparedItems = [];
      const ledgerEntries = [];
      const lowStockAlerts = [];

      for (const item of items) {
        let material;
        
        // Try to find by ObjectId first
        if (/^[0-9a-fA-F]{24}$/.test(item.material)) {
          material = await Material.findById(item.material).session(session);
        }
        
        // If not found by ObjectId, try to find by exact name
        if (!material) {
          material = await Material.findOne({
            name: { $regex: new RegExp(`^${item.material.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
            isActive: true,
            status: 'active'
          }).session(session);
        }
        
        // If still not found, try to find by description
        if (!material) {
          material = await Material.findOne({
            description: { $regex: new RegExp(item.material.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
            isActive: true,
            status: 'active'
          }).session(session);
        }
        
        if (!material) {
          throw ApiError.notFound(`Material "${item.material}" not found`);
        }

        if (!material.isActive || material.status !== 'active') {
          throw ApiError.badRequest(`Material ${material.name} is not active`);
        }

        // Check if enough stock is available
        if (material.currentStock < item.qty) {
          throw ApiError.conflict(
            `Insufficient stock for ${material.name}. ` +
            `Available: ${material.currentStock}, Required: ${item.qty}`
          );
        }

        // Atomic stock decrement
        const updatedMaterial = await Material.findOneAndUpdate(
          {
            _id: material._id,
            currentStock: { $gte: item.qty },
          },
          {
            $inc: { currentStock: -item.qty },
            $set: { updatedBy: userId },
          },
          {
            new: true,
            session,
            runValidators: true,
          }
        );

        if (!updatedMaterial) {
          throw ApiError.internal(`Failed to update stock for ${material.name}`);
        }

        // Prepare material usage record
        const totalCost = item.qty * (material.unitCost || 0);
        preparedItems.push({
          material: material._id,
          materialCodeSnapshot: material.materialCode,
          materialNameSnapshot: material.name,
          descriptionSnapshot: material.description || '',
          unitSnapshot: material.unit,
          qty: item.qty,
          unitCostSnapshot: material.unitCost || 0,
          totalCostSnapshot: totalCost,
          remark: item.remark || '',
          status: 'installed',
          installedBy: userId,
          installedAt: new Date(),
          idempotencyKey: idempotencyKey,
        });

        // Prepare ledger entry
        ledgerEntries.push({
          material: material._id,
          materialNameSnapshot: material.name,
          unitSnapshot: material.unit,
          direction: 'out',
          qty: item.qty,
          balanceAfter: updatedMaterial.currentStock,
          refType: 'installation',
          refId: installation._id,
          note: `Installation ${installation.installationId} - ${material.name}`,
        });

        // Check for low stock alert
        if (updatedMaterial.currentStock <= updatedMaterial.minimumStockLevel) {
          lowStockAlerts.push({
            materialId: material._id,
            currentStock: updatedMaterial.currentStock,
            reorderLevel: updatedMaterial.minimumStockLevel,
          });
        }
      }

      // Update installation with materials
      installation.materialsUsed.push(...preparedItems);
      installation.updatedBy = userId;

      // Calculate total cost
      const materialCost = preparedItems.reduce((sum, item) => sum + item.totalCostSnapshot, 0);
      installation.materialsCost = materialCost;
      installation.totalCost = materialCost + (installation.laborCost || 0);

      await installation.save({ session });

      // Create ledger entries
      if (ledgerEntries.length > 0) {
        await StockLedger.insertMany(ledgerEntries, { session });
      }

      // Create low stock notifications
      for (const alert of lowStockAlerts) {
        await notificationService.createLowStockNotification(
          alert.materialId,
          alert.currentStock,
          alert.reorderLevel,
          session
        );
      }

      await session.commitTransaction();
      session.endSession();

      logger.info(`Materials assigned to installation: ${installation.installationId} by ${userId}`);

      // Return populated installation
      return await Installation.findById(installationId)
        .populate('customer', 'name phone customerId')
        .populate('materialsUsed.material', 'name materialCode unit description category')
        .lean();

    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      logger.error('Material assignment failed:', error);
      throw error;
    }
  },

  /**
   * Reverse material assignment
   * @param {String} installationId - Installation ID
   * @param {String} usageId - Material usage ID
   * @param {String} reason - Reversal reason
   * @param {String} userId - User ID
   * @returns {Promise<Object>} Updated installation
   */
  async reverseAssignment(installationId, usageId, reason, userId) {
    const session = await startSession();
    session.startTransaction();

    try {
      // Get installation
      const installation = await Installation.findById(installationId)
        .populate('customer', 'name phone')
        .session(session);

      if (!installation) {
        throw ApiError.notFound('Installation');
      }

      // Find the material usage record
      const usageIndex = installation.materialsUsed.findIndex(
        u => u._id.toString() === usageId
      );

      if (usageIndex === -1) {
        throw ApiError.notFound('Material usage record');
      }

      const usage = installation.materialsUsed[usageIndex];

      // Check if already reversed
      if (usage.status === 'reversed') {
        throw ApiError.badRequest('Material already reversed');
      }

      // Get material
      const material = await Material.findById(usage.material).session(session);
      if (!material) {
        throw ApiError.notFound('Material not found');
      }

      // Reverse stock
      const updatedMaterial = await Material.findOneAndUpdate(
        {
          _id: material._id,
        },
        {
          $inc: { currentStock: usage.qty },
          $set: { updatedBy: userId },
        },
        {
          new: true,
          session,
          runValidators: true,
        }
      );

      if (!updatedMaterial) {
        throw ApiError.internal(`Failed to reverse stock for ${material.name}`);
      }

      // Update usage record
      usage.status = 'reversed';
      usage.reversedAt = new Date();
      usage.reversedBy = userId;
      usage.reversalReason = reason;

      installation.updatedBy = userId;
      await installation.save({ session });

      // Create ledger entry for reversal
      await StockLedger.create([{
        material: material._id,
        materialNameSnapshot: material.name,
        unitSnapshot: material.unit,
        direction: 'in',
        qty: usage.qty,
        balanceAfter: updatedMaterial.currentStock,
        refType: 'reversal',
        refId: installation._id,
        note: `Reversal of ${material.name} from ${installation.installationId} - ${reason}`,
      }], { session });

      await session.commitTransaction();
      session.endSession();

      logger.info(`Material reversed from installation: ${installation.installationId} by ${userId}`);

      // Return updated installation
      return await Installation.findById(installationId)
        .populate('customer', 'name phone customerId')
        .populate('materialsUsed.material', 'name materialCode unit description category')
        .lean();

    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      logger.error('Material reversal failed:', error);
      throw error;
    }
  },

  /**
   * Get installation with full details
   * @param {String} installationId - Installation ID
   * @returns {Promise<Object>} Installation with details
   */
  async getInstallationWithDetails(installationId) {
    try {
      const installation = await Installation.findById(installationId)
        .populate('customer', 'name phone customerId address city state pincode')
        .populate('materialsUsed.material', 'name materialCode unit description category')
        .populate('teamAssigned.member', 'name email phone')
        .populate('createdBy', 'name email')
        .populate('updatedBy', 'name email')
        .lean();

      if (!installation) {
        throw ApiError.notFound('Installation');
      }

      // Calculate additional metrics
      const metrics = {
        totalMaterials: installation.materialsUsed.length,
        totalQuantity: installation.materialsUsed.reduce((sum, m) => sum + m.qty, 0),
        totalCost: installation.materialsUsed.reduce((sum, m) => sum + m.totalCostSnapshot, 0),
        installedItems: installation.materialsUsed.filter(m => m.status === 'installed').length,
        reversedItems: installation.materialsUsed.filter(m => m.status === 'reversed').length,
        reservedItems: installation.materialsUsed.filter(m => m.status === 'reserved').length,
      };

      return {
        ...installation,
        metrics,
      };

    } catch (error) {
      logger.error('Installation details fetch failed:', error);
      throw error;
    }
  },

  /**
   * Get installation summary for a date range
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @returns {Promise<Object>} Installation summary
   */
  async getInstallationSummary(startDate, endDate) {
    try {
      const summary = await Installation.aggregate([
        {
          $match: {
            installDate: {
              $gte: new Date(startDate),
              $lte: new Date(endDate),
            },
            isActive: true,
          },
        },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            totalKW: { $sum: '$systemSizeKW' },
            totalCost: { $sum: '$totalCost' },
            avgKW: { $avg: '$systemSizeKW' },
            avgCost: { $avg: '$totalCost' },
          },
        },
        {
          $sort: { _id: 1 },
        },
      ]);

      // Calculate totals
      const totals = {
        totalInstallations: summary.reduce((sum, s) => sum + s.count, 0),
        totalKW: summary.reduce((sum, s) => sum + s.totalKW, 0),
        totalCost: summary.reduce((sum, s) => sum + s.totalCost, 0),
        avgKW: summary.reduce((sum, s) => sum + (s.totalKW || 0), 0) / 
               (summary.reduce((sum, s) => sum + s.count, 0) || 1),
        avgCost: summary.reduce((sum, s) => sum + (s.totalCost || 0), 0) / 
                 (summary.reduce((sum, s) => sum + s.count, 0) || 1),
      };

      return {
        byStatus: summary,
        totals,
      };

    } catch (error) {
      logger.error('Installation summary failed:', error);
      throw error;
    }
  },

  /**
   * Get material usage report
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @returns {Promise<Array>} Material usage report
   */
  async getMaterialUsageReport(startDate, endDate) {
    try {
      const report = await Installation.aggregate([
        {
          $match: {
            installDate: {
              $gte: new Date(startDate),
              $lte: new Date(endDate),
            },
            isActive: true,
            status: 'completed',
          },
        },
        { $unwind: '$materialsUsed' },
        {
          $match: {
            'materialsUsed.status': 'installed',
          },
        },
        {
          $group: {
            _id: '$materialsUsed.material',
            materialName: { $first: '$materialsUsed.materialNameSnapshot' },
            materialCode: { $first: '$materialsUsed.materialCodeSnapshot' },
            unit: { $first: '$materialsUsed.unitSnapshot' },
            totalQty: { $sum: '$materialsUsed.qty' },
            totalCost: { $sum: '$materialsUsed.totalCostSnapshot' },
            installations: { $addToSet: '$installationId' },
            customers: { $addToSet: '$customer' },
          },
        },
        {
          $lookup: {
            from: 'materials',
            localField: '_id',
            foreignField: '_id',
            as: 'materialDetails',
          },
        },
        {
          $unwind: {
            path: '$materialDetails',
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $project: {
            materialId: '$_id',
            materialName: 1,
            materialCode: 1,
            unit: 1,
            totalQty: 1,
            totalCost: 1,
            installationCount: { $size: '$installations' },
            customerCount: { $size: '$customers' },
            currentStock: '$materialDetails.currentStock',
          },
        },
        { $sort: { totalQty: -1 } },
      ]);

      return report;

    } catch (error) {
      logger.error('Material usage report failed:', error);
      throw error;
    }
  },

  /**
   * Get system performance stats
   * @returns {Promise<Object>} System performance stats
   */
  async getSystemPerformance() {
    try {
      const stats = await Installation.aggregate([
        {
          $match: {
            isActive: true,
            status: 'completed',
          },
        },
        {
          $group: {
            _id: '$roofType',
            count: { $sum: 1 },
            avgSizeKW: { $avg: '$systemSizeKW' },
            totalKW: { $sum: '$systemSizeKW' },
            avgCost: { $avg: '$totalCost' },
            totalCost: { $sum: '$totalCost' },
            avgDuration: {
              $avg: {
                $divide: [
                  { $subtract: ['$completionDate', '$installDate'] },
                  1000 * 60 * 60 * 24, // Convert to days
                ],
              },
            },
          },
        },
        {
          $project: {
            roofType: '$_id',
            count: 1,
            avgSizeKW: { $round: ['$avgSizeKW', 2] },
            totalKW: 1,
            avgCost: { $round: ['$avgCost', 2] },
            totalCost: 1,
            avgDurationDays: { $round: ['$avgDuration', 1] },
          },
        },
        { $sort: { count: -1 } },
      ]);

      return stats;

    } catch (error) {
      logger.error('System performance stats failed:', error);
      throw error;
    }
  },
};