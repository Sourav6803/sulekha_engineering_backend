// src/utils/ApiError.js
/**
 * Custom API Error class
 */
export class ApiError extends Error {
  constructor(statusCode, message, code = null, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code || this.getDefaultCode(statusCode);
    this.details = details;
    this.isOperational = true;
    
    // Capture stack trace
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Get default error code based on status code
   */
  getDefaultCode(statusCode) {
    const codes = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      422: 'UNPROCESSABLE_ENTITY',
      429: 'RATE_LIMIT_EXCEEDED',
      500: 'INTERNAL_ERROR',
      502: 'BAD_GATEWAY',
      503: 'SERVICE_UNAVAILABLE',
    };
    return codes[statusCode] || 'UNKNOWN_ERROR';
  }

  /**
   * Create a Bad Request error (400)
   */
  static badRequest(message, details = null) {
    return new ApiError(400, message, 'BAD_REQUEST', details);
  }

  /**
   * Create an Unauthorized error (401)
   */
  static unauthorized(message = 'Unauthorized') {
    return new ApiError(401, message, 'UNAUTHORIZED');
  }

  /**
   * Create a Forbidden error (403)
   */
  static forbidden(message = 'Forbidden') {
    return new ApiError(403, message, 'FORBIDDEN');
  }

  /**
   * Create a Not Found error (404)
   */
  static notFound(resource = 'Resource') {
    return new ApiError(404, `${resource} not found`, 'NOT_FOUND');
  }

  /**
   * Create a Conflict error (409)
   */
  static conflict(message, details = null) {
    return new ApiError(409, message, 'CONFLICT', details);
  }

  /**
   * Create a Validation error (422)
   */
  static validation(message, details = null) {
    return new ApiError(422, message, 'VALIDATION_ERROR', details);
  }

  /**
   * Create an Internal Server Error (500)
   */
  static internal(message = 'Internal server error') {
    return new ApiError(500, message, 'INTERNAL_ERROR');
  }
}