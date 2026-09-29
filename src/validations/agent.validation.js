// src/validations/agent.validation.js
import Joi from 'joi';

const objectId = Joi.string().regex(/^[0-9a-fA-F]{24}$/).message('{{#label}} must be a valid id');

const phone = Joi.string()
  .trim()
  .pattern(/^[0-9]{10}$/)
  .message('Please enter a valid 10-digit mobile number')
  .allow('', null);

/**
 * Create an agent.
 *
 * `password` is accepted only so an admin can supply one for a special case; in
 * normal use it is omitted and the office generates a strong temporary password
 * (see generateTemporaryPassword). `role` is deliberately absent — this endpoint
 * creates agents and nothing else, so it cannot be used to mint an admin.
 */
export const createAgentSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).required().messages({
    'any.required': 'Agent name is required',
  }),
  email: Joi.string().trim().lowercase().email().max(150).required().messages({
    'any.required': 'Email is required — the welcome mail and the login both use it',
  }),
  phone,
  employeeId: Joi.string().trim().max(40).allow('', null),
  department: Joi.string()
    .valid('administration', 'warehouse', 'installation', 'sales', 'management')
    .default('sales'),
  password: Joi.string().min(8).max(128).pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/).messages({
    'string.min': 'Password must be at least 8 characters',
    'string.pattern.base':
      'Password must contain at least one uppercase letter, one lowercase letter, and one number',
  }),
});

export const updateAgentSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100),
  phone,
  employeeId: Joi.string().trim().max(40).allow('', null),
  department: Joi.string().valid(
    'administration',
    'warehouse',
    'installation',
    'sales',
    'management'
  ),
  status: Joi.string().valid('active', 'inactive', 'suspended', 'blocked'),
}).min(1);

export const listAgentsQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  status: Joi.string().valid('active', 'inactive', 'suspended', 'blocked'),
  search: Joi.string().trim().max(120).allow(''),
  sortBy: Joi.string().valid('createdAt', 'updatedAt', 'name', 'lastLogin', 'email').default('createdAt'),
  sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
});

export const agentIdParamSchema = Joi.object({
  id: objectId.required(),
});

export default {
  createAgentSchema,
  updateAgentSchema,
  listAgentsQuerySchema,
  agentIdParamSchema,
};
