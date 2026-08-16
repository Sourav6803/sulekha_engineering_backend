// src/validations/purchase.validation.js
import Joi from 'joi';

const paymentStatus = Joi.string().valid('pending', 'partial', 'completed');
const deliveryMethod = Joi.string().valid('pickup', 'courier', 'delivery', 'self_delivery');
const paymentMethod = Joi.string().valid('cash', 'bank_transfer', 'cheque', 'upi', 'online');

const purchaseItemSchema = Joi.object({
  material: Joi.string().hex().length(24).required(),
  qty: Joi.number().min(0.001).required(),
  unitCost: Joi.number().min(0).required(),
  discount: Joi.number().min(0).default(0),
});

export const createPurchaseValidation = Joi.object({
  supplier: Joi.string().hex().length(24).required().messages({
    'any.required': 'Supplier is required',
  }),
  purchaseDate: Joi.date().max('now').default(Date.now),
  invoiceNumber: Joi.string().max(50),
  purchaseOrderNumber: Joi.string().max(50),
  discount: Joi.number().min(0).default(0),
  tax: Joi.number().min(0).default(0),
  paymentStatus: paymentStatus.default('pending'),
  paymentMethod: paymentMethod.default('bank_transfer'),
  deliveryMethod: deliveryMethod.required().messages({
    'any.required': 'Delivery method is required',
  }),
  courierDetails: Joi.object({
    courierName: Joi.string().max(100),
    trackingId: Joi.string().max(100),
    expectedDate: Joi.date(),
    deliveredDate: Joi.date(),
  }),
  items: Joi.array()
    .items(purchaseItemSchema)
    .min(1)
    .required()
    .messages({
      'array.min': 'At least one item is required',
      'any.required': 'Items are required',
    }),
  notes: Joi.string().max(500),
  idempotencyKey: Joi.string().uuid(),
});

export const updatePurchaseValidation = Joi.object({
  supplier: Joi.string().hex().length(24),
  purchaseDate: Joi.date().max('now'),
  invoiceNumber: Joi.string().max(50),
  purchaseOrderNumber: Joi.string().max(50),
  discount: Joi.number().min(0),
  tax: Joi.number().min(0),
  paymentStatus: paymentStatus,
  paymentMethod: paymentMethod,
  deliveryMethod: deliveryMethod,
  courierDetails: Joi.object({
    courierName: Joi.string().max(100),
    trackingId: Joi.string().max(100),
    expectedDate: Joi.date(),
    deliveredDate: Joi.date(),
  }),
  items: Joi.array().items(purchaseItemSchema).min(1),
  notes: Joi.string().max(500),
  status: Joi.string().valid('pending', 'processing', 'completed', 'cancelled'),
});

export const listPurchasesValidation = Joi.object({
  page: Joi.number().min(1).default(1),
  limit: Joi.number().min(1).max(100).default(20),
  supplier: Joi.string().hex().length(24),
  status: Joi.string().valid('pending', 'processing', 'completed', 'cancelled'),
  dateFrom: Joi.date(),
  dateTo: Joi.date().min(Joi.ref('dateFrom')),
  paymentStatus: paymentStatus,
  search: Joi.string().max(100),
  sortBy: Joi.string().valid('purchaseDate', 'createdAt', 'grandTotal'),
  sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
});

export const getPurchaseValidation = Joi.object({
  id: Joi.string().hex().length(24).required(),
});

export const deletePurchaseValidation = Joi.object({
  id: Joi.string().hex().length(24).required(),
});

export const uploadInvoiceValidation = Joi.object({
  id: Joi.string().hex().length(24).required(),
});

export const getInvoiceValidation = Joi.object({
  id: Joi.string().hex().length(24).required(),
});

export const completePurchaseValidation = Joi.object({
  id: Joi.string().hex().length(24).required(),
});