// src/validations/material.validation.js
import Joi from 'joi';

// Common schemas
const materialUnit = Joi.string().valid(
  'nos', 'mtr', 'kg', 'packet', 'pair', 'bag', 'roll', 'box'
);

// Validation schemas
export const createMaterialValidation = Joi.object({
  name: Joi.string()
    .required()
    .min(2)
    .max(100)
    .messages({
      'string.min': 'Name must be at least 2 characters',
      'string.max': 'Name cannot exceed 100 characters',
      'any.required': 'Name is required',
    }),
  unit: materialUnit.required().messages({
    'any.required': 'Unit is required',
  }),
  unitCost: Joi.number().min(0).default(0),
  currentStock: Joi.number().min(0).default(0),
  minimumStockLevel: Joi.number().min(0).default(0),
  maximumStockLevel: Joi.number().min(0).default(0),
  preferredSupplier: Joi.string().hex().length(24),
  alternateSuppliers: Joi.array().items(Joi.string().hex().length(24)),
  isConsumable: Joi.boolean().default(false),
});

export const updateMaterialValidation = Joi.object({
  name: Joi.string().min(2).max(100),
  unit: materialUnit,
  unitCost: Joi.number().min(0),
  minimumStockLevel: Joi.number().min(0),
  maximumStockLevel: Joi.number().min(0),
  preferredSupplier: Joi.string().hex().length(24).allow(null),
  alternateSuppliers: Joi.array().items(Joi.string().hex().length(24)),
  isConsumable: Joi.boolean(),
  status: Joi.string().valid('active', 'inactive', 'discontinued'),
});

export const listMaterialsValidation = Joi.object({
  page: Joi.number().min(1).default(1),
  limit: Joi.number().min(1).max(100).default(20),
  status: Joi.string().valid('active', 'inactive', 'discontinued'),
  search: Joi.string().max(100),
  lowStock: Joi.boolean(),
  sortBy: Joi.string().valid('name', 'currentStock', 'createdAt'),
  sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
});

export const searchMaterialsValidation = Joi.object({
  q: Joi.string().required().min(1).messages({
    'any.required': 'Search query is required',
    'string.min': 'Search query must be at least 1 character',
  }),
  limit: Joi.number().min(1).max(50).default(20),
});

export const getMaterialValidation = Joi.object({
  id: Joi.string().hex().length(24).required().messages({
    'any.required': 'Material ID is required',
    'string.hex': 'Invalid material ID format',
  }),
});

export const deleteMaterialValidation = Joi.object({
  id: Joi.string().hex().length(24).required(),
});

export const uploadImageValidation = Joi.object({
  id: Joi.string().hex().length(24).required(),
});

export const getMaterialHistoryValidation = Joi.object({
  id: Joi.string().hex().length(24).required(),
  page: Joi.number().min(1).default(1),
  limit: Joi.number().min(1).max(100).default(20),
});

export const adjustStockValidation = Joi.object({
  id: Joi.string().hex().length(24).required(),
  adjustment: Joi.number().required().messages({
    'any.required': 'Adjustment amount is required',
  }),
  reason: Joi.string().required().max(500).messages({
    'any.required': 'Reason is required',
  }),
});

export const adjustStockParamsValidation = Joi.object({
  id: Joi.string().hex().length(24).required(),
});

export const adjustStockBodyValidation = Joi.object({
  adjustment: Joi.number().required().messages({
    'any.required': 'Adjustment amount is required',
  }),
  reason: Joi.string().required().max(500).messages({
    'any.required': 'Reason is required',
  }),
});