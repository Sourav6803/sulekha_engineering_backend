// src/middlewares/validate.js
import { ApiError } from '../utils/ApiError.js';

/**
 * Write validated data back onto the request.
 *
 * In Express 5, `req.query` and `req.params` are getter-only (no setter), so a
 * plain `req[key] = value` throws "Cannot set property query ... which has only
 * a getter". When a direct assignment fails, shadow the getter with an own
 * writable data property so downstream handlers still read the validated value.
 */
const setRequestProperty = (req, key, value) => {
  try {
    req[key] = value;
  } catch {
    Object.defineProperty(req, key, {
      value,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  }
};

/**
 * Validation middleware using Joi schemas
 */
export const validate = (schema, property = 'body') => {
  return (req, res, next) => {
    try {
      const { error, value } = schema.validate(req[property], {
        abortEarly: false,
        stripUnknown: true,
        allowUnknown: true,
      });

      if (error) {
        const details = {};
        error.details.forEach((err) => {
          const key = err.path.join('.');
          details[key] = err.message;
        });

        throw ApiError.validation('Validation failed', details);
      }

      // Replace request data with validated data
      setRequestProperty(req, property, value);
      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Validate query parameters
 */
export const validateQuery = (schema) => {
  return validate(schema, 'query');
};

/**
 * Validate request parameters (URL params)
 */
export const validateParams = (schema) => {
  return validate(schema, 'params');
};

/**
 * Validate request headers
 */
export const validateHeaders = (schema) => {
  return validate(schema, 'headers');
};

/**
 * Validate multiple parts of request
 */
export const validateAll = (schemas) => {
  return (req, res, next) => {
    try {
      const errors = {};

      // Validate body
      if (schemas.body) {
        const { error } = schemas.body.validate(req.body, {
          abortEarly: false,
          stripUnknown: true,
        });
        if (error) {
          error.details.forEach((err) => {
            const key = `body.${err.path.join('.')}`;
            errors[key] = err.message;
          });
        }
      }

      // Validate query
      if (schemas.query) {
        const { error } = schemas.query.validate(req.query, {
          abortEarly: false,
          stripUnknown: true,
        });
        if (error) {
          error.details.forEach((err) => {
            const key = `query.${err.path.join('.')}`;
            errors[key] = err.message;
          });
        }
      }

      // Validate params
      if (schemas.params) {
        const { error } = schemas.params.validate(req.params, {
          abortEarly: false,
          stripUnknown: true,
        });
        if (error) {
          error.details.forEach((err) => {
            const key = `params.${err.path.join('.')}`;
            errors[key] = err.message;
          });
        }
      }

      if (Object.keys(errors).length > 0) {
        throw ApiError.validation('Validation failed', errors);
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

export default validate;