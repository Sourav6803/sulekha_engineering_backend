// src/validations/supplier.validation.js
import Joi from 'joi';

// Common schemas
const businessType = Joi.string().valid(
  'manufacturer',
  'distributor',
  'wholesaler',
  'retailer',
  'importer'
);

const paymentTerms = Joi.string().valid(
  'advance',
  'credit_7_days',
  'credit_15_days',
  'credit_30_days',
  'credit_45_days'
);

const supplierStatus = Joi.string().valid(
  'active',
  'inactive',
  'suspended',
  'blacklisted'
);

const supplierCategory = Joi.string().valid(
  'SPV Module',
  'RCC Structure',
  'Tin Shed Structure',
  'AC Part',
  'DC Cable',
  'AC Cable',
  'Earthing',
  'Junction Box',
  'Mounting Structure',
  'Fasteners',
  'Other'
);

// ============================================
// CREATE SUPPLIER VALIDATION
// ============================================
export const createSupplierValidation = Joi.object({
  name: Joi.string()
    .required()
    .min(2)
    .max(100)
    .messages({
      'string.min': 'Name must be at least 2 characters',
      'string.max': 'Name cannot exceed 100 characters',
      'any.required': 'Supplier name is required',
    }),
  
  phone: Joi.string()
    .required()
    .pattern(/^[0-9]{10}$/)
    .messages({
      'string.pattern.base': 'Please enter a valid 10-digit phone number',
      'any.required': 'Phone number is required',
    }),
  
  alternatePhone: Joi.string()
    .pattern(/^[0-9]{10}$/)
    .messages({
      'string.pattern.base': 'Please enter a valid 10-digit phone number',
    }),
  
  email: Joi.string()
    .email()
    .messages({
      'string.email': 'Please enter a valid email address',
    }),
  
  website: Joi.string()
    .uri()
    .messages({
      'string.uri': 'Please enter a valid website URL',
    }),
  
  address: Joi.string()
    .required()
    .trim()
    .messages({
      'any.required': 'Address is required',
    }),
  
  city: Joi.string()
    .required()
    .trim()
    .messages({
      'any.required': 'City is required',
    }),
  
  state: Joi.string()
    .required()
    .trim()
    .messages({
      'any.required': 'State is required',
    }),
  
  pincode: Joi.string()
    .required()
    .pattern(/^[0-9]{6}$/)
    .messages({
      'string.pattern.base': 'Please enter a valid 6-digit pincode',
      'any.required': 'Pincode is required',
    }),
  
  gstNumber: Joi.string()
    .pattern(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/)
    .messages({
      'string.pattern.base': 'Please enter a valid GST number (e.g., 22AAAAA0000A1Z5)',
    }),
  
  panNumber: Joi.string()
    .pattern(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/)
    .messages({
      'string.pattern.base': 'Please enter a valid PAN number (e.g., ABCDE1234F)',
    }),
  
  businessType: businessType
    .default('wholesaler'),
  
  categories: Joi.array()
    .items(supplierCategory)
    .min(1)
    .messages({
      'array.min': 'At least one category must be selected',
    }),
  
  bankDetails: Joi.object({
    accountHolderName: Joi.string().max(100),
    bankName: Joi.string().max(100),
    accountNumber: Joi.string().max(50),
    ifscCode: Joi.string()
      .pattern(/^[A-Z]{4}0[A-Z0-9]{6}$/)
      .messages({
        'string.pattern.base': 'Please enter a valid IFSC code (e.g., SBIN0012345)',
      }),
    upiId: Joi.string()
      .pattern(/^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/)
      .messages({
        'string.pattern.base': 'Please enter a valid UPI ID (e.g., example@upi)',
      }),
  }),
  
  paymentTerms: paymentTerms
    .default('credit_15_days'),
  
  creditLimit: Joi.number()
    .min(0)
    .default(0),
  
  notes: Joi.string()
    .max(1000)
    .messages({
      'string.max': 'Notes cannot exceed 1000 characters',
    }),
});

// ============================================
// UPDATE SUPPLIER VALIDATION
// ============================================
export const updateSupplierValidation = Joi.object({
  name: Joi.string()
    .min(2)
    .max(100)
    .messages({
      'string.min': 'Name must be at least 2 characters',
      'string.max': 'Name cannot exceed 100 characters',
    }),
  
  phone: Joi.string()
    .pattern(/^[0-9]{10}$/)
    .messages({
      'string.pattern.base': 'Please enter a valid 10-digit phone number',
    }),
  
  alternatePhone: Joi.string()
    .pattern(/^[0-9]{10}$/)
    .messages({
      'string.pattern.base': 'Please enter a valid 10-digit phone number',
    }),
  
  email: Joi.string()
    .email()
    .messages({
      'string.email': 'Please enter a valid email address',
    }),
  
  website: Joi.string()
    .uri()
    .messages({
      'string.uri': 'Please enter a valid website URL',
    }),
  
  address: Joi.string()
    .trim(),
  
  city: Joi.string()
    .trim(),
  
  state: Joi.string()
    .trim(),
  
  pincode: Joi.string()
    .pattern(/^[0-9]{6}$/)
    .messages({
      'string.pattern.base': 'Please enter a valid 6-digit pincode',
    }),
  
  gstNumber: Joi.string()
    .pattern(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/)
    .allow(null, '')
    .messages({
      'string.pattern.base': 'Please enter a valid GST number',
    }),
  
  panNumber: Joi.string()
    .pattern(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/)
    .allow(null, '')
    .messages({
      'string.pattern.base': 'Please enter a valid PAN number',
    }),
  
  businessType: businessType,
  
  categories: Joi.array()
    .items(supplierCategory)
    .min(1),
  
  bankDetails: Joi.object({
    accountHolderName: Joi.string().max(100),
    bankName: Joi.string().max(100),
    accountNumber: Joi.string().max(50),
    ifscCode: Joi.string()
      .pattern(/^[A-Z]{4}0[A-Z0-9]{6}$/)
      .messages({
        'string.pattern.base': 'Please enter a valid IFSC code',
      }),
    upiId: Joi.string()
      .pattern(/^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/)
      .messages({
        'string.pattern.base': 'Please enter a valid UPI ID',
      }),
  }),
  
  paymentTerms: paymentTerms,
  
  creditLimit: Joi.number()
    .min(0),
  
  averageDeliveryDays: Joi.number()
    .min(0)
    .integer(),
  
  qualityRating: Joi.number()
    .min(0)
    .max(5),
  
  status: supplierStatus,
  
  notes: Joi.string()
    .max(1000)
    .messages({
      'string.max': 'Notes cannot exceed 1000 characters',
    }),
});

// ============================================
// LIST SUPPLIERS VALIDATION
// ============================================
export const listSuppliersValidation = Joi.object({
  page: Joi.number()
    .min(1)
    .default(1)
    .messages({
      'number.min': 'Page must be at least 1',
    }),
  
  limit: Joi.number()
    .min(1)
    .max(100)
    .default(20)
    .messages({
      'number.min': 'Limit must be at least 1',
      'number.max': 'Limit cannot exceed 100',
    }),
  
  status: supplierStatus,
  
  businessType: businessType,
  
  city: Joi.string()
    .trim(),
  
  state: Joi.string()
    .trim(),
  
  category: supplierCategory,
  
  search: Joi.string()
    .max(100)
    .trim()
    .messages({
      'string.max': 'Search query cannot exceed 100 characters',
    }),
  
  hasGST: Joi.boolean(),
  
  minRating: Joi.number()
    .min(0)
    .max(5),
  
  sortBy: Joi.string()
    .valid(
      'name',
      'createdAt',
      'updatedAt',
      'qualityRating',
      'averageDeliveryDays',
      'businessType'
    )
    .default('name'),
  
  sortOrder: Joi.string()
    .valid('asc', 'desc')
    .default('asc'),
});

// ============================================
// GET SUPPLIER VALIDATION
// ============================================
export const getSupplierValidation = Joi.object({
  id: Joi.string()
    .hex()
    .length(24)
    .required()
    .messages({
      'string.hex': 'Invalid supplier ID format',
      'string.length': 'Supplier ID must be 24 characters',
      'any.required': 'Supplier ID is required',
    }),
});

// ============================================
// DELETE SUPPLIER VALIDATION
// ============================================
export const deleteSupplierValidation = Joi.object({
  id: Joi.string()
    .hex()
    .length(24)
    .required()
    .messages({
      'string.hex': 'Invalid supplier ID format',
      'string.length': 'Supplier ID must be 24 characters',
      'any.required': 'Supplier ID is required',
    }),
});

// ============================================
// GET SUPPLIER PURCHASES VALIDATION
// ============================================
export const getSupplierPurchasesValidation = Joi.object({
  id: Joi.string()
    .hex()
    .length(24)
    .required()
    .messages({
      'string.hex': 'Invalid supplier ID format',
      'string.length': 'Supplier ID must be 24 characters',
      'any.required': 'Supplier ID is required',
    }),
  
  page: Joi.number()
    .min(1)
    .default(1),
  
  limit: Joi.number()
    .min(1)
    .max(100)
    .default(20),
  
  dateFrom: Joi.date(),
  
  dateTo: Joi.date()
    .min(Joi.ref('dateFrom'))
    .messages({
      'date.min': 'Date To must be after Date From',
    }),
  
  status: Joi.string()
    .valid('pending', 'processing', 'completed', 'cancelled'),
});

// ============================================
// BULK SUPPLIER OPERATIONS VALIDATION
// ============================================
export const bulkCreateSuppliersValidation = Joi.object({
  suppliers: Joi.array()
    .items(createSupplierValidation)
    .min(1)
    .max(50)
    .required()
    .messages({
      'array.min': 'At least one supplier is required',
      'array.max': 'Cannot create more than 50 suppliers at once',
      'any.required': 'Suppliers array is required',
    }),
});

export const bulkUpdateSuppliersValidation = Joi.object({
  updates: Joi.array()
    .items(
      Joi.object({
        id: Joi.string()
          .hex()
          .length(24)
          .required()
          .messages({
            'string.hex': 'Invalid supplier ID format',
            'string.length': 'Supplier ID must be 24 characters',
            'any.required': 'Supplier ID is required',
          }),
        data: updateSupplierValidation,
      })
    )
    .min(1)
    .max(50)
    .required()
    .messages({
      'array.min': 'At least one update is required',
      'array.max': 'Cannot update more than 50 suppliers at once',
      'any.required': 'Updates array is required',
    }),
});

// ============================================
// SUPPLIER ANALYSIS VALIDATION
// ============================================
export const supplierAnalysisValidation = Joi.object({
  supplierId: Joi.string()
    .hex()
    .length(24)
    .required()
    .messages({
      'string.hex': 'Invalid supplier ID format',
      'string.length': 'Supplier ID must be 24 characters',
      'any.required': 'Supplier ID is required',
    }),
  
  dateFrom: Joi.date()
    .default(() => {
      const date = new Date();
      date.setMonth(date.getMonth() - 6);
      return date;
    }),
  
  dateTo: Joi.date()
    .default(Date.now)
    .min(Joi.ref('dateFrom')),
});

// ============================================
// SUPPLIER PERFORMANCE VALIDATION
// ============================================
export const supplierPerformanceValidation = Joi.object({
  dateFrom: Joi.date()
    .default(() => {
      const date = new Date();
      date.setMonth(date.getMonth() - 12);
      return date;
    }),
  
  dateTo: Joi.date()
    .default(Date.now)
    .min(Joi.ref('dateFrom')),
  
  category: supplierCategory,
  
  minPurchases: Joi.number()
    .min(0)
    .default(0),
});

// ============================================
// EXPORT ALL VALIDATIONS
// ============================================
export default {
  createSupplierValidation,
  updateSupplierValidation,
  listSuppliersValidation,
  getSupplierValidation,
  deleteSupplierValidation,
  getSupplierPurchasesValidation,
  bulkCreateSuppliersValidation,
  bulkUpdateSuppliersValidation,
  supplierAnalysisValidation,
  supplierPerformanceValidation,
};