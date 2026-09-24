// src/validations/quotation.validation.js
import Joi from 'joi';

const objectId = Joi.string().hex().length(24);

const unit = Joi.string()
  .lowercase()
  .valid('nos', 'mtr', 'kg', 'lot', 'pair', 'bag', 'roll', 'box');

const structureType = Joi.string().valid('high_rise', 'tin_shed', 'rcc_rooftop', 'ground_mount');
const quotationStatus = Joi.string().valid('draft', 'sent', 'accepted', 'rejected', 'expired', 'converted');
const financialYear = Joi.string().pattern(/^\d{4}-\d{2}(\d{2})?$/);
const schemeCode = Joi.string().trim().uppercase().pattern(/^[A-Z0-9]{2,12}$/);
const attachmentKind = Joi.string().valid('original_manual', 'signed_copy', 'other');

/** Dates may be historical (back-fill), but not far in the future. */
const issueDate = Joi.date()
  .custom((value, helpers) => {
    const maxFuture = Date.now() + 30 * 24 * 60 * 60 * 1000;
    if (value.getTime() > maxFuture) return helpers.error('date.maxFuture');
    return value;
  })
  .messages({
    'date.maxFuture': 'Quotation date cannot be more than 30 days in the future',
    'date.base': 'Quotation date must be a valid date',
  });

const validUntil = Joi.date().messages({ 'date.base': 'Valid until must be a valid date' });

const itemSchema = Joi.object({
  description: Joi.string().trim().min(1).max(300).required().messages({
    'any.required': 'Each BOQ line needs a description',
    'string.empty': 'Each BOQ line needs a description',
  }),
  brandModel: Joi.string().trim().max(120).allow(''),
  qty: Joi.number().min(0.001).required().messages({
    'any.required': 'Each BOQ line needs a quantity',
    'number.min': 'BOQ quantity must be greater than 0',
  }),
  unit: unit.allow(null, ''),
  amount: Joi.number().min(0).allow(null),
  isOptional: Joi.boolean(),
  order: Joi.number().integer().min(0),
});

const shipToSchema = Joi.object({
  name: Joi.string().trim().max(120).allow(''),
  addressLines: Joi.array().items(Joi.string().trim().max(200)).max(4),
  phone: Joi.string().trim().max(20).allow(''),
});

/**
 * Shared body fields for create/update. `customerName` is intentionally not
 * required here: it may be filled from the linked customer. The service
 * enforces that one of the two is present.
 */
const quotationBodyFields = {
  customer: objectId.allow(null, ''),
  customerName: Joi.string().trim().min(2).max(120),
  consumerId: Joi.string().trim().max(20).allow(''),
  phoneNo: Joi.string().trim().max(20).allow(''),
  addressLine1: Joi.string().trim().max(200).allow(''),
  addressLine2: Joi.string().trim().max(200).allow(''),
  district: Joi.string().trim().max(80).allow(''),
  pincode: Joi.string().trim().max(10).allow(''),
  shipTo: shipToSchema,

  systemSizeKW: Joi.number().min(0.1).max(100).messages({
    'number.min': 'System size must be at least 0.1 kW',
    'number.max': 'System size cannot exceed 100 kW',
  }),
  panelWp: Joi.number().min(100).max(1000).allow(null),
  panelQty: Joi.number().integer().min(1).max(5000).allow(null),
  panelBrand: Joi.string().trim().max(120).allow(''),
  inverterCapacityKW: Joi.number().min(0.1).max(100).allow(null),
  inverterBrand: Joi.string().trim().max(120).allow(''),
  structureType,
  systemOverview: Joi.string().trim().max(600).allow(''),

  items: Joi.array().items(itemSchema).max(30),
  amount: Joi.number().min(0).allow(null),
  amountIncludesGST: Joi.boolean(),
  amountInWords: Joi.string().trim().max(300).allow(''),

  // 'terms' and 'paymentTerms' are deliberately not accepted from the client:
  // they are fixed company-wide (CompanyProfile) so every quotation states the
  // same thing. The service copies them onto the quotation at creation time.

  issueDate,
  validUntil,
  validityDays: Joi.number().integer().min(1).max(365),
  status: quotationStatus,
  notes: Joi.string().trim().max(1000).allow(''),

  schemeCode,
  schemeLabel: Joi.string().trim().max(160).allow(''),
};

/** validUntil may not precede issueDate — checked only when both are present. */
const assertDateOrder = (schema) =>
  schema.custom((value, helpers) => {
    if (value.validUntil && value.issueDate) {
      if (new Date(value.validUntil).getTime() < new Date(value.issueDate).getTime()) {
        return helpers.error('date.greater', { limit: 'the quotation date' });
      }
    }
    return value;
  });

export const createQuotationValidation = assertDateOrder(
  Joi.object({
    ...quotationBodyFields,
    customerName: quotationBodyFields.customerName,
    systemSizeKW: quotationBodyFields.systemSizeKW.required().messages({
      'any.required': 'System size (kW) is required',
      'number.min': 'System size must be at least 0.1 kW',
      'number.max': 'System size cannot exceed 100 kW',
    }),
  })
);

export const updateQuotationValidation = assertDateOrder(
  Joi.object({
    ...quotationBodyFields,
  }).min(1).messages({ 'object.min': 'Provide at least one field to update' })
);

export const listQuotationsValidation = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  financialYear,
  schemeCode,
  status: quotationStatus,
  customer: objectId,
  dateFrom: Joi.date(),
  dateTo: Joi.date(),
  search: Joi.string().trim().max(100),
  sortBy: Joi.string().valid('quotationSeq', 'issueDate', 'customerName', 'amount', 'createdAt', 'updatedAt', 'status'),
  sortOrder: Joi.string().valid('asc', 'desc'),
  includeDeleted: Joi.boolean(),
  onlyDeleted: Joi.boolean(),
  isHistorical: Joi.boolean(),
});

export const registerValidation = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(500).default(50),
  financialYear,
  schemeCode,
  search: Joi.string().trim().max(100),
  includeDeleted: Joi.boolean(),
  onlyDeleted: Joi.boolean(),
});

export const statsValidation = Joi.object({
  financialYear,
});

export const nextNumberValidation = Joi.object({
  schemeCode,
  issueDate: Joi.date(),
});

export const getQuotationValidation = Joi.object({
  id: objectId.required(),
});

export const deleteQuotationValidation = Joi.object({
  id: objectId.required(),
});

export const updateQuotationStatusValidation = Joi.object({
  status: quotationStatus.required().messages({ 'any.required': 'A status is required' }),
});

export const restoreQuotationValidation = Joi.object({
  assignNewNumber: Joi.boolean().default(false),
});

export const addAttachmentValidation = Joi.object({
  kind: attachmentKind.default('original_manual'),
});

export const attachmentParamsValidation = Joi.object({
  id: objectId.required(),
  attachmentId: objectId.required(),
});

// ---------------------------------------------------------------------------
// Import / back-fill
// ---------------------------------------------------------------------------

const registerRowSchema = Joi.object({
  slNo: Joi.number().integer().min(1).allow(null),
  quotationNo: Joi.string().trim().max(60),
  details: Joi.string().trim().max(120),
  date: Joi.alternatives().try(Joi.date(), Joi.string().trim().max(40)).allow(null, ''),
});

/**
 * dryRun defaults to TRUE on purpose: a register import refuses to write
 * anything unless the caller explicitly sends dryRun=false, so a first call can
 * never surprise anyone.
 */
export const importRegisterValidation = Joi.object({
  dryRun: Joi.boolean().default(true),
  useLegacy: Joi.boolean().default(false),
  source: Joi.string().trim().max(160),
  rows: Joi.array().items(registerRowSchema).max(2000),
});

export const importAttachmentsValidation = Joi.object({
  financialYear,
  minScore: Joi.number().min(0).max(1).default(0.5),
});

export const importConfirmValidation = Joi.object({
  attachments: Joi.array()
    .items(
      Joi.object({
        quotationId: objectId.required(),
        url: Joi.string().uri({ scheme: ['http', 'https'] }).max(1000).required(),
        publicId: Joi.string().trim().max(200).allow(null, ''),
        fileName: Joi.string().trim().max(200).allow(''),
        fileSize: Joi.number().integer().min(0).allow(null),
        mimeType: Joi.string().trim().max(100).allow(''),
        kind: attachmentKind,
      })
    )
    .min(1)
    .max(200)
    .required()
    .messages({ 'any.required': 'Provide the attachments to confirm', 'array.min': 'Provide at least one attachment' }),
});

export default {
  createQuotationValidation,
  importRegisterValidation,
  importAttachmentsValidation,
  importConfirmValidation,
  updateQuotationValidation,
  listQuotationsValidation,
  registerValidation,
  statsValidation,
  nextNumberValidation,
  getQuotationValidation,
  deleteQuotationValidation,
  updateQuotationStatusValidation,
  restoreQuotationValidation,
  addAttachmentValidation,
  attachmentParamsValidation,
};
