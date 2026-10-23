// src/validations/lead.validation.js
import Joi from 'joi';
import { LEAD_SOURCES, LEAD_STATUSES } from '../models/Lead.js';

/**
 * Enquiries.
 *
 * The public schema is deliberately small: name and phone are the only things the
 * company needs to call someone back, everything else is optional, and the fields
 * the office owns — status, notes, assignee — are simply not accepted from the
 * outside (the middleware strips what is not declared here).
 */

const objectId = Joi.string().hex().length(24);

const utm = Joi.object({
  source: Joi.string().trim().max(80).allow('', null),
  medium: Joi.string().trim().max(80).allow('', null),
  campaign: Joi.string().trim().max(80).allow('', null),
  content: Joi.string().trim().max(80).allow('', null),
  term: Joi.string().trim().max(80).allow('', null),
});

export const createLeadValidation = Joi.object({
  name: Joi.string().trim().min(2).max(80).required(),
  phone: Joi.string().trim().pattern(/^[0-9]{10}$/).required().messages({
    'string.pattern.base': 'Enter a 10-digit mobile number',
    'any.required': 'Mobile number is required',
  }),
  email: Joi.string().trim().lowercase().email({ tlds: false }).max(120).allow('', null),
  district: Joi.string().trim().max(60).allow('', null),
  state: Joi.string().trim().max(60).allow('', null),
  systemSizeKW: Joi.number().min(0).max(1000).allow(null),
  message: Joi.string().trim().max(1000).allow('', null),
  source: Joi.string().valid(...LEAD_SOURCES),
  utm,
  pagePath: Joi.string().trim().max(200).allow('', null),

  /**
   * Honeypot. The form renders this field hidden; a person never fills it, so
   * anything arriving here is a bot and the request is refused. Declared rather
   * than ignored because `stripUnknown` would otherwise remove it and the check
   * would silently disappear.
   */
  website: Joi.string().max(0).allow('', null),
});

export const listLeadsValidation = Joi.object({
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
  status: Joi.string().valid(...LEAD_STATUSES),
  source: Joi.string().valid(...LEAD_SOURCES),
  district: Joi.string().trim().max(60),
  search: Joi.string().trim().max(80),
  assignedTo: objectId,
  from: Joi.date().iso(),
  to: Joi.date().iso(),
});

export const updateStatusValidation = Joi.object({
  status: Joi.string().valid(...LEAD_STATUSES).required(),
});

export const noteValidation = Joi.object({
  text: Joi.string().trim().min(1).max(500).required(),
});

export const assignValidation = Joi.object({
  userId: objectId.allow(null),
});

export const idParamValidation = Joi.object({ id: objectId.required() });
