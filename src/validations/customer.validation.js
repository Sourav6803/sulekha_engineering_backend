// src/validations/customer.validation.js
import Joi from 'joi';

const roofType = Joi.string().valid('rcc_rooftop', 'tin_shed', 'ground_mount');
const customerStatus = Joi.string().valid('active', 'inactive', 'blocked', 'pending_verification');

export const createCustomerValidation = Joi.object({
  name: Joi.string()
    .required()
    .min(2)
    .max(100)
    .messages({
      'string.min': 'Name must be at least 2 characters',
      'string.max': 'Name cannot exceed 100 characters',
      'any.required': 'Name is required',
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
  address: Joi.string().required().max(500).messages({
    'any.required': 'Address is required',
    'string.max': 'Address cannot exceed 500 characters',
  }),
  city: Joi.string().required().messages({
    'any.required': 'City is required',
  }),
  state: Joi.string().required().messages({
    'any.required': 'State is required',
  }),
  pincode: Joi.string()
    .required()
    .pattern(/^[0-9]{6}$/)
    .messages({
      'string.pattern.base': 'Please enter a valid 6-digit pincode',
      'any.required': 'Pincode is required',
    }),
  village: Joi.string().max(100),
  block: Joi.string().max(100),
  panchayat: Joi.string().max(100),
  landmark: Joi.string().max(200),
  systemSizeKW: Joi.number()
    .required()
    .min(0.1)
    .max(100)
    .messages({
      'number.min': 'System size must be at least 0.1 kW',
      'number.max': 'System size cannot exceed 100 kW',
      'any.required': 'System size is required',
    }),
  roofType: roofType.required().messages({
    'any.required': 'Roof type is required',
  }),
  roofArea: Joi.number().min(0).max(10000),
  gstNumber: Joi.string()
    .pattern(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/)
    .messages({
      'string.pattern.base': 'Please enter a valid GST number',
    }),
  panNumber: Joi.string()
    .pattern(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/)
    .messages({
      'string.pattern.base': 'Please enter a valid PAN number',
    }),
  preferredInstallationDate: Joi.date(),
  preferredTimeSlot: Joi.string().valid('morning', 'afternoon', 'evening', 'anytime'),
  notes: Joi.string().max(1000),
  referredBy: Joi.string().max(100),
});

export const updateCustomerValidation = Joi.object({
  name: Joi.string().min(2).max(100),
  phone: Joi.string().pattern(/^[0-9]{10}$/),
  alternatePhone: Joi.string().pattern(/^[0-9]{10}$/),
  email: Joi.string().email(),
  address: Joi.string().max(500),
  city: Joi.string(),
  state: Joi.string(),
  pincode: Joi.string().pattern(/^[0-9]{6}$/),
  village: Joi.string().max(100),
  block: Joi.string().max(100),
  panchayat: Joi.string().max(100),
  landmark: Joi.string().max(200),
  systemSizeKW: Joi.number().min(0.1).max(100),
  roofType: roofType,
  roofArea: Joi.number().min(0).max(10000),
  gstNumber: Joi.string()
    .pattern(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/),
  panNumber: Joi.string()
    .pattern(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/),
  preferredInstallationDate: Joi.date(),
  preferredTimeSlot: Joi.string().valid('morning', 'afternoon', 'evening', 'anytime'),
  status: customerStatus,
  notes: Joi.string().max(1000),
  referredBy: Joi.string().max(100),
});

export const listCustomersValidation = Joi.object({
  page: Joi.number().min(1).default(1),
  limit: Joi.number().min(1).max(100).default(20),
  status: customerStatus,
  city: Joi.string(),
  state: Joi.string(),
  roofType: roofType,
  search: Joi.string().max(100),
  sortBy: Joi.string().valid('name', 'createdAt', 'systemSizeKW'),
  sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
});

export const searchCustomersValidation = Joi.object({
  q: Joi.string().required().min(1),
  limit: Joi.number().min(1).max(50).default(20),
});

export const getCustomerValidation = Joi.object({
  id: Joi.string().hex().length(24).required(),
});

export const deleteCustomerValidation = Joi.object({
  id: Joi.string().hex().length(24).required(),
});

export const getCustomerInstallationsValidation = Joi.object({
  id: Joi.string().hex().length(24).required(),
  page: Joi.number().min(1).default(1),
  limit: Joi.number().min(1).max(100).default(20),
});

export const getCustomerHistoryValidation = Joi.object({
  id: Joi.string().hex().length(24).required(),
});

export const uploadDocumentParamsValidation = Joi.object({
  id: Joi.string().hex().length(24).required()
});

export const uploadDocumentBodyValidation = Joi.object({
  type: Joi.string().valid(
    'aadhar',
    'voterId',
    'panCard',
    'passbookOrCheque',
    'electricBill',
    'landRecord',
    'sitePhotoBefore',
    'sitePhotoAfter',
    'loanApprovalLetter',
    'rtsFeasibilityReport',
    'feasibilityApproval',
    'agreement',
    'quotation',
    'dcrCertificate',
    'panelSerialNumber'
  ).required()
});

export const deleteDocumentValidation = Joi.object({
  id: Joi.string().hex().length(24).required(),
  documentId: Joi.string().hex().length(24).required()
});