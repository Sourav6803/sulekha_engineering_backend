// src/validations/agreement.validation.js
import Joi from 'joi';

const objectId = Joi.string().hex().length(24);

/** Today or a past date for a back-fill; a little slack for a future signing. */
const agreementDate = Joi.date().custom((value, helpers) => {
  if (value.getTime() > Date.now() + 30 * 24 * 60 * 60 * 1000) {
    return helpers.error('date.max');
  }
  return value;
});

const consumerName = Joi.string().trim().min(2).max(120);
const consumerId = Joi.string().trim().pattern(/^[0-9]{5,20}$/).allow('', null);
const relationLine = Joi.string().trim().max(80).allow('', null);
const address = Joi.string().trim().min(5).max(400);
const discom = Joi.string().trim().uppercase().max(40).allow('', null);
const amount = Joi.number().min(0).max(100000000);
const notes = Joi.string().trim().max(1000).allow('', null);

/**
 * consumerName / address / amount are NOT required here on purpose: when a
 * quotation is linked they are prefilled from it, and the service then enforces
 * that they are present. Requiring them in Joi would block that prefill path.
 */
export const createAgreementValidation = Joi.object({
  consumerName,
  consumerId,
  relationLine,
  address,
  discom,
  agreementDate,
  amount,
  /** Optional link; when present the consumer details and amount are prefilled. */
  quotation: objectId.allow(null, ''),
  notes,
}).messages({
  'date.max': 'Agreement date cannot be more than 30 days in the future',
});

export const updateAgreementValidation = Joi.object({
  consumerName,
  consumerId,
  relationLine,
  address,
  discom,
  agreementDate,
  amount,
  quotation: objectId.allow(null, ''),
  notes,
})
  .min(1)
  .messages({
    'object.min': 'Provide at least one field to update',
    'date.max': 'Agreement date cannot be more than 30 days in the future',
  });

export const listAgreementsValidation = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  search: Joi.string().trim().max(100).allow(''),
  dateFrom: Joi.date(),
  dateTo: Joi.date(),
  includeDeleted: Joi.boolean().default(false),
  sortBy: Joi.string().valid('agreementDate', 'createdAt', 'updatedAt', 'consumerName', 'amount'),
  sortOrder: Joi.string().lowercase().valid('asc', 'desc').default('desc'),
});

export const agreementIdValidation = Joi.object({
  id: objectId.required(),
});

export default {
  createAgreementValidation,
  updateAgreementValidation,
  listAgreementsValidation,
  agreementIdValidation,
};
