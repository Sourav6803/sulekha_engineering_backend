// src/controllers/supplier.controller.js
import { Supplier, Purchase } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import logger from '../utils/logger.js';
import { redisGet, redisSet, redisDel } from '../config/redis.js';

const CACHE_TTL = 3600; // 1 hour

/**
 * List all suppliers with pagination and filters
 */
export const listSuppliers = async (req, res) => {
  const {
    page = 1,
    limit = 20,
    status,
    businessType,
    city,
    state,
    category,
    search,
    hasGST,
    minRating,
    sortBy = 'name',
    sortOrder = 'asc',
  } = req.query;

  // Build filter
  const filter = { isActive: true };
  if (status) filter.status = status;
  if (businessType) filter.businessType = businessType;
  if (city) filter.city = { $regex: city, $options: 'i' };
  if (state) filter.state = { $regex: state, $options: 'i' };
  if (category) filter.categories = category;
  if (hasGST !== undefined) {
    filter.gstNumber = hasGST ? { $ne: null, $ne: '' } : { $in: [null, ''] };
  }
  if (minRating) filter.qualityRating = { $gte: minRating };

  // Search
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { phone: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
      { supplierId: { $regex: search, $options: 'i' } },
    ];
  }

  // Build sort
  const sort = {};
  sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

  // Cache key
  const cacheKey = `suppliers:list:${JSON.stringify({ ...filter, page, limit, sort })}`;
  const cached = await redisGet(cacheKey);

  // if (cached) {
  //   return ApiResponse.send(res, cached.data, 'Suppliers fetched from cache', 200, {
  //     pagination: cached.pagination,
  //   });
  // }

  // Execute query
  const [suppliers, total] = await Promise.all([
    Supplier.find(filter)
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Supplier.countDocuments(filter),
  ]);

  const pagination = {
    page: parseInt(page),
    limit: parseInt(limit),
    total,
    pages: Math.ceil(total / limit),
  };

  // Cache result
  await redisSet(cacheKey, { data: suppliers, pagination }, CACHE_TTL);

  return ApiResponse.sendPaginated(res, suppliers, pagination, 'Suppliers fetched successfully');
};

/**
 * Get supplier by ID
 */
export const getSupplier = async (req, res) => {
  const { id } = req.params;

  const cacheKey = `supplier:${id}`;
  const cached = await redisGet(cacheKey);

  // if (cached) {
  //   return ApiResponse.send(res, cached, 'Supplier fetched from cache');
  // }

  const supplier = await Supplier.findById(id).lean();

  if (!supplier) {
    throw ApiError.notFound('Supplier');
  }

  // Cache result
  await redisSet(cacheKey, supplier, CACHE_TTL);

  return ApiResponse.send(res, supplier, 'Supplier fetched successfully');
};

/**
 * Create new supplier
 */
export const createSupplier = async (req, res) => {
  const supplierData = req.body;

  // Check if supplier with same phone exists
  const existing = await Supplier.findOne({ phone: supplierData.phone });
  if (existing) {
    throw ApiError.conflict('Supplier with this phone number already exists');
  }

  // Generate supplier ID
  const supplierId = await Supplier.generateSupplierId();

  // Create supplier
  const supplier = await Supplier.create({
    ...supplierData,
    supplierId,
    createdBy: req.userId,
    updatedBy: req.userId,
  });

  // Invalidate cache
  await redisDel('suppliers:list:*');

  logger.info(`Supplier created: ${supplier.supplierId} - ${supplier.name}`);

  return ApiResponse.sendCreated(res, supplier, 'Supplier created successfully');
};

/**
 * Update supplier
 */
export const updateSupplier = async (req, res) => {
  const { id } = req.params;
  const updateData = req.body;

  // Check if supplier exists
  const supplier = await Supplier.findById(id);
  if (!supplier) {
    throw ApiError.notFound('Supplier');
  }

  // Check phone uniqueness if updating
  if (updateData.phone && updateData.phone !== supplier.phone) {
    const existing = await Supplier.findOne({
      phone: updateData.phone,
      _id: { $ne: id },
    });
    if (existing) {
      throw ApiError.conflict('Supplier with this phone number already exists');
    }
  }

  // Update supplier — only apply keys that were explicitly provided
  const safeUpdate = Object.fromEntries(
    Object.entries(updateData).filter(([, value]) => value !== undefined),
  );
  Object.assign(supplier, safeUpdate);
  supplier.updatedBy = req.userId;
  await supplier.save();

  // Invalidate cache
  await redisDel(`supplier:${id}`);
  await redisDel('suppliers:list:*');

  logger.info(`Supplier updated: ${supplier.supplierId} - ${supplier.name}`);

  return ApiResponse.send(res, supplier, 'Supplier updated successfully');
};

/**
 * Delete supplier (soft delete)
 */
export const deleteSupplier = async (req, res) => {
  const { id } = req.params;

  // Check if supplier exists
  const supplier = await Supplier.findById(id);
  if (!supplier) {
    throw ApiError.notFound('Supplier');
  }

  // Check if supplier has purchases
  const purchaseCount = await Purchase.countDocuments({ supplier: id });
  if (purchaseCount > 0) {
    throw ApiError.conflict(
      `Cannot delete supplier with ${purchaseCount} purchase records. Use soft delete or deactivate instead.`
    );
  }

  // Soft delete
  supplier.isActive = false;
  supplier.status = 'inactive';
  supplier.updatedBy = req.userId;
  await supplier.save();

  // Invalidate cache
  await redisDel(`supplier:${id}`);
  await redisDel('suppliers:list:*');

  logger.info(`Supplier deleted: ${supplier.supplierId} - ${supplier.name}`);

  return ApiResponse.send(res, null, 'Supplier deleted successfully');
};

/**
 * Get supplier purchases
 */
export const getSupplierPurchases = async (req, res) => {
  const { id } = req.params;
  const { page = 1, limit = 20, dateFrom, dateTo, status } = req.query;

  // Check if supplier exists
  const supplier = await Supplier.findById(id);
  if (!supplier) {
    throw ApiError.notFound('Supplier');
  }

  // Build filter
  const filter = { supplier: id, isActive: true };
  if (dateFrom) filter.purchaseDate = { $gte: new Date(dateFrom) };
  if (dateTo) filter.purchaseDate = { ...filter.purchaseDate, $lte: new Date(dateTo) };
  if (status) filter.status = status;

  // Execute query
  const [purchases, total] = await Promise.all([
    Purchase.find(filter)
      .populate('items.material', 'name materialCode unit')
      .sort({ purchaseDate: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Purchase.countDocuments(filter),
  ]);

  const pagination = {
    page: parseInt(page),
    limit: parseInt(limit),
    total,
    pages: Math.ceil(total / limit),
  };

  return ApiResponse.sendPaginated(
    res,
    purchases,
    pagination,
    `Purchase history for ${supplier.name}`
  );
};

/**
 * Bulk create suppliers
 */
export const bulkCreateSuppliers = async (req, res) => {
  const { suppliers } = req.body;

  const created = [];
  const errors = [];

  for (const supplierData of suppliers) {
    try {
      // Generate supplier ID
      const supplierId = await Supplier.generateSupplierId();

      const supplier = await Supplier.create({
        ...supplierData,
        supplierId,
        createdBy: req.userId,
        updatedBy: req.userId,
      });

      created.push(supplier);
    } catch (error) {
      errors.push({
        data: supplierData,
        error: error.message,
      });
    }
  }

  // Invalidate cache
  await redisDel('suppliers:list:*');

  logger.info(`Bulk suppliers created: ${created.length} success, ${errors.length} failed`);

  return ApiResponse.send(res, {
    created,
    errors,
    summary: {
      total: suppliers.length,
      success: created.length,
      failed: errors.length,
    },
  }, 'Bulk supplier creation completed');
};

/**
 * Get supplier analysis
 */
export const getSupplierAnalysis = async (req, res) => {
  const { id } = req.params;
  const { dateFrom, dateTo } = req.query;

  // Check if supplier exists
  const supplier = await Supplier.findById(id);
  if (!supplier) {
    throw ApiError.notFound('Supplier');
  }

  // Build date filter
  const dateFilter = {};
  if (dateFrom) dateFilter.$gte = new Date(dateFrom);
  if (dateTo) dateFilter.$lte = new Date(dateTo);

  const purchaseFilter = { supplier: id, isActive: true };
  if (dateFrom || dateTo) purchaseFilter.purchaseDate = dateFilter;

  // Get purchases
  const purchases = await Purchase.find(purchaseFilter)
    .populate('items.material', 'name')
    .lean();

  // Calculate analysis
  const totalPurchases = purchases.length;
  const totalAmount = purchases.reduce((sum, p) => sum + p.grandTotal, 0);
  const totalItems = purchases.reduce((sum, p) => sum + p.items.length, 0);

  // Average delivery days
  let avgDeliveryDays = supplier.averageDeliveryDays || 0;
  if (purchases.length > 0) {
    const delivered = purchases.filter(p => p.status === 'completed' && p.courierDetails?.deliveredDate);
    if (delivered.length > 0) {
      const totalDays = delivered.reduce((sum, p) => {
        const days = (p.courierDetails.deliveredDate - p.purchaseDate) / (1000 * 60 * 60 * 24);
        return sum + days;
      }, 0);
      avgDeliveryDays = totalDays / delivered.length;
    }
  }

  const analysis = {
    supplier: {
      id: supplier._id,
      name: supplier.name,
      supplierId: supplier.supplierId,
    },
    summary: {
      totalPurchases,
      totalAmount,
      totalItems,
      averagePurchaseValue: totalPurchases > 0 ? totalAmount / totalPurchases : 0,
      averageDeliveryDays: Math.round(avgDeliveryDays),
    },
    period: {
      from: dateFrom || 'All time',
      to: dateTo || 'All time',
    },
  };

  return ApiResponse.send(res, analysis, 'Supplier analysis completed');
};

/**
 * Get suppliers performance
 */
export const getSuppliersPerformance = async (req, res) => {
  const { dateFrom, dateTo, category, minPurchases = 0 } = req.query;

  // Build date filter
  const dateFilter = {};
  if (dateFrom) dateFilter.$gte = new Date(dateFrom);
  if (dateTo) dateFilter.$lte = new Date(dateTo);

  const purchaseFilter = { isActive: true };
  if (dateFrom || dateTo) purchaseFilter.purchaseDate = dateFilter;

  // Get all suppliers with purchases
  const suppliers = await Supplier.find({ isActive: true, status: 'active' })
    .select('_id name supplierId qualityRating averageDeliveryDays categories')
    .lean();

  // Get purchase data for each supplier
  const performance = await Promise.all(
    suppliers.map(async (supplier) => {
      const purchases = await Purchase.find({
        ...purchaseFilter,
        supplier: supplier._id,
        status: 'completed',
      }).lean();

      const totalPurchases = purchases.length;
      const totalAmount = purchases.reduce((sum, p) => sum + p.grandTotal, 0);
      const totalItems = purchases.reduce((sum, p) => sum + p.items.length, 0);

      return {
        ...supplier,
        performance: {
          totalPurchases,
          totalAmount,
          totalItems,
          averagePurchaseValue: totalPurchases > 0 ? totalAmount / totalPurchases : 0,
        },
      };
    })
  );

  // Filter by min purchases
  let filtered = performance.filter(p => p.performance.totalPurchases >= minPurchases);

  // Filter by category if specified
  if (category) {
    filtered = filtered.filter(p => p.categories && p.categories.includes(category));
  }

  // Sort by total purchases
  filtered.sort((a, b) => b.performance.totalPurchases - a.performance.totalPurchases);

  return ApiResponse.send(res, filtered, 'Suppliers performance fetched successfully');
};