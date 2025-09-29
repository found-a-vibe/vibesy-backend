export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly status: string;
  public readonly isOperational: boolean;
  public readonly timestamp: Date;

  constructor(
    statusCode: number,
    status: string,
    message: string,
    isOperational: boolean = true,
    stack?: string
  ) {
    super(message);
    
    this.statusCode = statusCode;
    this.status = status;
    this.isOperational = isOperational;
    this.timestamp = new Date();

    if (stack) {
      this.stack = stack;
    } else {
      Error.captureStackTrace(this, this.constructor);
    }

    // Set the prototype explicitly to maintain instanceof behavior
    Object.setPrototypeOf(this, ApiError.prototype);
  }

  toJSON() {
    return {
      status: this.status,
      message: this.message,
      statusCode: this.statusCode,
      timestamp: this.timestamp.toISOString(),
      ...(process.env.NODE_ENV === 'development' && { stack: this.stack })
    };
  }
}

export class ValidationError extends ApiError {
  constructor(message: string, field?: string) {
    const fullMessage = field ? `${field}: ${message}` : message;
    super(400, 'Validation Error', fullMessage);
  }
}

export class NotFoundError extends ApiError {
  constructor(resource: string = 'Resource') {
    super(404, 'Not Found', `${resource} not found`);
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message: string = 'Authentication required') {
    super(401, 'Unauthorized', message);
  }
}

export class ForbiddenError extends ApiError {
  constructor(message: string = 'Insufficient permissions') {
    super(403, 'Forbidden', message);
  }
}

export class ConflictError extends ApiError {
  constructor(message: string = 'Resource conflict') {
    super(409, 'Conflict', message);
  }
}

export class TooManyRequestsError extends ApiError {
  constructor(message: string = 'Too many requests') {
    super(429, 'Too Many Requests', message);
  }
}

export class InternalServerError extends ApiError {
  constructor(message: string = 'Internal server error') {
    super(500, 'Internal Server Error', message);
  }
}

export class ServiceUnavailableError extends ApiError {
  constructor(message: string = 'Service temporarily unavailable') {
    super(503, 'Service Unavailable', message);
  }
}

/**
 * Check if an error is an operational error
 */
export const isOperationalError = (error: Error): boolean => {
  if (error instanceof ApiError) {
    return error.isOperational;
  }
  return false;
};

/**
 * Create a standardized error response
 */
export const createErrorResponse = (error: any) => {
  if (error instanceof ApiError) {
    return {
      success: false,
      error: {
        status: error.status,
        message: error.message,
        statusCode: error.statusCode,
        timestamp: error.timestamp.toISOString()
      }
    };
  }

  // Handle unknown errors
  return {
    success: false,
    error: {
      status: 'Internal Server Error',
      message: process.env.NODE_ENV === 'production' 
        ? 'An unexpected error occurred' 
        : error.message || 'Unknown error',
      statusCode: 500,
      timestamp: new Date().toISOString()
    }
  };
};

/**
 * Error codes enum for consistent error handling
 */
export enum ErrorCodes {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  AUTHENTICATION_FAILED = 'AUTHENTICATION_FAILED',
  AUTHORIZATION_FAILED = 'AUTHORIZATION_FAILED',
  RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',
  RESOURCE_CONFLICT = 'RESOURCE_CONFLICT',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  EXTERNAL_API_ERROR = 'EXTERNAL_API_ERROR',
  DATABASE_ERROR = 'DATABASE_ERROR',
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE'
}

/**
 * Map HTTP status codes to error types
 */
export const getErrorTypeFromStatusCode = (statusCode: number): string => {
  switch (statusCode) {
    case 400:
      return ErrorCodes.VALIDATION_ERROR;
    case 401:
      return ErrorCodes.AUTHENTICATION_FAILED;
    case 403:
      return ErrorCodes.AUTHORIZATION_FAILED;
    case 404:
      return ErrorCodes.RESOURCE_NOT_FOUND;
    case 409:
      return ErrorCodes.RESOURCE_CONFLICT;
    case 429:
      return ErrorCodes.RATE_LIMIT_EXCEEDED;
    case 500:
      return ErrorCodes.INTERNAL_SERVER_ERROR;
    case 503:
      return ErrorCodes.SERVICE_UNAVAILABLE;
    default:
      return ErrorCodes.INTERNAL_SERVER_ERROR;
  }
};

/**
 * Sanitize error for logging (remove sensitive information)
 */
export const sanitizeError = (error: any) => {
  const sanitized = {
    name: error.name || 'Error',
    message: error.message || 'Unknown error',
    statusCode: error.statusCode || 500,
    status: error.status || 'Internal Server Error',
    timestamp: error.timestamp || new Date().toISOString()
  };

  // Add stack trace only in development
  if (process.env.NODE_ENV === 'development' && error.stack) {
    (sanitized as any).stack = error.stack;
  }

  return sanitized;
};