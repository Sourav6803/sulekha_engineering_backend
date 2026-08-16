// src/services/purchase.service.js
import mongoose from 'mongoose';
import { Purchase, Material, StockLedger } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import logger from '../utils/logger.js';
import { startSession } from '../config/db.js';
import { notificationService } from './notification.service.js';

/**
 * Purchase Service - Handles all purchase related business logic
 * All operations are atomic using MongoDB transactions
 */
export const purchaseService = {
  /**
   * Create a new purchase with atomic stock updates
   * @param {Object} purchaseData - Purchase data
   * @returns {Promise<Object>} Created purchase
   */
  async createPurchase(purchaseData) {
    const session = await startSession();
    session.startTransaction();

    try {
      // Validate all materials exist and have valid data
      const materialIds = purchaseData.items.map(item => item.material);
      const materials = await Material.find({
        _id: { $in: materialIds },
        isActive: true,
      }).session(session);

      if (materials.length !== materialIds.length) {
        const foundIds = materials.map(m => m._id.toString());
        const missingIds = materialIds.filter(id => !foundIds.includes(id.toString()));
        throw ApiError.notFound(`Materials not found: ${missingIds.join(', ')}`);
      }

      // Prepare material snapshots and validate
      const enrichedItems = [];
      const stockUpdates = [];

      for (const item of purchaseData.items) {
        const material = materials.find(m => m._id.toString() === item.material.toString());
        
        // Calculate total cost for item
        const totalCost = item.qty * item.unitCost;
        
        enrichedItems.push({
          material: material._id,
          materialCodeSnapshot: material.materialCode,
          materialNameSnapshot: material.name,
          unitSnapshot: material.unit,
          qty: item.qty,
          unitCost: item.unitCost,
          totalCost: totalCost,
          discount: item.discount || 0,
        });

        // Prepare stock update
        stockUpdates.push({
          materialId: material._id,
          qty: item.qty,
          currentStock: material.currentStock,
        });
      }

      // Calculate totals
      const subtotal = enrichedItems.reduce((sum, item) => sum + item.totalCost, 0);
      const discount = purchaseData.discount || 0;
      const tax = purchaseData.tax || 0;
      const grandTotal = subtotal - discount + tax;

      // Create purchase
      const purchase = await Purchase.create([{
        ...purchaseData,
        items: enrichedItems,
        totalAmount: subtotal,
        grandTotal: grandTotal,
        createdBy: purchaseData.createdBy,
        updatedBy: purchaseData.updatedBy,
        idempotencyKey: purchaseData.idempotencyKey,
      }], { session });

      // Update stock for each material
      const ledgerEntries = [];
      for (const item of enrichedItems) {
        const material = materials.find(m => m._id.toString() === item.material.toString());
        
        // Atomic stock update with validation
        const updatedMaterial = await Material.findOneAndUpdate(
          { 
            _id: material._id, 
            currentStock: { $gte: 0 } 
          },
          { 
            $inc: { currentStock: item.qty },
            $set: { updatedBy: purchaseData.createdBy }
          },
          { 
            new: true,
            session,
            runValidators: true 
          }
        );

        if (!updatedMaterial) {
          throw ApiError.internal('Failed to update stock for material: ' + material.name);
        }

        // Create ledger entry
        ledgerEntries.push({
          material: material._id,
          materialNameSnapshot: material.name,
          unitSnapshot: material.unit,
          direction: 'in',
          qty: item.qty,
          balanceAfter: updatedMaterial.currentStock,
          refType: 'purchase',
          refId: purchase[0]._id,
          note: `Purchase: ${purchase[0].purchaseId}`,
        });
      }

      // Bulk create ledger entries
      if (ledgerEntries.length > 0) {
        await StockLedger.insertMany(ledgerEntries, { session });
      }

      // Check for low stock alerts (for materials that might still be low after purchase)
      for (const item of enrichedItems) {
        const material = materials.find(m => m._id.toString() === item.material.toString());
        if (material.currentStock <= material.minimumStockLevel) {
          await notificationService.createLowStockNotification(
            material._id,
            material.currentStock + item.qty, // New stock after purchase
            material.minimumStockLevel,
            session
          );
        }
      }

      await session.commitTransaction();
      session.endSession();

      logger.info(`Purchase created: ${purchase[0].purchaseId} with ${enrichedItems.length} items`);

      // Return populated purchase
      return await Purchase.findById(purchase[0]._id)
        .populate('supplier', 'name phone supplierId')
        .populate('items.material', 'name materialCode unit')
        .lean();

    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      logger.error('Purchase creation failed:', error);
      throw error;
    }
  },

  /**
   * Cancel a purchase and reverse stock
   * @param {String} purchaseId - Purchase ID
   * @param {String} userId - User ID performing cancellation
   * @param {String} reason - Cancellation reason
   * @returns {Promise<Object>} Cancelled purchase
   */
  async cancelPurchase(purchaseId, userId, reason) {
    const session = await startSession();
    session.startTransaction();

    try {
      // Get purchase with items
      const purchase = await Purchase.findById(purchaseId)
        .populate('items.material')
        .session(session);

      if (!purchase) {
        throw ApiError.notFound('Purchase');
      }

      if (purchase.status === 'completed') {
        throw ApiError.badRequest('Cannot cancel a completed purchase');
      }

      if (purchase.status === 'cancelled') {
        throw ApiError.badRequest('Purchase is already cancelled');
      }

      // Reverse stock for each item
      const ledgerEntries = [];
      for (const item of purchase.items) {
        // Validate material exists
        const material = await Material.findById(item.material._id).session(session);
        if (!material) {
          throw ApiError.notFound(`Material ${item.material.name} not found`);
        }

        // Check if material has enough stock to reverse
        if (material.currentStock < item.qty) {
          throw ApiError.conflict(
            `Insufficient stock to reverse ${item.material.name}. Current: ${material.currentStock}, Required: ${item.qty}`
          );
        }

        // Update stock
        const updatedMaterial = await Material.findOneAndUpdate(
          { 
            _id: material._id,
            currentStock: { $gte: item.qty }
          },
          { 
            $inc: { currentStock: -item.qty },
            $set: { updatedBy: userId }
          },
          { 
            new: true,
            session,
            runValidators: true 
          }
        );

        if (!updatedMaterial) {
          throw ApiError.internal(`Failed to reverse stock for ${material.name}`);
        }

        // Create ledger entry for reversal
        ledgerEntries.push({
          material: material._id,
          materialNameSnapshot: material.name,
          unitSnapshot: material.unit,
          direction: 'out',
          qty: item.qty,
          balanceAfter: updatedMaterial.currentStock,
          refType: 'reversal',
          refId: purchase._id,
          note: `Purchase cancellation: ${purchase.purchaseId} - ${reason}`,
        });
      }

      // Bulk create ledger entries
      if (ledgerEntries.length > 0) {
        await StockLedger.insertMany(ledgerEntries, { session });
      }

      // Update purchase status
      purchase.status = 'cancelled';
      purchase.notes = purchase.notes ? `${purchase.notes}\nCancelled: ${reason}` : `Cancelled: ${reason}`;
      purchase.updatedBy = userId;
      await purchase.save({ session });

      await session.commitTransaction();
      session.endSession();

      logger.info(`Purchase cancelled: ${purchase.purchaseId} by ${userId}`);

      return purchase;

    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      logger.error('Purchase cancellation failed:', error);
      throw error;
    }
  },

  /**
   * Get purchase summary for a date range
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @returns {Promise<Object>} Purchase summary
   */
  async getPurchaseSummary(startDate, endDate) {
    try {
      const summary = await Purchase.aggregate([
        {
          $match: {
            purchaseDate: {
              $gte: new Date(startDate),
              $lte: new Date(endDate),
            },
            isActive: true,
            status: 'completed',
          },
        },
        {
          $group: {
            _id: null,
            totalPurchases: { $sum: 1 },
            totalAmount: { $sum: '$grandTotal' },
            totalItems: { $sum: { $sum: '$items.qty' } },
            averageAmount: { $avg: '$grandTotal' },
            suppliers: { $addToSet: '$supplier' },
          },
        },
        {
          $project: {
            totalPurchases: 1,
            totalAmount: 1,
            totalItems: 1,
            averageAmount: 1,
            supplierCount: { $size: '$suppliers' },
          },
        },
      ]);

      return summary[0] || {
        totalPurchases: 0,
        totalAmount: 0,
        totalItems: 0,
        averageAmount: 0,
        supplierCount: 0,
      };

    } catch (error) {
      logger.error('Purchase summary failed:', error);
      throw error;
    }
  },

  /**
   * Get supplier purchase history
   * @param {String} supplierId - Supplier ID
   * @param {Object} options - Pagination options
   * @returns {Promise<Object>} Supplier purchase history
   */
  async getSupplierHistory(supplierId, options = {}) {
    try {
      const { page = 1, limit = 20, dateFrom, dateTo } = options;

      const filter = {
        supplier: supplierId,
        isActive: true,
      };

      if (dateFrom || dateTo) {
        filter.purchaseDate = {};
        if (dateFrom) filter.purchaseDate.$gte = new Date(dateFrom);
        if (dateTo) filter.purchaseDate.$lte = new Date(dateTo);
      }

      const [purchases, total] = await Promise.all([
        Purchase.find(filter)
          .populate('items.material', 'name materialCode unit')
          .sort({ purchaseDate: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        Purchase.countDocuments(filter),
      ]);

      // Calculate supplier performance metrics
      const metrics = {
        totalPurchases: total,
        totalAmount: purchases.reduce((sum, p) => sum + p.grandTotal, 0),
        averageAmount: purchases.length > 0 
          ? purchases.reduce((sum, p) => sum + p.grandTotal, 0) / purchases.length 
          : 0,
      };

      return {
        purchases,
        metrics,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit),
        },
      };

    } catch (error) {
      logger.error('Supplier history fetch failed:', error);
      throw error;
    }
  },

  /**
   * Validate purchase items before creation
   * @param {Array} items - Purchase items
   * @returns {Promise<Boolean>} Validation result
   */
  async validatePurchaseItems(items) {
    try {
      if (!items || items.length === 0) {
        throw ApiError.badRequest('At least one item is required');
      }

      for (const item of items) {
        if (!item.material) {
          throw ApiError.badRequest('Material is required for each item');
        }

        if (!item.qty || item.qty <= 0) {
          throw ApiError.badRequest(`Quantity must be greater than 0 for material ${item.material}`);
        }

        if (!item.unitCost || item.unitCost < 0) {
          throw ApiError.badRequest(`Unit cost must be valid for material ${item.material}`);
        }

        // Check if material exists and is active
        const material = await Material.findById(item.material);
        if (!material || !material.isActive) {
          throw ApiError.notFound(`Material ${item.material} not found or inactive`);
        }
      }

      return true;

    } catch (error) {
      logger.error('Purchase item validation failed:', error);
      throw error;
    }
  },
};