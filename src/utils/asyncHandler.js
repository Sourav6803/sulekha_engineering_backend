// src/utils/asyncHandler.js
import logger from './logger.js';

/**
 * Wrapper for async route handlers
 * Eliminates try-catch boilerplate
 */
export const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch((error) => {
      // Log the error
      logger.error('Async handler error:', {
        message: error.message,
        stack: error.stack,
        path: req.path,
        method: req.method,
        ip: req.ip,
      });
      next(error);
    });
  };
};

/**
 * Wrapper for async middleware
 */
export const asyncMiddleware = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * Wrapper for async service methods
 */
export const asyncService = (fn) => {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      logger.error('Service error:', {
        message: error.message,
        stack: error.stack,
        service: fn.name || 'unknown',
      });
      throw error;
    }
  };
};

export default asyncHandler;