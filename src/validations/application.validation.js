// src/validations/application.validation.js
import Joi from 'joi';
import {
  SITE_TYPE_VALUES,
  APPLICATION_STATUS_VALUES,
  DOCUMENT_KINDS,
} from '../data/applicationChecklist.js';

const objectId = Joi.string().regex(/^[0-9a-fA-F]{24}$/).message('{{#label}} must be a valid id');

/**
 * Aadhaar is typed by hand off a card, so spaces and dashes are normalised away
 * before the 12-digit rule is applied.
 */
const aadhaar = Joi.string()
  .trim()
  .custom((value, helpers) => {
    const digits = String(value).replace(/[^0-9]/g, '');
    if (digits.length !== 12) {
      return helpers.error('string.aadhaar');
    }
    return digits;
  })
  .messages({
    'string.aadhaar': 'Aadhaar number must be 12 digits',
  });

const phone = Joi.string()
  .trim()
  .pattern(/^(\+91[- ]?)?[0-9]{10}$/)
  .message('Please enter a valid 10-digit mobile number')
  .custom((value) => String(value).replace(/[^0-9]/g, '').slice(-10));

const pan = Joi.string()
  .trim()
  .uppercase()
  .pattern(/^[A-Z]{5}[0-9]{4}[A-Z]$/)
  .message('Please enter a valid PAN number (e.g. ABCDE1234F)');

const pincode = Joi.string()
  .trim()
  .pattern(/^[0-9]{6}$/)
  .message('Please enter a valid 6-digit pincode');

const addressSchema = Joi.object({
  street: Joi.string().trim().max(200).allow('', null),
  village: Joi.string().trim().max(100).allow('', null),
  block: Joi.string().trim().max(100).allow('', null),
  panchayat: Joi.string().trim().max(100).allow('', null),
  district: Joi.string().trim().max(100).allow('', null),
  city: Joi.string().trim().max(100).allow('', null),
  state: Joi.string().trim().max(100).allow('', null),
  pincode: pincode.allow('', null),
  landmark: Joi.string().trim().max(200).allow('', null),
  fullAddress: Joi.string().trim().max(500).allow('', null),
});

const loanSchema = Joi.object({
  asked: Joi.boolean(),
  // Explicitly nullable: "not asked yet" and "asked, no loan" are different
  // states and the submit check insists on one of them being recorded.
  hasExistingLoan: Joi.boolean().allow(null),
  lenderName: Joi.string().trim().max(200).allow('', null),
  loanAmount: Joi.number().min(0).max(100000000).allow(null),
  outstandingAmount: Joi.number().min(0).max(100000000).allow(null),
  monthlyEmi: Joi.number().min(0).max(10000000).allow(null),
  consumerInformed: Joi.boolean(),
  remark: Joi.string().trim().max(1000).allow('', null),
});

const dealSchema = Joi.object({
  systemSizeKW: Joi.number().min(0.1).max(1000).allow(null),
  proposalAmount: Joi.number().min(0).max(100000000).allow(null),
  quotedAmount: Joi.number().min(0).max(100000000).allow(null),
  intentionToProceed: Joi.string().valid('yes', 'no', 'undecided').allow(null),
});

const nameMatchSchema = Joi.object({
  consumerName: Joi.string().trim().max(150).allow('', null),
  aadhaarName: Joi.string().trim().max(150).allow('', null),
  passbookName: Joi.string().trim().max(150).allow('', null),
  electricBillName: Joi.string().trim().max(150).allow('', null),
});

/**
 * The credit answer — shape only. The server decides what it means.
 *
 * Deliberately permissive: this must never be able to reject an application, so
 * every field accepts an empty value and `assessCredit()` turns whatever arrives
 * into a notice. `status`, `headline`, `detail` and the audit fields are
 * server-owned and are dropped by `stripUnknown`.
 */
const creditCheckSchema = Joi.object({
  bank: Joi.string().trim().uppercase().max(40).allow('', null),
  method: Joi.string().valid('consumer_self_check', 'bank_portal', 'agent_estimate', 'other'),
  score: Joi.number().integer().min(0).max(900).allow(null, ''),
  defaultOrWriteOff: Joi.boolean(),
  newToCredit: Joi.boolean(),
  note: Joi.string().trim().max(500).allow('', null),
});

/**
 * The pre-check body: the same credit answer plus the project cost being judged,
 * because the ₹2 lakh line decides which of a lender's two rules applies.
 */
export const creditCheckPreviewSchema = creditCheckSchema.keys({
  amount: Joi.number().min(0).max(100000000).allow(null, ''),
});

// ==================== CREATE / UPDATE ====================

export const createApplicationSchema = Joi.object({
  // The agent is taken from the access token, never from the body, so an agent
  // cannot file an application in someone else's name.
  consumerName: Joi.string().trim().min(2).max(100).required(),
  phone: phone.required(),
  alternatePhone: phone.allow('', null),
  aadhaarNumber: aadhaar.allow('', null),
  panNumber: pan.allow('', null),
  email: Joi.string().trim().lowercase().email().max(150).allow('', null),

  address: addressSchema,
  siteType: Joi.string().valid(...SITE_TYPE_VALUES).allow(null),
  siteNotes: Joi.string().trim().max(1000).allow('', null),

  deal: dealSchema,
  loan: loanSchema,
  nameMatch: nameMatchSchema,
  creditCheck: creditCheckSchema,

  customer: objectId.allow(null),
});

export const updateApplicationSchema = Joi.object({
  consumerName: Joi.string().trim().min(2).max(100),
  phone,
  alternatePhone: phone.allow('', null),
  aadhaarNumber: aadhaar.allow('', null),
  panNumber: pan.allow('', null),
  email: Joi.string().trim().lowercase().email().max(150).allow('', null),

  address: addressSchema,
  siteType: Joi.string().valid(...SITE_TYPE_VALUES).allow(null),
  siteNotes: Joi.string().trim().max(1000).allow('', null),

  deal: dealSchema,
  loan: loanSchema,
  nameMatch: nameMatchSchema,
  creditCheck: creditCheckSchema,
}).min(1);

// ==================== ELECTRIC BILL ====================

export const electricBillSchema = Joi.object({
  consumerId: Joi.string().trim().uppercase().max(40).required().messages({
    'any.required': 'Consumer ID is required',
  }),
  installationNo: Joi.string().trim().uppercase().max(40).required().messages({
    'any.required': 'Installation ID is required',
  }),
});

export const verifyElectricBillSchema = Joi.object({
  verified: Joi.boolean().default(true),
  note: Joi.string().trim().max(1000).allow('', null),
});

// ==================== DOCUMENTS ====================

export const addDocumentSchema = Joi.object({
  kind: Joi.string().valid(...DOCUMENT_KINDS).required(),
  accountNumber: Joi.string().trim().max(40).allow('', null),
  ifsc: Joi.string()
    .trim()
    .uppercase()
    .pattern(/^[A-Z]{4}0[A-Z0-9]{6}$/)
    .message('Please enter a valid IFSC code (e.g. SBIN0001234)')
    .allow('', null),
  branchName: Joi.string().trim().max(150).allow('', null),
  accountType: Joi.string().valid('savings', 'current', 'cash_credit', 'other').allow('', null),
});

export const reviewDocumentSchema = Joi.object({
  status: Joi.string().valid('accepted', 'rejected').required(),
  reason: Joi.string().trim().max(1000).allow('', null).when('status', {
    is: 'rejected',
    then: Joi.string().trim().max(1000).required().messages({
      'any.required': 'Give a reason so the agent knows what to fix',
    }),
  }),
});

// ==================== WORKFLOW ====================

export const submitApplicationSchema = Joi.object({
  confirmNameMatch: Joi.boolean().default(false),
  note: Joi.string().trim().max(1000).allow('', null),
});

export const reviewApplicationSchema = Joi.object({
  status: Joi.string()
    .valid('under_review', 'correction_required', 'approved', 'rejected')
    .required(),
  remark: Joi.string().trim().max(2000).allow('', null),
  rejectionReason: Joi.string().trim().max(2000).allow('', null).when('status', {
    is: Joi.valid('correction_required', 'rejected'),
    then: Joi.string().trim().max(2000).required().messages({
      'any.required': 'A reason is required when sending an application back or rejecting it',
    }),
  }),
});

export const updateStatusSchema = Joi.object({
  status: Joi.string().valid(...APPLICATION_STATUS_VALUES).required(),
  note: Joi.string().trim().max(1000).allow('', null),
});

// ==================== QUERIES ====================

export const listApplicationsQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  status: Joi.string().valid(...APPLICATION_STATUS_VALUES),
  siteType: Joi.string().valid(...SITE_TYPE_VALUES),
  agent: objectId,
  search: Joi.string().trim().max(120).allow(''),
  district: Joi.string().trim().max(100),
  hasExistingLoan: Joi.boolean(),
  dateFrom: Joi.date().iso(),
  dateTo: Joi.date().iso(),
  sortBy: Joi.string().valid('createdAt', 'updatedAt', 'submittedAt', 'applicationNo', 'consumerName').default('createdAt'),
  sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
});

export const applicationIdParamSchema = Joi.object({
  id: objectId.required(),
});

export const documentParamSchema = Joi.object({
  id: objectId.required(),
  documentId: objectId.required(),
});

export default {
  createApplicationSchema,
  updateApplicationSchema,
  electricBillSchema,
  verifyElectricBillSchema,
  addDocumentSchema,
  reviewDocumentSchema,
  submitApplicationSchema,
  reviewApplicationSchema,
  updateStatusSchema,
  listApplicationsQuerySchema,
  applicationIdParamSchema,
  documentParamSchema,
};
