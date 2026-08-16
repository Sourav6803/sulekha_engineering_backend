// src/controllers/bomTemplate.controller.js
import { BOMTemplate, Material } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { bomTemplateService } from '../services/bomTemplate.service.js';
import logger from '../utils/logger.js';
import { redisGet, redisSet, redisDel } from '../config/redis.js';

const CACHE_TTL = 3600; // 1 hour

/**
 * List all BOM templates with pagination and filters
 */
export const listBOMTemplates = async (req, res) => {
  const {
    page = 1,
    limit = 20,
    roofType,
    section,
    search,
    sortBy = 'templateName',
    sortOrder = 'asc',
  } = req.query;

  // Build filter
  const filter = { isActive: true };
  if (roofType) filter.roofType = roofType;
  if (section) filter.section = { $regex: section, $options: 'i' };

  // Search
  if (search) {
    filter.$or = [
      { templateName: { $regex: search, $options: 'i' } },
      { section: { $regex: search, $options: 'i' } },
    ];
  }

  // Build sort
  const sort = {};
  sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

  // Execute query
  const [templates, total] = await Promise.all([
    BOMTemplate.find(filter)
      .populate('material', 'name materialCode unit')
      .populate('createdBy', 'name email')
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    BOMTemplate.countDocuments(filter),
  ]);

  const pagination = {
    page: parseInt(page),
    limit: parseInt(limit),
    total,
    pages: Math.ceil(total / limit),
  };

  return ApiResponse.sendPaginated(res, templates, pagination, 'BOM templates fetched successfully');
};

/**
 * Get BOM template by ID
 */
export const getBOMTemplate = async (req, res) => {
  const { id } = req.params;

  const template = await BOMTemplate.findById(id)
    .populate('material', 'name materialCode unit')
    .lean();

  if (!template) {
    throw ApiError.notFound('BOM Template');
  }

  return ApiResponse.send(res, template, 'BOM template fetched successfully');
};

/**
 * Get BOM by roof type and system size
 */
export const getBOMByRoofType = async (req, res) => {
  const { roofType, systemSizeKW } = req.query;

  const bom = await bomTemplateService.getSuggestedBOM(
    roofType,
    parseFloat(systemSizeKW)
  );

  return ApiResponse.send(res, {
    roofType,
    systemSizeKW: parseFloat(systemSizeKW),
    bom,
  }, 'BOM fetched successfully');
};

/**
 * Create new BOM template
 */
export const createBOMTemplate = async (req, res) => {
  const templateData = req.body;

  // Check if material exists
  const material = await Material.findById(templateData.material);
  if (!material) {
    throw ApiError.notFound('Material');
  }

  // Check if template already exists for this combination
  const existing = await BOMTemplate.findOne({
    roofType: templateData.roofType,
    systemSizeKW: templateData.systemSizeKW,
    section: templateData.section,
    material: templateData.material,
  });

  if (existing) {
    throw ApiError.conflict('Template already exists for this combination');
  }

  // Create template
  const template = await BOMTemplate.create({
    ...templateData,
    createdBy: req.userId,
    updatedBy: req.userId,
  });

  // Invalidate cache
  await redisDel('bom-templates:list:*');

  logger.info(`BOM template created for ${template.roofType} - ${template.systemSizeKW}kW`);

  return ApiResponse.sendCreated(res, template, 'BOM template created successfully');
};

/**
 * Update BOM template
 */
export const updateBOMTemplate = async (req, res) => {
  const { id } = req.params;
  const updateData = req.body;

  // Check if template exists
  const template = await BOMTemplate.findById(id);
  if (!template) {
    throw ApiError.notFound('BOM Template');
  }

  // Check material if updating
  if (updateData.material) {
    const material = await Material.findById(updateData.material);
    if (!material) {
      throw ApiError.notFound('Material');
    }
  }

  // Update template
  Object.assign(template, updateData);
  template.updatedBy = req.userId;
  await template.save();

  // Invalidate cache
  await redisDel(`bom-template:${id}`);
  await redisDel('bom-templates:list:*');
  await redisDel(`bom:${template.roofType}:${template.systemSizeKW}`);

  logger.info(`BOM template updated: ${template.templateName}`);

  return ApiResponse.send(res, template, 'BOM template updated successfully');
};

/**
 * Delete BOM template
 */
export const deleteBOMTemplate = async (req, res) => {
  const { id } = req.params;

  // Check if template exists
  const template = await BOMTemplate.findById(id);
  if (!template) {
    throw ApiError.notFound('BOM Template');
  }

  // Soft delete
  template.isActive = false;
  template.updatedBy = req.userId;
  await template.save();

  // Invalidate cache
  await redisDel(`bom-template:${id}`);
  await redisDel('bom-templates:list:*');
  await redisDel(`bom:${template.roofType}:${template.systemSizeKW}`);

  logger.info(`BOM template deleted: ${template.templateName}`);

  return ApiResponse.send(res, null, 'BOM template deleted successfully');
};

/**
 * Bulk create BOM templates
 */
export const bulkCreateBOMTemplates = async (req, res) => {
  const { templates } = req.body;

  const created = [];
  const errors = [];

  for (const templateData of templates) {
    try {
      // Check if material exists
      const material = await Material.findById(templateData.material);
      if (!material) {
        errors.push({
          data: templateData,
          error: 'Material not found',
        });
        continue;
      }

      // Create template
      const template = await BOMTemplate.create({
        ...templateData,
        createdBy: req.userId,
        updatedBy: req.userId,
      });

      created.push(template);
    } catch (error) {
      errors.push({
        data: templateData,
        error: error.message,
      });
    }
  }

  // Invalidate cache
  await redisDel('bom-templates:list:*');

  logger.info(`Bulk BOM templates created: ${created.length} success, ${errors.length} failed`);

  return ApiResponse.send(res, {
    created,
    errors,
    summary: {
      total: templates.length,
      success: created.length,
      failed: errors.length,
    },
  }, 'Bulk BOM template creation completed');
};