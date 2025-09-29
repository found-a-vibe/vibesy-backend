import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

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
  console.log(`[${logContext.timestamp}] ${logContext.method} ${logContext.url} - Request ID: ${requestId}`);

  // Log request completion
  res.on('finish', () => {
    const duration = Date.now() - (req.startTime || 0);
    const {statusCode} = res;
    const contentLength = res.get('content-length') || 0;

    console.log(
      `[${new Date().toISOString()}] ${logContext.method} ${logContext.url} - ` +
      `${statusCode} ${res.statusMessage} - ${duration}ms - ${contentLength} bytes - ` +
      `Request ID: ${requestId}`
    );

    // Log errors (4xx and 5xx status codes)
    if (statusCode >= 400) {
      console.error(
        `[ERROR] Request ${requestId} failed with status ${statusCode} - ` +
        `${logContext.method} ${logContext.url} - IP: ${logContext.ip} - ` +
        `Duration: ${duration}ms`
      );
    }

    // Log slow requests (> 5 seconds)
    if (duration > 5000) {
      console.warn(
        `[SLOW REQUEST] Request ${requestId} took ${duration}ms - ` +
        `${logContext.method} ${logContext.url}`
      );
    }
  });

  // Add request ID to response headers for debugging
  res.setHeader('X-Request-ID', requestId);

  next();
};

/**
 * Legacy compatibility middleware - simple time logging
 */
export const logTime = (req: Request, res: Response, next: NextFunction): void => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} - Started`);
  next();
};

/**
 * Middleware to log API endpoint access
 */
export const logApiAccess = (req: ExtendedRequest, res: Response, next: NextFunction): void => {
  const timestamp = new Date().toISOString();
  const {method} = req;
  const url = req.originalUrl || req.url;
  const ip = req.ip || req.socket?.remoteAddress;
  const userAgent = req.headers['user-agent'];

  // Log API access
  console.log(
    `[API ACCESS] ${timestamp} - ${method} ${url} - ` +
    `IP: ${ip} - User-Agent: ${userAgent?.substring(0, 100)}...`
  );

  // Log request body for debugging (exclude sensitive data)
  if (process.env.NODE_ENV === 'development' && req.body) {
    const sanitizedBody = sanitizeRequestBody(req.body);
    console.log(`[REQUEST BODY] ${JSON.stringify(sanitizedBody, null, 2)}`);
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
  const timestamp = new Date().toISOString();
  const requestId = req.requestId || 'unknown';
  const {method} = req;
  const url = req.originalUrl || req.url;
  const ip = req.ip || req.socket?.remoteAddress;

  console.error(
    `[ERROR] ${timestamp} - Request ID: ${requestId} - ` +
    `${method} ${url} - IP: ${ip} - ` +
    `Error: ${error.message || error}`
  );

  // Log stack trace in development
  if (process.env.NODE_ENV === 'development' && error.stack) {
    console.error(`[ERROR STACK] ${error.stack}`);
  }

  next(error);
};

/**
 * Middleware to log authentication events
 */
export const logAuth = (req: ExtendedRequest, res: Response, next: NextFunction): void => {
  const timestamp = new Date().toISOString();
  const {method} = req;
  const url = req.originalUrl || req.url;
  const ip = req.ip || req.socket?.remoteAddress;
  const userId = req.userId || req.uid || 'anonymous';

  console.log(
    `[AUTH] ${timestamp} - ${method} ${url} - ` +
    `User ID: ${userId} - IP: ${ip}`
  );

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
 */
export const createLogEntry = (
  level: 'info' | 'warn' | 'error',
  message: string,
  context?: Record<string, any>
): void => {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level: level.toUpperCase(),
    message,
    ...context
  };

  const logMessage = `[${logEntry.level}] ${timestamp} - ${message}`;
  
  if (context && Object.keys(context).length > 0) {
    console.log(`${logMessage} - Context: ${JSON.stringify(context)}`);
  } else {
    console.log(logMessage);
  }
};