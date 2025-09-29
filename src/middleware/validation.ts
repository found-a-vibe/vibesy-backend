import { Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';
import { ApiError } from '../utils/errors';

/**
 * Express-validator middleware to handle validation errors
 */
export const validateRequest = (req: Request, res: Response, next: NextFunction): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const errorMessages = errors.array().map(error => error.msg).join(', ');
    return next(new ApiError(400, 'Validation Error', errorMessages));
  }
  next();
};

/**
 * Validate email format and presence
 */
export const validateEmail = (req: Request, res: Response, next: NextFunction): void => {
  const { email } = req.body;

  if (!email) {
    return next(new ApiError(400, 'Validation Error', 'Email is required'));
  }

  if (typeof email !== 'string') {
    return next(new ApiError(400, 'Validation Error', 'Email must be a string'));
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email.trim())) {
    return next(new ApiError(400, 'Validation Error', 'Invalid email format'));
  }

  // Normalize email (trim and lowercase)
  req.body.email = email.trim().toLowerCase();
  next();
};

/**
 * Validate OTP request
 */
export const validateOTP = (req: Request, res: Response, next: NextFunction): void => {
  const { email, otp } = req.body;

  if (!email) {
    return next(new ApiError(400, 'Validation Error', 'Email is required'));
  }

  if (!otp) {
    return next(new ApiError(400, 'Validation Error', 'OTP is required'));
  }

  if (typeof otp !== 'string' && typeof otp !== 'number') {
    return next(new ApiError(400, 'Validation Error', 'OTP must be a string or number'));
  }

  // Normalize OTP (convert to string and remove spaces)
  const normalizedOTP = otp.toString().replace(/\s/g, '');
  
  if (!/^\d{4,8}$/.test(normalizedOTP)) {
    return next(new ApiError(400, 'Validation Error', 'OTP must be 4-8 digits'));
  }

  req.body.otp = normalizedOTP;
  req.body.email = email.trim().toLowerCase();
  next();
};

/**
 * Validate password reset request
 */
export const validatePasswordReset = (req: Request, res: Response, next: NextFunction): void => {
  const { uid, password } = req.body;

  if (!uid) {
    return next(new ApiError(400, 'Validation Error', 'User ID is required'));
  }

  if (!password) {
    return next(new ApiError(400, 'Validation Error', 'Password is required'));
  }

  if (typeof uid !== 'string') {
    return next(new ApiError(400, 'Validation Error', 'User ID must be a string'));
  }

  if (typeof password !== 'string') {
    return next(new ApiError(400, 'Validation Error', 'Password must be a string'));
  }

  // Password strength validation
  if (password.length < 8) {
    return next(new ApiError(400, 'Validation Error', 'Password must be at least 8 characters long'));
  }

  if (password.length > 128) {
    return next(new ApiError(400, 'Validation Error', 'Password must be less than 128 characters'));
  }

  // Check for at least one uppercase, lowercase, number, and special character
  const hasUppercase = /[A-Z]/.test(password);
  const hasLowercase = /[a-z]/.test(password);
  const hasNumbers = /\d/.test(password);
  const hasSpecialChar = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);

  if (!hasUppercase || !hasLowercase || !hasNumbers || !hasSpecialChar) {
    return next(new ApiError(400, 'Validation Error', 
      'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'));
  }

  next();
};

/**
 * Validate notification request
 */
export const validateNotificationRequest = (req: Request, res: Response, next: NextFunction): void => {
  const { title, body, toUserId, fromUserId } = req.body;

  if (!title) {
    return next(new ApiError(400, 'Validation Error', 'Notification title is required'));
  }

  if (!body) {
    return next(new ApiError(400, 'Validation Error', 'Notification body is required'));
  }

  if (!toUserId) {
    return next(new ApiError(400, 'Validation Error', 'Recipient user ID is required'));
  }

  if (!fromUserId) {
    return next(new ApiError(400, 'Validation Error', 'Sender user ID is required'));
  }

  // Validate string types
  if (typeof title !== 'string') {
    return next(new ApiError(400, 'Validation Error', 'Title must be a string'));
  }

  if (typeof body !== 'string') {
    return next(new ApiError(400, 'Validation Error', 'Body must be a string'));
  }

  if (typeof toUserId !== 'string') {
    return next(new ApiError(400, 'Validation Error', 'Recipient user ID must be a string'));
  }

  if (typeof fromUserId !== 'string') {
    return next(new ApiError(400, 'Validation Error', 'Sender user ID must be a string'));
  }

  // Validate lengths
  if (title.length > 100) {
    return next(new ApiError(400, 'Validation Error', 'Title must be 100 characters or less'));
  }

  if (body.length > 500) {
    return next(new ApiError(400, 'Validation Error', 'Body must be 500 characters or less'));
  }

  // Sanitize strings
  req.body.title = title.trim();
  req.body.body = body.trim();

  next();
};

/**
 * Validate pagination parameters
 */
export const validatePagination = (req: Request, res: Response, next: NextFunction): void => {
  const { page, limit, offset } = req.query;

  if (page !== undefined) {
    const pageNum = parseInt(page as string, 10);
    if (isNaN(pageNum) || pageNum < 1) {
      return next(new ApiError(400, 'Validation Error', 'Page must be a positive integer'));
    }
    if (pageNum > 10000) {
      return next(new ApiError(400, 'Validation Error', 'Page number too large'));
    }
    req.query.page = pageNum.toString();
  }

  if (limit !== undefined) {
    const limitNum = parseInt(limit as string, 10);
    if (isNaN(limitNum) || limitNum < 1) {
      return next(new ApiError(400, 'Validation Error', 'Limit must be a positive integer'));
    }
    if (limitNum > 1000) {
      return next(new ApiError(400, 'Validation Error', 'Limit cannot exceed 1000'));
    }
    req.query.limit = limitNum.toString();
  }

  if (offset !== undefined) {
    const offsetNum = parseInt(offset as string, 10);
    if (isNaN(offsetNum) || offsetNum < 0) {
      return next(new ApiError(400, 'Validation Error', 'Offset must be a non-negative integer'));
    }
    req.query.offset = offsetNum.toString();
  }

  next();
};

/**
 * Validate required fields in request body
 */
export const validateRequiredFields = (fields: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const missingFields: string[] = [];

    fields.forEach(field => {
      if (!req.body[field]) {
        missingFields.push(field);
      }
    });

    if (missingFields.length > 0) {
      return next(new ApiError(400, 'Validation Error', 
        `Missing required fields: ${missingFields.join(', ')}`));
    }

    next();
  };
};

/**
 * Validate UUID format
 */
export const validateUUID = (paramName: string) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const value = req.params[paramName] || req.body[paramName] || req.query[paramName];
    
    if (!value) {
      return next(new ApiError(400, 'Validation Error', `${paramName} is required`));
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    
    if (!uuidRegex.test(value)) {
      return next(new ApiError(400, 'Validation Error', `Invalid ${paramName} format`));
    }

    next();
  };
};

/**
 * Sanitize HTML content to prevent XSS
 */
export const sanitizeHtml = (fields: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    fields.forEach(field => {
      if (req.body[field] && typeof req.body[field] === 'string') {
        // Basic HTML sanitization - remove script tags and dangerous attributes
        req.body[field] = req.body[field]
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
          .replace(/javascript:/gi, '')
          .replace(/on\w+="[^"]*"/gi, '')
          .replace(/on\w+='[^']*'/gi, '');
      }
    });

    next();
  };
};

/**
 * Rate limiting validation (basic implementation)
 */
export const validateRateLimit = (maxRequests: number, windowMs: number) => {
  const requestCounts = new Map<string, { count: number; resetTime: number }>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    const windowStart = now - windowMs;

    // Clean up old entries
    for (const [key, value] of requestCounts.entries()) {
      if (value.resetTime <= now) {
        requestCounts.delete(key);
      }
    }

    const clientData = requestCounts.get(ip) || { count: 0, resetTime: now + windowMs };

    if (clientData.resetTime <= now) {
      // Reset window
      clientData.count = 1;
      clientData.resetTime = now + windowMs;
    } else {
      clientData.count++;
    }

    if (clientData.count > maxRequests) {
      return next(new ApiError(429, 'Too Many Requests', 
        `Rate limit exceeded. Try again in ${Math.ceil((clientData.resetTime - now) / 1000)} seconds`));
    }

    requestCounts.set(ip, clientData);
    next();
  };
};