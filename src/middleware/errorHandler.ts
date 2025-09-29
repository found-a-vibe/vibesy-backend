import { Request, Response, NextFunction } from 'express';
import { ApiError, createErrorResponse } from '../utils/errors';

/**
 * Global error handling middleware
 */
export const errorHandler = (
  error: any,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // If response was already sent, delegate to default Express error handler
  if (res.headersSent) {
    return next(error);
  }

  const errorResponse = createErrorResponse(error);
  const statusCode = error instanceof ApiError ? error.statusCode : 500;

  // Log error details (but not in tests)
  if (process.env.NODE_ENV !== 'test') {
    console.error(`Error ${statusCode}: ${error.message || 'Unknown error'}`);
    
    // Log stack trace in development
    if (process.env.NODE_ENV === 'development' && error.stack) {
      console.error(error.stack);
    }
  }

  res.status(statusCode).json(errorResponse);
};

/**
 * 404 Not Found handler
 */
export const notFoundHandler = (req: Request, res: Response): void => {
  res.status(404).json({
    success: false,
    error: {
      status: 'Not Found',
      message: `Route ${req.method} ${req.originalUrl} not found`,
      statusCode: 404,
      timestamp: new Date().toISOString()
    }
  });
};

export default errorHandler;