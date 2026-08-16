// src/controllers/material.controller.js
import { Material, StockLedger, Installation } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import logger from '../utils/logger.js';
import { redisGet, redisSet, redisDel } from '../config/redis.js';
import { uploadToCloudinary } from '../services/storage.service.js';
import mongoose from 'mongoose';

const CACHE_TTL = 3600; // 1 hour

/**
 * List all materials with pagination and filters
 */
export const listMaterials = async (req, res) => {
  const {
    page = 1,
    limit = 20,
    status = 'active',
    search,
    lowStock,
    sortBy = 'name',
    sortOrder = 'asc',
  } = req.query;

  // Build filter
  const filter = { isActive: true };
  if (status) filter.status = status;

  // Low stock filter
  if (lowStock === 'true') {
    filter.$expr = {
      $lte: ['$currentStock', '$minimumStockLevel'],
    };
  }

  // Search
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { materialCode: { $regex: search, $options: 'i' } },
    ];
  }

  // Build sort
  const sort = {};
  sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

  // Cache key
  const cacheKey = `materials:list:${JSON.stringify({ ...filter, page, limit, sort })}`;
  const cached = await redisGet(cacheKey);

  // if (cached) {
  //   return ApiResponse.send(res, cached.data, 'Materials fetched from cache', 200, {
  //     pagination: cached.pagination,
  //   });
  // }

  // Execute query
  const [materials, total] = await Promise.all([
    Material.find(filter)
      .populate('preferredSupplier', 'name phone')
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Material.countDocuments(filter),
  ]);

  console.log('Materials fetched from DB:', materials, )

  const pagination = {
    page: parseInt(page),
    limit: parseInt(limit),
    total,
    pages: Math.ceil(total / limit),
  };

  // Cache result
  await redisSet(cacheKey, { data: materials, pagination }, CACHE_TTL);

  return ApiResponse.sendPaginated(res, materials, pagination, 'Materials fetched successfully');
};

/**
 * Get low stock materials
 */
export const getLowStockMaterials = async (req, res) => {
  const materials = await Material.find({
    isActive: true,
    status: 'active',
    $expr: {
      $lte: ['$currentStock', '$minimumStockLevel'],
    },
  })
    .populate('preferredSupplier', 'name phone')
    .sort({ currentStock: 1 })
    .lean();

  return ApiResponse.send(res, materials, 'Low stock materials fetched successfully');
};

/**
 * Get stock summary
 */
export const getStockSummary = async (req, res) => {
  const summary = await Material.getStockSummary();

  const totalMaterials = await Material.countDocuments({ isActive: true });

  return ApiResponse.send(res, {
    totalStockValue: summary.totalValue,
    totalStock: summary.totalStock,
    lowStockCount: summary.lowStockCount,
    totalMaterials,
  }, 'Stock summary fetched successfully');
};

/**
 * Search materials
 */
export const searchMaterials = async (req, res) => {
  const { q, limit = 20 } = req.query;

  const filter = {
    isActive: true,
    status: 'active',
    $or: [
      { name: { $regex: q, $options: 'i' } },
      { materialCode: { $regex: q, $options: 'i' } },
    ],
  };

  const materials = await Material.find(filter)
    .limit(parseInt(limit))
    .lean();

  return ApiResponse.send(res, materials, 'Search results fetched successfully');
};

/**
 * Get material by ID
 */
export const getMaterial = async (req, res) => {
  const { id } = req.params;

  const cacheKey = `material:${id}`;
  const cached = await redisGet(cacheKey);

  // if (cached) {
  //   return ApiResponse.send(res, cached, 'Material fetched from cache');
  // }

  const material = await Material.findById(id)
    .populate('preferredSupplier', 'name phone')
    .populate('alternateSuppliers', 'name phone')
    .lean();

  if (!material) {
    throw ApiError.notFound('Material');
  }

  // Cache result
  await redisSet(cacheKey, material, CACHE_TTL);

  return ApiResponse.send(res, material, 'Material fetched successfully');
};

/**
 * Create new material
 */
export const createMaterial = async (req, res) => {
  const materialData = req.body;

  // Generate material code
  const materialCode = await Material.generateMaterialCode();

  // Check if material with same name exists
  const existing = await Material.findOne({
    name: { $regex: `^${materialData.name}$`, $options: 'i' },
  });
  if (existing) {
    throw ApiError.conflict('Material with this name already exists');
  }

  // Create material
  const material = await Material.create({
    ...materialData,
    materialCode,
    createdBy: req.userId,
    updatedBy: req.userId,
  });

  // Invalidate cache
  await redisDel('materials:list:*');

  logger.info(`Material created: ${material.materialCode} - ${material.name}`);

  return ApiResponse.sendCreated(res, material, 'Material created successfully');
};

/**
 * Update material
 */
export const updateMaterial = async (req, res) => {
  const { id } = req.params;
  const updateData = req.body;

  // Check if material exists
  const material = await Material.findById(id);
  if (!material) {
    throw ApiError.notFound('Material');
  }

  // Check name uniqueness if updating
  if (updateData.name && updateData.name !== material.name) {
    const existing = await Material.findOne({
      name: { $regex: `^${updateData.name}$`, $options: 'i' },
      _id: { $ne: id },
    });
    if (existing) {
      throw ApiError.conflict('Material with this name already exists');
    }
  }

  // Update material
  Object.assign(material, updateData);
  material.updatedBy = req.userId;
  await material.save();

  // Invalidate cache
  await redisDel(`material:${id}`);
  await redisDel('materials:list:*');

  logger.info(`Material updated: ${material.materialCode} - ${material.name}`);

  return ApiResponse.send(res, material, 'Material updated successfully');
};

/**
 * Delete material (soft delete)
 */
export const deleteMaterial = async (req, res) => {
  const { id } = req.params;

  // Check if material exists
  const material = await Material.findById(id);
  if (!material) {
    throw ApiError.notFound('Material');
  }

  // Check if material is used in any installation
  const usageCount = await StockLedger.countDocuments({
    material: id,
    direction: 'out',
  });

  if (usageCount > 0) {
    throw ApiError.conflict(
      `Cannot delete material used in ${usageCount} installations. Use soft delete or deactivate instead.`
    );
  }

  // Soft delete
  material.isActive = false;
  material.status = 'inactive';
  material.updatedBy = req.userId;
  await material.save();

  // Invalidate cache
  await redisDel(`material:${id}`);
  await redisDel('materials:list:*');

  logger.info(`Material deleted: ${material.materialCode} - ${material.name}`);

  return ApiResponse.send(res, null, 'Material deleted successfully');
};

/**
 * Upload material image
 */
export const uploadMaterialImage = async (req, res) => {
  const { id } = req.params;

  // Check if material exists
  const material = await Material.findById(id);
  if (!material) {
    throw ApiError.notFound('Material');
  }

  if (!req.file) {
    throw ApiError.badRequest('No image file provided');
  }

  // Upload to Cloudinary/S3
  const imageUrl = await uploadToCloudinary(req.file, {
    folder: 'materials',
    public_id: material.materialCode,
  });

  // Update material
  material.images = material.images || [];
  material.images.push({
    url: imageUrl,
    isPrimary: material.images.length === 0,
    uploadedAt: new Date(),
  });
  material.updatedBy = req.userId;
  await material.save();

  // Invalidate cache (detail + list, since the list renders images too)
  await redisDel(`material:${id}`);
  await redisDel('materials:list:*');

  return ApiResponse.send(res, {
    imageUrl,
    images: material.images,
  }, 'Image uploaded successfully');
};

/**
 * Get material stock history
 */
export const getMaterialHistory = async (req, res) => {
  const { id } = req.params;
  const { page = 1, limit = 20 } = req.query;

  console.log('Fetching stock history for material ID:', id)

  // Check if material exists
  const material = await Material.findById(id);
  // console.log('Material found:', material)
  if (!material) {
    throw ApiError.notFound('Material');
  }

  // Get ledger entries
  const materialObjectId = mongoose.Types.ObjectId.createFromHexString(id) || mongoose.Types.ObjectId(id);
  const [entries, total] = await Promise.all([
    StockLedger.find({ material: materialObjectId })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    StockLedger.countDocuments({ material: materialObjectId }),
  ]);

  console.log(`Fetched ${entries.length} ledger entries for material ID ${id}`);

  // Enrich entries with customer/installation info when available
  const enrichedEntries = await Promise.all(
    entries.map(async (entry) => {
      if (entry.refType === 'installation' && entry.refId) {
        try {
          const installation = await Installation.findById(entry.refId)
            .select('customer customerNameSnapshot installationId')
            .lean();
          if (installation) {
            return {
              ...entry,
              customerName: installation.customerNameSnapshot || 'Unknown Customer',
              installationId: installation.installationId,
            };
          }
        } catch (err) {
          logger.warn(`Failed to enrich ledger entry ${entry._id} with installation info: ${err.message}`);
        }
      }
      return entry;
    })
  );

  const pagination = {
    page: parseInt(page),
    limit: parseInt(limit),
    total,
    pages: Math.ceil(total / limit),
  };

  return ApiResponse.sendPaginated(
    res,
    enrichedEntries,
    pagination,
    `Stock history for ${material.name}`
  );
};

/**
 * Adjust stock (admin only)
 */
export const adjustStock = async (req, res) => {
  const { id } = req.params;
  const { adjustment, reason } = req.body;

  // Check if material exists
  const material = await Material.findById(id);
  if (!material) {
    throw ApiError.notFound('Material');
  }

  // Calculate new stock
  const newStock = material.currentStock + adjustment;
  if (newStock < 0) {
    throw ApiError.badRequest('Stock adjustment would result in negative stock');
  }

  // Update stock
  material.currentStock = newStock;
  material.updatedBy = req.userId;
  await material.save();

  // Create ledger entry
  await StockLedger.create({
    material: material._id,
    materialNameSnapshot: material.name,
    unitSnapshot: material.unit,
    direction: adjustment >= 0 ? 'in' : 'out',
    qty: Math.abs(adjustment),
    balanceAfter: newStock,
    refType: 'adjustment',
    refId: material._id,
    note: `Manual adjustment: ${reason}`,
  });

  // Invalidate cache
  await redisDel(`material:${id}`);
  await redisDel('materials:list:*');

  logger.info(`Stock adjusted for ${material.materialCode}: ${adjustment} (${reason})`);

  return ApiResponse.send(res, {
    material: {
      id: material._id,
      name: material.name,
      currentStock: material.currentStock,
    },
    adjustment,
    reason,
  }, 'Stock adjusted successfully');
};