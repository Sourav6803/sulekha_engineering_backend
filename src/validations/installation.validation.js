// src/validations/installation.validation.js
import Joi from 'joi';

const installationStatus = Joi.string().valid(
  'pending_quotation',
  'quoted',
  'scheduled',
  'in_progress',
  'completed',
  'cancelled'
);

const materialStatus = Joi.string().valid('reserved', 'installed', 'reversed');
const roofType = Joi.string().valid('rcc_rooftop', 'tin_shed', 'ground_mount');

export const createInstallationValidation = Joi.object({
  customer: Joi.string().hex().length(24).required().messages({
    'any.required': 'Customer is required',
  }),
  projectNo: Joi.string().max(50),
  quotationNo: Joi.string().max(50),
  systemSizeKW: Joi.number()
    .required()
    .min(0.1)
    .messages({
      'number.min': 'System size must be at least 0.1 kW',
      'any.required': 'System size is required',
    }),
  roofType: roofType.required().messages({
    'any.required': 'Roof type is required',
  }),
  orderDate: Joi.date(),
  installDate: Joi.date().required().messages({
    'any.required': 'Installation date is required',
  }),
  laborCost: Joi.number().min(0).default(0),
  notes: Joi.string().max(1000),
});

export const updateInstallationValidation = Joi.object({
  customer: Joi.string().hex().length(24),
  projectNo: Joi.string().max(50),
  quotationNo: Joi.string().max(50),
  systemSizeKW: Joi.number().min(0.1),
  roofType: roofType,
  orderDate: Joi.date(),
  installDate: Joi.date(),
  laborCost: Joi.number().min(0),
  notes: Joi.string().max(1000),
  status: installationStatus,
});

export const listInstallationsValidation = Joi.object({
  page: Joi.number().min(1).default(1),
  limit: Joi.number().min(1).max(100).default(20),
  customer: Joi.string().hex().length(24),
  status: installationStatus,
  roofType: roofType,
  dateFrom: Joi.date(),
  dateTo: Joi.date().min(Joi.ref('dateFrom')),
  search: Joi.string().max(100),
  sortBy: Joi.string().valid('installDate', 'createdAt', 'systemSizeKW', 'status'),
  sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
});

export const getInstallationValidation = Joi.object({
  id: Joi.string().hex().length(24).required(),
});

export const deleteInstallationValidation = Joi.object({
  id: Joi.string().hex().length(24).required(),
});

export const assignMaterialsValidation = Joi.object({
  id: Joi.string().hex().length(24).required(),
  items: Joi.array()
    .items(
      Joi.object({
        material: Joi.string().hex().length(24).required(),
        qty: Joi.number().min(0.001).required(),
        remark: Joi.string().max(500).allow('').allow(null),
      })
    )
    .min(1)
    .required()
    .messages({
      'array.min': 'At least one item is required',
      'any.required': 'Items are required',
    }),
  idempotencyKey: Joi.string().uuid(),
});

export const assignMaterialsParamsValidation = Joi.object({
  id: Joi.string().hex().length(24).required(),
});

export const assignMaterialsBodyValidation = Joi.object({
  items: Joi.array()
    .items(
      Joi.object({
        material: Joi.alternatives().try(
          Joi.string().hex().length(24),
          Joi.string().min(1).max(200)
        ).required(),
        qty: Joi.number().min(0.001).required(),
        remark: Joi.string().max(500).allow('').allow(null),
      })
    )
    .min(1)
    .required()
    .messages({
      'array.min': 'At least one item is required',
      'any.required': 'Items are required',
    }),
  idempotencyKey: Joi.string().uuid(),
});

export const reverseMaterialValidation = Joi.object({
  id: Joi.string().hex().length(24).required(),
  usageId: Joi.string().hex().length(24).required(),
  reason: Joi.string().required().max(500).messages({
    'any.required': 'Reversal reason is required',
    'string.max': 'Reason cannot exceed 500 characters',
  }),
});

export const generateBOMPDFValidation = Joi.object({
  id: Joi.string().hex().length(24).required(),
});

export const generateBOMPDFQueryValidation = Joi.object({
  variant: Joi.string().valid('suggested', 'final').default('final'),
});

export const updateInstallationStatusValidation = Joi.object({
  status: installationStatus.required().messages({
    'any.required': 'Status is required',
  }),
  notes: Joi.string().max(500),
});

export const updateInstallationStatusParamsValidation = Joi.object({
  id: Joi.string().hex().length(24).required(),
});

export const getLoadAnalysisValidation = Joi.object({
  id: Joi.string().hex().length(24).required(),
});

export const getSuggestedBOMValidation = Joi.object({
  roofType: roofType.required().messages({
    'any.required': 'Roof type is required',
  }),
  systemSizeKW: Joi.number()
    .required()
    .min(0.1)
    .messages({
      'number.min': 'System size must be at least 0.1 kW',
      'any.required': 'System size is required',
    }),
});