import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { createRequestLogger } from '../utils/logger';

interface LogContext {
  requestId: string;
  method: string;
  url: string;
  userAgent?: string;
  ip: string;
  timestamp: string;
  userId?: string;
}

interface ExtendedRequest extends Request {
  requestId?: string;
  startTime?: number;
  userId?: string;
  uid?: string;
  log?: ReturnType<typeof createRequestLogger>;
}

/**
 * Enhanced logging middleware with request tracking
 */
export const logRequest = (req: ExtendedRequest, res: Response, next: NextFunction): void => {
  // Generate unique request ID
  const requestId = uuidv4();
  req.requestId = requestId;
  req.startTime = Date.now();

  // Extract IP address (considering proxies)
  const ip = req.headers['x-forwarded-for'] as string || 
             req.headers['x-real-ip'] as string || 
             req.socket?.remoteAddress || 
             'unknown';

  // Create request-scoped logger with correlation ID
  req.log = createRequestLogger(requestId, req.method, req.url);

  const logContext: LogContext = {
    requestId,
    method: req.method,
    url: req.url,
    userAgent: req.headers['user-agent'],
    ip: Array.isArray(ip) ? ip[0] : ip,
    timestamp: new Date().toISOString(),
    userId: req.userId
  };

  // Log request start
  req.log.info({
    ip: logContext.ip,
    userAgent: logContext.userAgent,
  }, 'Request started');

  // Log request completion
  res.on('finish', () => {
    const duration = Date.now() - (req.startTime || 0);
    const {statusCode} = res;
    const contentLength = res.get('content-length') || 0;

    const responseContext = {
      statusCode,
      duration,
      contentLength: parseInt(contentLength.toString()) || 0,
      ip: logContext.ip,
    };

    // Log based on status code
    if (statusCode >= 500) {
      req.log!.error(responseContext, 'Request failed (server error)');
    } else if (statusCode >= 400) {
      req.log!.warn(responseContext, 'Request failed (client error)');
    } else {
      req.log!.info(responseContext, 'Request completed');
    }

    // Log slow requests (> 5 seconds)
    if (duration > 5000) {
      req.log!.warn({
        duration,
        threshold: 5000,
      }, 'Slow request detected');
    }
  });

  // Add request ID to response headers for debugging
  res.setHeader('X-Request-ID', requestId);

  next();
};

/**
 * Legacy compatibility middleware - simple time logging
 * @deprecated Use logRequest instead
 */
export const logTime = (req: ExtendedRequest, res: Response, next: NextFunction): void => {
  if (req.log) {
    req.log.debug('Request started');
  }
  next();
};

/**
 * Middleware to log API endpoint access
 */
export const logApiAccess = (req: ExtendedRequest, res: Response, next: NextFunction): void => {
  const url = req.originalUrl || req.url;
  const ip = req.ip || req.socket?.remoteAddress;
  const userAgent = req.headers['user-agent'];

  // Use request logger if available, otherwise create one
  const reqLogger = req.log || createRequestLogger(req.requestId || 'unknown', req.method, url);

  // Log API access
  reqLogger.info({
    ip,
    userAgent: userAgent?.substring(0, 100),
  }, 'API endpoint accessed');

  // Log request body for debugging (exclude sensitive data)
  if (process.env.NODE_ENV === 'development' && req.body) {
    const sanitizedBody = sanitizeRequestBody(req.body);
    reqLogger.debug({ body: sanitizedBody }, 'Request body');
  }

  next();
};

/**
 * Middleware to log errors
 */
export const logError = (
  error: any, 
  req: ExtendedRequest, 
  res: Response, 
  next: NextFunction
): void => {
  const requestId = req.requestId || 'unknown';
  const url = req.originalUrl || req.url;
  const ip = req.ip || req.socket?.remoteAddress;

  // Use request logger if available, otherwise create one
  const reqLogger = req.log || createRequestLogger(requestId, req.method, url);

  // Log error with full context
  if (error instanceof Error) {
    reqLogger.error({
      err: error,
      ip,
      statusCode: (error as any).statusCode,
    }, 'Request error');
  } else {
    reqLogger.error({
      ip,
      error: String(error),
      statusCode: error?.statusCode,
    }, 'Request error');
  }

  next(error);
};

/**
 * Middleware to log authentication events
 */
export const logAuth = (req: ExtendedRequest, res: Response, next: NextFunction): void => {
  const url = req.originalUrl || req.url;
  const ip = req.ip || req.socket?.remoteAddress;
  const userId = req.userId || req.uid || 'anonymous';

  // Use request logger if available, otherwise create one
  const reqLogger = req.log || createRequestLogger(req.requestId || 'unknown', req.method, url);

  reqLogger.info({
    userId,
    ip,
  }, 'Authentication event');

  next();
};

/**
 * Sanitize request body to remove sensitive information for logging
 */
function sanitizeRequestBody(body: any): any {
  if (!body || typeof body !== 'object') {
    return body;
  }

  const sensitiveFields = [
    'password', 
    'token', 
    'secret', 
    'key', 
    'auth', 
    'authorization',
    'otp',
    'pin',
    'ssn',
    'credit_card',
    'cvv'
  ];

  const sanitized = { ...body };

  Object.keys(sanitized).forEach(key => {
    const lowerKey = key.toLowerCase();
    if (sensitiveFields.some(field => lowerKey.includes(field))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
      sanitized[key] = sanitizeRequestBody(sanitized[key]);
    }
  });

  return sanitized;
}

/**
 * Create a structured log entry
 * @deprecated Use the logger from utils/logger.ts directly
 */
export const createLogEntry = (
  level: 'info' | 'warn' | 'error',
  message: string,
  context?: Record<string, any>
): void => {
  const { logger } = require('../utils/logger');
  logger[level](context, message);
};
