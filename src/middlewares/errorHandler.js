// src/middlewares/errorHandler.js
import { ApiError } from '../utils/ApiError.js';
import logger from '../utils/logger.js';
import config from '../config/env.js';

/**
 * Format error response
 */
const formatErrorResponse = (error, isDevelopment = false) => {
  const response = {
    success: false,
    error: {
      code: error.code || 'INTERNAL_ERROR',
      message: error.message || 'An unexpected error occurred',
    },
  };

  // Add validation details if available
  if (error.details) {
    response.error.details = error.details;
  }

  // Add stack trace in development
  if (isDevelopment && error.stack) {
    response.error.stack = error.stack;
  }

  return response;
};

/**
 * Centralized error handler middleware
 */
export const errorHandler = (err, req, res, next) => {
  // Default error values
  let statusCode = err.statusCode || 500;
  let error = err;

  // Log the error
  const errorLog = {
    message: err.message,
    stack: err.stack,
    statusCode: statusCode,
    path: req.path,
    method: req.method,
    ip: req.ip,
    userId: req.userId || 'anonymous',
  };

  logger.error('Error:', errorLog);

  // ============================================
  // HANDLE SPECIFIC ERROR TYPES
  // ============================================

  // MongoDB Validation Error
  if (err.name === 'ValidationError') {
    statusCode = 400;
    const details = {};
    Object.keys(err.errors).forEach((key) => {
      details[key] = err.errors[key].message;
    });
    error = new ApiError(400, 'Validation failed', 'VALIDATION_ERROR', details);
  }

  // MongoDB Duplicate Key Error
  if (err.code === 11000) {
    statusCode = 409;
    const field = Object.keys(err.keyPattern)[0];
    const value = err.keyValue[field];
    error = new ApiError(
      409,
      `Duplicate value for ${field}: ${value}`,
      'DUPLICATE_ENTRY',
      { field, value }
    );
  }

  // Cast Error (Invalid ObjectId)
  if (err.name === 'CastError') {
    statusCode = 400;
    error = new ApiError(
      400,
      `Invalid ${err.path}: ${err.value}`,
      'INVALID_ID'
    );
  }

  // JWT Error
  if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    error = new ApiError(401, 'Invalid token', 'INVALID_TOKEN');
  }

  // Token Expired Error
  if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    error = new ApiError(401, 'Token expired', 'TOKEN_EXPIRED');
  }

  // Multer File Upload Error
  if (err.code === 'LIMIT_FILE_SIZE') {
    statusCode = 400;
    error = new ApiError(400, 'File too large', 'FILE_TOO_LARGE');
  }

  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    statusCode = 400;
    error = new ApiError(400, 'Unexpected file field', 'INVALID_FILE');
  }

  // ============================================
  // SEND RESPONSE
  // ============================================

  const isDevelopment = config.NODE_ENV === 'development';
  const response = formatErrorResponse(error, isDevelopment);

  res.status(statusCode).json(response);
};

/**
 * Async handler to avoid try-catch boilerplate
 */
export const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};