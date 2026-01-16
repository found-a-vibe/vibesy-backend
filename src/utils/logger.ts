import pino from 'pino';

/**
 * Centralized structured logger using Pino
 * 
 * Features:
 * - JSON structured logging in production
 * - Pretty-printed logs in development
 * - Request correlation IDs
 * - Automatic log levels based on environment
 * - Error serialization with stack traces
 */

const isDevelopment = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info'),
  
  // Use pretty-print transport in development for readability
  transport: isDevelopment ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
      singleLine: false,
    }
  } : undefined,
  
  // Base fields added to every log entry
  base: {
    env: process.env.NODE_ENV || 'development',
    service: 'vibesy-backend',
  },
  
  // Format timestamps as ISO strings
  timestamp: pino.stdTimeFunctions.isoTime,
  
  // Serialize errors with full stack traces
  serializers: {
    err: pino.stdSerializers.err,
    error: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
  },
  
  // Redact sensitive fields from logs
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      'token',
      'secret',
      'apiKey',
      'api_key',
      'stripe_secret_key',
      'sendgrid_api_key',
      '*.password',
      '*.token',
      '*.secret',
    ],
    censor: '[REDACTED]'
  },
});

/**
 * Create a child logger with request context (correlation ID)
 * Use this for request-scoped logging
 */
export function createRequestLogger(requestId: string, method?: string, url?: string) {
  return logger.child({ 
    requestId,
    ...(method && { method }),
    ...(url && { url })
  });
}

/**
 * Create a child logger with additional context
 */
export function createContextLogger(context: Record<string, any>) {
  return logger.child(context);
}

/**
 * Convenience logging functions with type safety
 */
export const log = {
  debug: (msg: string, context?: Record<string, any>) => logger.debug(context, msg),
  info: (msg: string, context?: Record<string, any>) => logger.info(context, msg),
  warn: (msg: string, context?: Record<string, any>) => logger.warn(context, msg),
  error: (msg: string, error?: Error | unknown, context?: Record<string, any>) => {
    if (error instanceof Error) {
      logger.error({ err: error, ...context }, msg);
    } else if (error) {
      logger.error({ error, ...context }, msg);
    } else {
      logger.error(context, msg);
    }
  },
  fatal: (msg: string, error?: Error | unknown, context?: Record<string, any>) => {
    if (error instanceof Error) {
      logger.fatal({ err: error, ...context }, msg);
    } else if (error) {
      logger.fatal({ error, ...context }, msg);
    } else {
      logger.fatal(context, msg);
    }
  },
};

export default logger;
