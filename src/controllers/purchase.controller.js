// src/controllers/purchase.controller.js
import { Purchase, Supplier, Material } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { purchaseService } from '../services/purchase.service.js';
import { redisGet, redisSet, redisDel } from '../config/redis.js';
import logger from '../utils/logger.js';

/**
 * List all purchases with pagination and filters
 */
export const listPurchases = async (req, res) => {
  const {
    page = 1,
    limit = 20,
    supplier,
    status,
    dateFrom,
    dateTo,
    paymentStatus,
    search,
    sortBy = 'purchaseDate',
    sortOrder = 'desc',
  } = req.query;

  // Build filter
  const filter = { isActive: true };
  if (supplier) filter.supplier = supplier;
  if (status) filter.status = status;
  if (paymentStatus) filter.paymentStatus = paymentStatus;

  // Date range
  if (dateFrom || dateTo) {
    filter.purchaseDate = {};
    if (dateFrom) filter.purchaseDate.$gte = new Date(dateFrom);
    if (dateTo) filter.purchaseDate.$lte = new Date(dateTo);
  }

  // Search
  if (search) {
    filter.$or = [
      { purchaseId: { $regex: search, $options: 'i' } },
      { invoiceNumber: { $regex: search, $options: 'i' } },
      { purchaseOrderNumber: { $regex: search, $options: 'i' } },
    ];
  }

  // Build sort
  const sort = {};
  sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

  // Execute query
  const [purchases, total] = await Promise.all([
    Purchase.find(filter)
      .populate('supplier', 'name phone supplierId')
      .populate('items.material', 'name materialCode unit')
      .sort(sort)
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

  return ApiResponse.sendPaginated(res, purchases, pagination, 'Purchases fetched successfully');
};

/**
 * Get purchase by ID
 */
export const getPurchase = async (req, res) => {
  const { id } = req.params;

  const purchase = await Purchase.findById(id)
    .populate('supplier', 'name phone supplierId address')
    .populate('items.material', 'name materialCode unit category')
    .lean();

  if (!purchase) {
    throw ApiError.notFound('Purchase');
  }

  return ApiResponse.send(res, purchase, 'Purchase fetched successfully');
};

/**
 * Create new purchase
 */
export const createPurchase = async (req, res) => {
  const purchaseData = req.body;

  // Check if supplier exists
  const supplier = await Supplier.findById(purchaseData.supplier);
  if (!supplier) {
    throw ApiError.notFound('Supplier');
  }

  // Check idempotency
  if (purchaseData.idempotencyKey) {
    const existing = await Purchase.findOne({
      idempotencyKey: purchaseData.idempotencyKey,
    });
    if (existing) {
      return ApiResponse.send(res, existing, 'Purchase already processed (idempotent)');
    }
  }

  // Generate purchase ID
  const purchaseId = await Purchase.generatePurchaseId();

  // Process purchase with transaction
  const purchase = await purchaseService.createPurchase({
    ...purchaseData,
    purchaseId,
    supplierNameSnapshot: supplier.name,
    createdBy: req.userId,
    updatedBy: req.userId,
  });

  // Invalidate cache
  await redisDel('purchases:list:*');

  logger.info(`Purchase created: ${purchase.purchaseId} from ${supplier.name}`);

  return ApiResponse.sendCreated(res, purchase, 'Purchase created successfully');
};

/**
 * Update purchase
 */
export const updatePurchase = async (req, res) => {
  const { id } = req.params;
  const updateData = req.body;

  // Check if purchase exists
  const purchase = await Purchase.findById(id);
  if (!purchase) {
    throw ApiError.notFound('Purchase');
  }

  // Check if purchase can be updated
  if (purchase.status === 'completed') {
    throw ApiError.badRequest('Cannot update a completed purchase');
  }

  if (purchase.status === 'cancelled') {
    throw ApiError.badRequest('Cannot update a cancelled purchase');
  }

  // Update purchase
  Object.assign(purchase, updateData);
  purchase.updatedBy = req.userId;
  await purchase.save();

  // Invalidate cache
  await redisDel(`purchase:${id}`);
  await redisDel('purchases:list:*');

  logger.info(`Purchase updated: ${purchase.purchaseId}`);

  return ApiResponse.send(res, purchase, 'Purchase updated successfully');
};

/**
 * Delete purchase (soft delete)
 */
export const deletePurchase = async (req, res) => {
  const { id } = req.params;

  // Check if purchase exists
  const purchase = await Purchase.findById(id);
  if (!purchase) {
    throw ApiError.notFound('Purchase');
  }

  // Check if purchase can be deleted
  if (purchase.status === 'completed') {
    throw ApiError.badRequest('Cannot delete a completed purchase');
  }

  if (purchase.status === 'processing') {
    throw ApiError.badRequest('Cannot delete a processing purchase');
  }

  // Soft delete
  purchase.isActive = false;
  purchase.status = 'cancelled';
  purchase.updatedBy = req.userId;
  await purchase.save();

  // Invalidate cache
  await redisDel(`purchase:${id}`);
  await redisDel('purchases:list:*');

  logger.info(`Purchase deleted: ${purchase.purchaseId}`);

  return ApiResponse.send(res, null, 'Purchase deleted successfully');
};

/**
 * Upload purchase invoice
 */
export const uploadInvoice = async (req, res) => {
  const { id } = req.params;

  // Check if purchase exists
  const purchase = await Purchase.findById(id);
  if (!purchase) {
    throw ApiError.notFound('Purchase');
  }

  if (!req.file) {
    throw ApiError.badRequest('No invoice file provided');
  }

  // Upload to Cloudinary/S3
  const invoiceUrl = await uploadToCloudinary(req.file, {
    folder: 'invoices',
    public_id: `invoice-${purchase.purchaseId}`,
  });

  // Update purchase
  purchase.invoiceFileUrl = invoiceUrl;
  purchase.updatedBy = req.userId;
  await purchase.save();

  // Invalidate cache
  await redisDel(`purchase:${id}`);

  return ApiResponse.send(res, {
    invoiceUrl,
    purchaseId: purchase.purchaseId,
  }, 'Invoice uploaded successfully');
};

/**
 * Get invoice
 */
export const getInvoice = async (req, res) => {
  const { id } = req.params;

  const purchase = await Purchase.findById(id);
  if (!purchase) {
    throw ApiError.notFound('Purchase');
  }

  if (!purchase.invoiceFileUrl) {
    throw ApiError.notFound('Invoice not found for this purchase');
  }

  // Redirect to invoice URL
  return res.redirect(purchase.invoiceFileUrl);
};

/**
 * Complete purchase
 */
export const completePurchase = async (req, res) => {
  const { id } = req.params;

  // Check if purchase exists
  const purchase = await Purchase.findById(id);
  if (!purchase) {
    throw ApiError.notFound('Purchase');
  }

  if (purchase.status === 'completed') {
    return ApiResponse.send(res, purchase, 'Purchase already completed');
  }

  // Complete purchase
  purchase.status = 'completed';
  purchase.updatedBy = req.userId;
  await purchase.save();

  // Invalidate cache
  await redisDel(`purchase:${id}`);
  await redisDel('purchases:list:*');

  logger.info(`Purchase completed: ${purchase.purchaseId}`);

  return ApiResponse.send(res, purchase, 'Purchase completed successfully');
};