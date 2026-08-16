// src/validations/bomTemplate.validation.js
import Joi from 'joi';

const roofType = Joi.string().valid('rcc_rooftop', 'tin_shed', 'ground_mount');
const formulaType = Joi.string().valid('fixed', 'per_kw', 'linear', 'step');

export const createBOMTemplateValidation = Joi.object({
  templateName: Joi.string().required().min(2).max(100).messages({
    'any.required': 'Template name is required',
    'string.min': 'Template name must be at least 2 characters',
    'string.max': 'Template name cannot exceed 100 characters',
  }),
  roofType: roofType.required().messages({
    'any.required': 'Roof type is required',
  }),
  systemSizeKW: Joi.number().required().min(0.1).messages({
    'any.required': 'System size is required',
    'number.min': 'System size must be at least 0.1 kW',
  }),
  section: Joi.string().required().messages({
    'any.required': 'Section is required',
  }),
  sectionOrder: Joi.number().integer().min(0),
  material: Joi.string().hex().length(24).required().messages({
    'any.required': 'Material is required',
  }),
  qtyFormula: Joi.object({
    type: formulaType.required().messages({
      'any.required': 'Formula type is required',
    }),
    value: Joi.number().required().messages({
      'any.required': 'Formula value is required',
    }),
    minQty: Joi.number().min(0),
    maxQty: Joi.number().min(0),
    stepSizes: Joi.array().items(
      Joi.object({
        fromKW: Joi.number().required(),
        toKW: Joi.number().required(),
        qty: Joi.number().required(),
      })
    ),
  }).required(),
  isOptional: Joi.boolean().default(false),
  defaultRemark: Joi.string().max(500),
  wastageFactor: Joi.number().min(0).max(100).default(0),
  priority: Joi.number().integer().min(1).default(1),
});

export const updateBOMTemplateValidation = Joi.object({
  templateName: Joi.string().min(2).max(100),
  roofType: roofType,
  systemSizeKW: Joi.number().min(0.1),
  section: Joi.string(),
  sectionOrder: Joi.number().integer().min(0),
  material: Joi.string().hex().length(24),
  qtyFormula: Joi.object({
    type: formulaType,
    value: Joi.number(),
    minQty: Joi.number().min(0),
    maxQty: Joi.number().min(0),
    stepSizes: Joi.array().items(
      Joi.object({
        fromKW: Joi.number().required(),
        toKW: Joi.number().required(),
        qty: Joi.number().required(),
      })
    ),
  }),
  isOptional: Joi.boolean(),
  defaultRemark: Joi.string().max(500),
  wastageFactor: Joi.number().min(0).max(100),
  priority: Joi.number().integer().min(1),
  isActive: Joi.boolean(),
});

export const listBOMTemplatesValidation = Joi.object({
  page: Joi.number().min(1).default(1),
  limit: Joi.number().min(1).max(100).default(20),
  roofType: roofType,
  section: Joi.string(),
  search: Joi.string().max(100),
  sortBy: Joi.string().valid('templateName', 'roofType', 'systemSizeKW', 'section'),
  sortOrder: Joi.string().valid('asc', 'desc').default('asc'),
});

export const getBOMTemplateValidation = Joi.object({
  id: Joi.string().hex().length(24).required(),
});

export const deleteBOMTemplateValidation = Joi.object({
  id: Joi.string().hex().length(24).required(),
});

export const getBOMByRoofTypeValidation = Joi.object({
  roofType: roofType.required().messages({
    'any.required': 'Roof type is required',
  }),
  systemSizeKW: Joi.number().required().min(0.1).messages({
    'any.required': 'System size is required',
    'number.min': 'System size must be at least 0.1 kW',
  }),
});

export const bulkCreateBOMTemplatesValidation = Joi.object({
  templates: Joi.array()
    .items(createBOMTemplateValidation)
    .min(1)
    .required()
    .messages({
      'array.min': 'At least one template is required',
      'any.required': 'Templates are required',
    }),
});