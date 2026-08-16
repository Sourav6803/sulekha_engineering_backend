// src/controllers/installation.controller.js
import { Installation, Customer, Material } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { installationService } from '../services/installation.service.js';
import { bomTemplateService } from '../services/bomTemplate.service.js';
import { pdfService } from '../services/pdf.service.js';
import { excelService } from '../services/excel.service.js';
import logger from '../utils/logger.js';
import { redisGet, redisSet, redisDel } from '../config/redis.js';

const CACHE_TTL = 3600; // 1 hour

/**
 * List all installations with pagination and filters
 */
export const listInstallations = async (req, res) => {
  const {
    page = 1,
    limit = 20,
    customer,
    status,
    roofType,
    dateFrom,
    dateTo,
    search,
    sortBy = 'installDate',
    sortOrder = 'desc',
  } = req.query;

  // Build filter
  const filter = { isActive: true };
  if (customer) filter.customer = customer;
  if (status) filter.status = status;
  if (roofType) filter.roofType = roofType;

  // Date range
  if (dateFrom || dateTo) {
    filter.installDate = {};
    if (dateFrom) filter.installDate.$gte = new Date(dateFrom);
    if (dateTo) filter.installDate.$lte = new Date(dateTo);
  }

  // Search
  if (search) {
    filter.$or = [
      { installationId: { $regex: search, $options: 'i' } },
      { projectNo: { $regex: search, $options: 'i' } },
      { quotationNo: { $regex: search, $options: 'i' } },
    ];
  }

  // Build sort
  const sort = {};
  sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

  // Execute query
  const [installations, total] = await Promise.all([
    Installation.find(filter)
      .populate('customer', 'name phone customerId address')
      .populate('teamAssigned.member', 'name email')
      .populate('createdBy', 'name email')
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Installation.countDocuments(filter),
  ]);

  const pagination = {
    page: parseInt(page),
    limit: parseInt(limit),
    total,
    pages: Math.ceil(total / limit),
  };

  return ApiResponse.sendPaginated(res, installations, pagination, 'Installations fetched successfully');
};

/**
 * Get installation by ID
 */
export const getInstallation = async (req, res) => {
  const { id } = req.params;

  const installation = await Installation.findById(id)
    .populate('customer', 'name phone customerId address city state pincode')
    .populate('materialsUsed.material', 'name materialCode unit description category')
    .populate('teamAssigned.member', 'name email phone')
    .populate('createdBy', 'name email')
    .populate('updatedBy', 'name email')
    .lean();

  if (!installation) {
    throw ApiError.notFound('Installation');
  }

  return ApiResponse.send(res, installation, 'Installation fetched successfully');
};

/**
 * Create new installation
 */
export const createInstallation = async (req, res) => {
  const { customer, systemSizeKW, roofType, ...rest } = req.body;

  // Check if customer exists
  const customerData = await Customer.findById(customer);
  if (!customerData) {
    throw ApiError.notFound('Customer');
  }

  // A customer can only have one active installation
  const existingInstallation = await Installation.findOne({ customer, isActive: true });
  if (existingInstallation) {
    throw ApiError.conflict(
      `This customer already has an installation (${existingInstallation.installationId}). ` +
      'Each customer can have only one installation.'
    );
  }

  // Generate installation ID
  const installationId = await Installation.generateInstallationId();

  // Get suggested BOM
  const suggestedMaterials = await bomTemplateService.getSuggestedBOM(roofType, systemSizeKW);

  // Analyze load
  const loadAnalysis = await installationService.analyzeLoad(systemSizeKW);

  // Create installation
  const installation = await Installation.create({
    ...rest,
    customer,
    systemSizeKW,
    roofType,
    installationId,
    customerNameSnapshot: customerData.name,
    customerPhoneSnapshot: customerData.phone,
    suggestedMaterials,
    totalLoad: loadAnalysis.recommendedInverterKW,
    inverterCapacity: loadAnalysis.recommendedInverterKW,
    canRunSubmersible: loadAnalysis.submersibleCanRun,
    loadAnalysisDetails: loadAnalysis,
    createdBy: req.userId,
    updatedBy: req.userId,
  });

  logger.info(`Installation created: ${installation.installationId} for ${customerData.name}`);

  return ApiResponse.sendCreated(res, {
    installation,
    suggestedMaterials,
    loadAnalysis,
  }, 'Installation created successfully');
};

/**
 * Update installation
 */
export const updateInstallation = async (req, res) => {
  const { id } = req.params;
  const updateData = req.body;

  // Check if installation exists
  const installation = await Installation.findById(id);
  if (!installation) {
    throw ApiError.notFound('Installation');
  }

  // Check if installation can be updated
  if (installation.status === 'completed') {
    throw ApiError.badRequest('Cannot update a completed installation');
  }

  if (installation.status === 'cancelled') {
    throw ApiError.badRequest('Cannot update a cancelled installation');
  }

  // Update installation
  Object.assign(installation, updateData);
  installation.updatedBy = req.userId;
  await installation.save();

  // Invalidate cache
  await redisDel(`installation:${id}`);
  await redisDel('installations:list:*');

  logger.info(`Installation updated: ${installation.installationId}`);

  return ApiResponse.send(res, installation, 'Installation updated successfully');
};

/**
 * Delete installation (soft delete)
 */
export const deleteInstallation = async (req, res) => {
  const { id } = req.params;

  // Check if installation exists
  const installation = await Installation.findById(id);
  if (!installation) {
    throw ApiError.notFound('Installation');
  }

  // Check if installation has materials assigned
  const hasMaterials = installation.materialsUsed.some(m => m.status === 'installed');
  if (hasMaterials) {
    throw ApiError.conflict('Cannot delete installation with assigned materials. Reverse materials first.');
  }

  // Soft delete
  installation.isActive = false;
  installation.status = 'cancelled';
  installation.updatedBy = req.userId;
  await installation.save();

  // Invalidate cache
  await redisDel(`installation:${id}`);
  await redisDel('installations:list:*');

  logger.info(`Installation deleted: ${installation.installationId}`);

  return ApiResponse.send(res, null, 'Installation deleted successfully');
};

/**
 * Assign materials to installation
 */
export const assignMaterials = async (req, res) => {
  const { id } = req.params;
  const { items, idempotencyKey } = req.body;

  // Check if installation exists
  const installation = await Installation.findById(id);
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

  // Assign materials
  const updatedInstallation = await installationService.assignMaterials(
    id,
    items,
    idempotencyKey,
    req.userId
  );

  // Invalidate cache
  await redisDel(`installation:${id}`);
  await redisDel('installations:list:*');

  logger.info(`Materials assigned to installation: ${installation.installationId}`);

  return ApiResponse.send(res, updatedInstallation, 'Materials assigned successfully');
};

/**
 * Reverse material assignment
 */
export const reverseMaterial = async (req, res) => {
  const { id, usageId } = req.params;
  const { reason } = req.body;

  // Check if installation exists
  const installation = await Installation.findById(id);
  if (!installation) {
    throw ApiError.notFound('Installation');
  }

  // Reverse material
  const updatedInstallation = await installationService.reverseAssignment(
    id,
    usageId,
    reason,
    req.userId
  );

  // Invalidate cache
  await redisDel(`installation:${id}`);
  await redisDel('installations:list:*');

  logger.info(`Material reversed for installation: ${installation.installationId}`);

  return ApiResponse.send(res, updatedInstallation, 'Material reversed successfully');
};

/**
 * Generate BOM PDF
 */
export const generateBOMPDF = async (req, res) => {
  const { id } = req.params;
  const { variant = 'final' } = req.query;
  const safeVariant = variant === 'suggested' ? 'suggested' : 'final';

  // Check if installation exists
  const installation = await Installation.findById(id)
    .populate('customer', 'name phone gstNumber address city state pincode')
    .populate('materialsUsed.material', 'name materialCode unit description category')
    .lean();

  if (!installation) {
    throw ApiError.notFound('Installation');
  }

  // Suggested BOM requires the stored suggested list; final requires usage.
  if (safeVariant === 'final' && (!installation.materialsUsed || installation.materialsUsed.length === 0)) {
    throw ApiError.badRequest('No materials confirmed to generate a final BOM');
  }
  if (safeVariant === 'suggested' && !installation.suggestedMaterials) {
    throw ApiError.badRequest('No suggested BOM available for this installation');
  }

  // Generate PDF
  const pdfBuffer = await pdfService.generateBOMPDF(installation, safeVariant);

  // Set response headers
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="BOM-${installation.installationId}-${safeVariant}.pdf"`
  );
  res.setHeader('Content-Length', pdfBuffer.length);

  return res.send(pdfBuffer);
};

/**
 * Generate BOM Excel
 */
export const generateBOMExcel = async (req, res) => {
  const { id } = req.params;
  const { variant = 'suggested' } = req.query;
  const safeVariant = variant === 'final' ? 'final' : 'suggested';

  const installation = await Installation.findById(id)
    .populate('customer', 'name phone gstNumber address city state pincode')
    .lean();

  if (!installation) {
    throw ApiError.notFound('Installation');
  }

  const excelBuffer = await excelService.generateBOMExcel(installation, safeVariant);

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="BOM-${installation.installationId}-${safeVariant}.xlsx"`
  );
  res.setHeader('Content-Length', excelBuffer.length);

  return res.send(excelBuffer);
};

/**
 * Update installation status
 */
export const updateInstallationStatus = async (req, res) => {
  const { id } = req.params;
  const { status, notes } = req.body;

  // Check if installation exists
  const installation = await Installation.findById(id);
  if (!installation) {
    throw ApiError.notFound('Installation');
  }

  // Update status
  installation.status = status;
  if (notes) installation.notes = notes;
  installation.updatedBy = req.userId;

  if (status === 'completed') {
    installation.completionDate = new Date();
    // Calculate total cost
    await installation.calculateTotalCost();
  }

  await installation.save();

  // Invalidate cache
  await redisDel(`installation:${id}`);
  await redisDel('installations:list:*');

  logger.info(`Installation status updated: ${installation.installationId} -> ${status}`);

  return ApiResponse.send(res, installation, 'Installation status updated successfully');
};

/**
 * Get load analysis
 */
export const getLoadAnalysis = async (req, res) => {
  const { id } = req.params;

  const installation = await Installation.findById(id);
  if (!installation) {
    throw ApiError.notFound('Installation');
  }

  // If load analysis not performed, calculate it
  let loadAnalysis = installation.loadAnalysisDetails;
  if (!loadAnalysis) {
    loadAnalysis = await installationService.analyzeLoad(installation.systemSizeKW);
    // Update installation with analysis
    installation.loadAnalysisDetails = loadAnalysis;
    installation.totalLoad = loadAnalysis.recommendedInverterKW;
    installation.inverterCapacity = loadAnalysis.recommendedInverterKW;
    installation.canRunSubmersible = loadAnalysis.submersibleCanRun;
    await installation.save();
  }

  return ApiResponse.send(res, {
    installationId: installation.installationId,
    systemSizeKW: installation.systemSizeKW,
    loadAnalysis,
  }, 'Load analysis fetched successfully');
};

/**
 * Get suggested BOM
 */
export const getSuggestedBOM = async (req, res) => {
  const { roofType, systemSizeKW } = req.query;

  const suggestedMaterials = await bomTemplateService.getSuggestedBOM(
    roofType,
    parseFloat(systemSizeKW)
  );

  return ApiResponse.send(res, {
    roofType,
    systemSizeKW: parseFloat(systemSizeKW),
    materials: suggestedMaterials,
  }, 'Suggested BOM generated successfully');
};