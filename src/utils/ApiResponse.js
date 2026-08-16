// src/utils/ApiResponse.js
/**
 * Standard API Response formatter
 */
export class ApiResponse {
  /**
   * Create a success response
   */
  static success(data, message = 'Success', statusCode = 200) {
    return {
      success: true,
      statusCode,
      message,
      data,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Create a success response with pagination
   */
  static paginated(data, pagination, message = 'Success') {
    return {
      success: true,
      message,
      data,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total: pagination.total,
        pages: pagination.pages,
      },
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Create an error response
   */
  static error(error, statusCode = 500) {
    const response = {
      success: false,
      statusCode,
      error: {
        code: error.code || 'INTERNAL_ERROR',
        message: error.message || 'An error occurred',
      },
      timestamp: new Date().toISOString(),
    };

    // Add validation details if available
    if (error.details) {
      response.error.details = error.details;
    }

    // Add stack trace in development
    if (process.env.NODE_ENV === 'development' && error.stack) {
      response.error.stack = error.stack;
    }

    return response;
  }

  /**
   * Create a created response (201)
   */
  static created(data, message = 'Resource created successfully') {
    return this.success(data, message, 201);
  }

  /**
   * Create a no content response (204)
   */
  static noContent() {
    return {
      success: true,
      statusCode: 204,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Send success response
   */
  static send(res, data, message = 'Success', statusCode = 200) {
    return res.status(statusCode).json(this.success(data, message, statusCode));
  }

  /**
   * Send paginated response
   */
  static sendPaginated(res, data, pagination, message = 'Success') {
    return res.status(200).json(this.paginated(data, pagination, message));
  }

  /**
   * Send error response
   */
  static sendError(res, error, statusCode = 500) {
    return res.status(statusCode).json(this.error(error, statusCode));
  }

  /**
   * Send created response
   */
  static sendCreated(res, data, message = 'Resource created successfully') {
    return res.status(201).json(this.created(data, message));
  }

  /**
   * Send no content response
   */
  static sendNoContent(res) {
    return res.status(204).json(this.noContent());
  }
}