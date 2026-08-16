// src/services/bomTemplate.service.js
import { BOMTemplate, Material } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import logger from '../utils/logger.js';
import { redisGet, redisSet } from '../config/redis.js';

const CACHE_TTL = 3600; // 1 hour

/**
 * BOM Template Service - Handles all BOM template related logic
 */
export const bomTemplateService = {
  /**
   * Get suggested BOM from templates
   * @param {String} roofType - Roof type (rcc_rooftop, tin_shed, ground_mount)
   * @param {Number} systemSizeKW - System size in kW
   * @returns {Promise<Array>} Suggested BOM items grouped by section
   */
  async getSuggestedBOM(roofType, systemSizeKW) {
    try {
      // Check cache first
      const cacheKey = `bom:${roofType}:${systemSizeKW}`;
      const cached = await redisGet(cacheKey);
      if (cached) {
        return cached;
      }

      // Get all active templates for this roof type
      const templates = await BOMTemplate.find({
        roofType,
        isActive: true,
      })
        .populate('material', 'name materialCode unit currentStock')
        .lean();

      if (!templates || templates.length === 0) {
        return [];
      }

      // Group templates by system size (find closest match)
      const sizeTemplates = this.findClosestSizeTemplates(templates, systemSizeKW);

      // Calculate quantities for each template
      const bomItems = [];
      for (const template of sizeTemplates) {
        const qty = this.calculateQuantity(template, systemSizeKW);
        if (qty > 0) {
          bomItems.push({
            material: template.material,
            materialName: template.material.name,
            materialCode: template.material.materialCode,
            unit: template.material.unit,
            quantity: Math.ceil(qty),
            section: template.section,
            remark: template.defaultRemark || '',
            isOptional: template.isOptional || false,
            priority: template.priority || 1,
            currentStock: template.material.currentStock || 0,
          });
        }
      }

      // Group by section
      const grouped = this.groupBySection(bomItems);

      // Cache result
      await redisSet(cacheKey, grouped, CACHE_TTL);

      return grouped;

    } catch (error) {
      logger.error('BOM generation failed:', error);
      throw error;
    }
  },

  /**
   * Find closest size templates for a given system size
   * @param {Array} templates - All templates
   * @param {Number} systemSizeKW - System size
   * @returns {Array} Filtered templates
   */
  findClosestSizeTemplates(templates, systemSizeKW) {
    // Find exact match first
    let exact = templates.filter(t => t.systemSizeKW === systemSizeKW);
    if (exact.length > 0) {
      return exact;
    }

    // Find closest match (round up)
    const sorted = [...templates].sort((a, b) => a.systemSizeKW - b.systemSizeKW);
    let closest = null;
    let minDiff = Infinity;

    for (const template of sorted) {
      const diff = Math.abs(template.systemSizeKW - systemSizeKW);
      if (diff < minDiff) {
        minDiff = diff;
        closest = template;
      }
      // If we find a template that's larger than the system size, it's usually better
      if (template.systemSizeKW >= systemSizeKW) {
        break;
      }
    }

    // Return all templates with the same system size as the closest
    if (closest) {
      return templates.filter(t => t.systemSizeKW === closest.systemSizeKW);
    }

    return [];
  },

  /**
   * Calculate quantity based on formula
   * @param {Object} template - BOM template
   * @param {Number} systemSizeKW - System size
   * @returns {Number} Calculated quantity
   */
  calculateQuantity(template, systemSizeKW) {
    const formula = template.qtyFormula;
    let qty = 0;

    switch (formula.type) {
      case 'fixed':
        qty = formula.value;
        break;

      case 'per_kw':
        qty = formula.value * systemSizeKW;
        break;

      case 'linear':
        qty = formula.value * systemSizeKW + (formula.minQty || 0);
        break;

      case 'step':
        if (formula.stepSizes && formula.stepSizes.length > 0) {
          // Find matching step
          const step = formula.stepSizes.find(
            s => systemSizeKW >= s.fromKW && systemSizeKW <= s.toKW
          );
          qty = step ? step.qty : formula.value;
        } else {
          qty = formula.value;
        }
        break;

      default:
        qty = formula.value;
    }

    // Apply wastage factor
    if (template.wastageFactor && template.wastageFactor > 0) {
      qty = qty * (1 + template.wastageFactor / 100);
    }

    // Apply min/max constraints
    if (formula.minQty) {
      qty = Math.max(qty, formula.minQty);
    }
    if (formula.maxQty) {
      qty = Math.min(qty, formula.maxQty);
    }

    return qty;
  },

  /**
   * Group BOM items by section
   * @param {Array} items - BOM items
   * @returns {Array} Grouped items
   */
  groupBySection(items) {
    const sectionOrder = {
      'SPV Modules': 1,
      'Structure': 2,
      'Cables': 3,
      'Earthing': 4,
      'Junction Boxes': 5,
      'AC Parts': 6,
      'Fasteners': 7,
      'Other': 8,
    };

    const grouped = {};

    for (const item of items) {
      const section = item.section || 'Other';
      if (!grouped[section]) {
        grouped[section] = {
          section,
          order: sectionOrder[section] || 99,
          items: [],
          totalQuantity: 0,
          totalCost: 0,
        };
      }
      grouped[section].items.push(item);
      grouped[section].totalQuantity += item.quantity;
    }

    // Convert to array and sort by order
    return Object.values(grouped).sort((a, b) => a.order - b.order);
  },

  /**
   * Create or update BOM template
   * @param {Object} templateData - Template data
   * @param {String} userId - User ID
   * @returns {Promise<Object>} Created/updated template
   */
  async upsertTemplate(templateData, userId) {
    try {
      // Validate material exists
      const material = await Material.findById(templateData.material);
      if (!material) {
        throw ApiError.notFound('Material');
      }

      // Check for existing template
      const existing = await BOMTemplate.findOne({
        roofType: templateData.roofType,
        systemSizeKW: templateData.systemSizeKW,
        section: templateData.section,
        material: templateData.material,
      });

      let template;
      if (existing) {
        // Update existing
        Object.assign(existing, templateData);
        existing.updatedBy = userId;
        template = await existing.save();
      } else {
        // Create new
        template = await BOMTemplate.create({
          ...templateData,
          createdBy: userId,
          updatedBy: userId,
        });
      }

      // Invalidate cache
      const cacheKey = `bom:${template.roofType}:${template.systemSizeKW}`;
      await redisGet(cacheKey); // Just to ensure Redis is connected

      logger.info(`BOM template ${existing ? 'updated' : 'created'}: ${template.templateName}`);

      return template;

    } catch (error) {
      logger.error('BOM template upsert failed:', error);
      throw error;
    }
  },

  /**
   * Bulk create BOM templates
   * @param {Array} templatesData - Array of template data
   * @param {String} userId - User ID
   * @returns {Promise<Object>} Result with created/updated templates
   */
  async bulkUpsertTemplates(templatesData, userId) {
    const results = {
      created: [],
      updated: [],
      errors: [],
    };

    for (const templateData of templatesData) {
      try {
        const result = await this.upsertTemplate(templateData, userId);
        if (result) {
          // Check if it was created or updated
          const existing = await BOMTemplate.findOne({
            roofType: templateData.roofType,
            systemSizeKW: templateData.systemSizeKW,
            section: templateData.section,
            material: templateData.material,
          });
          
          if (existing && existing.createdAt !== result.createdAt) {
            results.updated.push(result);
          } else {
            results.created.push(result);
          }
        }
      } catch (error) {
        results.errors.push({
          data: templateData,
          error: error.message,
        });
      }
    }

    return results;
  },

  /**
   * Delete BOM template
   * @param {String} templateId - Template ID
   * @param {String} userId - User ID
   * @returns {Promise<Object>} Deleted template
   */
  async deleteTemplate(templateId, userId) {
    try {
      const template = await BOMTemplate.findById(templateId);
      if (!template) {
        throw ApiError.notFound('BOM Template');
      }

      template.isActive = false;
      template.updatedBy = userId;
      await template.save();

      // Invalidate cache
      const cacheKey = `bom:${template.roofType}:${template.systemSizeKW}`;
      await redisGet(cacheKey); // Just to ensure Redis is connected

      logger.info(`BOM template deleted: ${template.templateName}`);

      return template;

    } catch (error) {
      logger.error('BOM template deletion failed:', error);
      throw error;
    }
  },

  /**
   * Get BOM template by ID with material details
   * @param {String} templateId - Template ID
   * @returns {Promise<Object>} Template with material details
   */
  async getTemplateWithDetails(templateId) {
    try {
      const template = await BOMTemplate.findById(templateId)
        .populate('material', 'name materialCode unit currentStock minimumStockLevel')
        .populate('createdBy', 'name email')
        .lean();

      if (!template) {
        throw ApiError.notFound('BOM Template');
      }

      return template;

    } catch (error) {
      logger.error('BOM template fetch failed:', error);
      throw error;
    }
  },

  /**
   * Validate BOM template data
   * @param {Object} data - Template data
   * @returns {Object} Validation result
   */
  validateTemplateData(data) {
    const errors = [];

    if (!data.roofType) {
      errors.push('Roof type is required');
    }

    if (!data.systemSizeKW || data.systemSizeKW <= 0) {
      errors.push('System size must be greater than 0');
    }

    if (!data.section) {
      errors.push('Section is required');
    }

    if (!data.material) {
      errors.push('Material is required');
    }

    if (!data.qtyFormula || !data.qtyFormula.type) {
      errors.push('Quantity formula is required');
    }

    if (data.qtyFormula && data.qtyFormula.type) {
      if (!data.qtyFormula.value && data.qtyFormula.value !== 0) {
        errors.push('Quantity formula value is required');
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  },
};