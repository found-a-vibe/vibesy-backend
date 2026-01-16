import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { ApiError } from '../utils/errors';

/**
 * Middleware factory to validate request data against a Joi schema
 */
export const validateSchema = (schema: Joi.ObjectSchema, property: 'body' | 'query' | 'params' = 'body') => {
  return (req: Request, res: Response, next: NextFunction): void => {
    console.log(`Validating ${property}:`, JSON.stringify(req[property], null, 2));
    
    const { error, value } = schema.validate(req[property], {
      abortEarly: false, // Report all validation errors
      stripUnknown: true, // Remove unknown keys
    });

    if (error) {
      const errorMessage = error.details.map(detail => detail.message).join(', ');
      console.error(`Validation failed for ${property}:`, errorMessage);
      console.error('Failed fields:', error.details.map(d => d.path.join('.')));
      return next(new ApiError(400, 'Validation Error', errorMessage));
    }

    // Replace request data with validated/sanitized values
    req[property] = value;
    next();
  };
};

/**
 * Payment Intent Schema
 */
export const paymentIntentSchema = Joi.object({
  event_id: Joi.number().integer().positive().required()
    .messages({
      'number.base': 'Event ID must be a number',
      'number.positive': 'Event ID must be positive',
      'any.required': 'Event ID is required'
    }),
  quantity: Joi.number().integer().min(1).max(10).required()
    .messages({
      'number.min': 'Quantity must be at least 1',
      'number.max': 'Quantity cannot exceed 10',
      'any.required': 'Quantity is required'
    }),
  buyer_email: Joi.string().email().lowercase().trim().required()
    .messages({
      'string.email': 'Invalid email format',
      'any.required': 'Buyer email is required'
    }),
  buyer_name: Joi.string().max(255).trim().optional()
    .messages({
      'string.max': 'Buyer name must be less than 255 characters'
    }),
  currency: Joi.string().valid('usd', 'eur', 'gbp').default('usd')
    .messages({
      'any.only': 'Currency must be one of: usd, eur, gbp'
    })
});

/**
 * Connect Onboarding Schema
 */
export const connectOnboardSchema = Joi.object({
  email: Joi.string().email().lowercase().trim().required()
    .messages({
      'string.email': 'Invalid email format',
      'any.required': 'Email is required'
    }),
  first_name: Joi.string().max(100).trim().optional()
    .messages({
      'string.max': 'First name must be less than 100 characters'
    }),
  last_name: Joi.string().max(100).trim().optional()
    .messages({
      'string.max': 'Last name must be less than 100 characters'
    }),
  return_url: Joi.string().uri().required()
    .messages({
      'string.uri': 'Return URL must be a valid URL',
      'any.required': 'Return URL is required'
    }),
  refresh_url: Joi.string().uri().optional()
    .messages({
      'string.uri': 'Refresh URL must be a valid URL'
    })
});

/**
 * Ticket Scan Schema
 */
export const ticketScanSchema = Joi.object({
  token: Joi.string().min(10).required()
    .messages({
      'string.min': 'Invalid ticket token',
      'any.required': 'Ticket token is required'
    })
});

/**
 * Event Creation Schema
 */
export const eventCreateSchema = Joi.object({
  title: Joi.string().min(3).max(255).trim().required()
    .messages({
      'string.min': 'Event title must be at least 3 characters',
      'string.max': 'Event title must be less than 255 characters',
      'any.required': 'Event title is required'
    }),
  description: Joi.string().max(5000).trim().optional()
    .messages({
      'string.max': 'Description must be less than 5000 characters'
    }),
  venue: Joi.string().min(3).max(255).trim().required()
    .messages({
      'string.min': 'Venue must be at least 3 characters',
      'string.max': 'Venue must be less than 255 characters',
      'any.required': 'Venue is required'
    }),
  address: Joi.string().max(500).trim().optional()
    .messages({
      'string.max': 'Address must be less than 500 characters'
    }),
  city: Joi.string().max(100).trim().optional()
    .messages({
      'string.max': 'City must be less than 100 characters'
    }),
  state: Joi.string().max(50).trim().optional()
    .messages({
      'string.max': 'State must be less than 50 characters'
    }),
  zip_code: Joi.string().max(20).trim().optional()
    .messages({
      'string.max': 'Zip code must be less than 20 characters'
    }),
  country: Joi.string().length(2).uppercase().default('US')
    .messages({
      'string.length': 'Country must be a 2-letter country code'
    }),
  starts_at: Joi.date().iso().greater('now').required()
    .messages({
      'date.greater': 'Event start time must be in the future',
      'any.required': 'Event start time is required'
    }),
  ends_at: Joi.date().iso().greater(Joi.ref('starts_at')).optional()
    .messages({
      'date.greater': 'Event end time must be after start time'
    }),
  price_cents: Joi.number().integer().min(0).max(1000000).required()
    .messages({
      'number.min': 'Price cannot be negative',
      'number.max': 'Price cannot exceed $10,000',
      'any.required': 'Price is required'
    }),
  currency: Joi.string().valid('usd', 'eur', 'gbp').default('usd')
    .messages({
      'any.only': 'Currency must be one of: usd, eur, gbp'
    }),
  capacity: Joi.number().integer().min(1).max(100000).default(100)
    .messages({
      'number.min': 'Capacity must be at least 1',
      'number.max': 'Capacity cannot exceed 100,000'
    }),
  image_url: Joi.string().uri().optional()
    .messages({
      'string.uri': 'Image URL must be a valid URL'
    })
});

/**
 * Order Lookup Schema
 */
export const orderLookupSchema = Joi.object({
  order_id: Joi.alternatives().try(
    Joi.number().integer().positive(),
    Joi.string().pattern(/^\d+$/)
  ).required()
    .messages({
      'alternatives.match': 'Order ID must be a positive integer',
      'any.required': 'Order ID is required'
    })
});

/**
 * Customer Creation Schema
 */
export const customerCreateSchema = Joi.object({
  email: Joi.string().email().lowercase().trim().required()
    .messages({
      'string.email': 'Invalid email format',
      'any.required': 'Email is required'
    }),
  name: Joi.string().max(255).trim().optional()
    .messages({
      'string.max': 'Name must be less than 255 characters'
    })
});

/**
 * Email Schema (for OTP and other email operations)
 */
export const emailSchema = Joi.object({
  email: Joi.string().email().lowercase().trim().required()
    .messages({
      'string.email': 'Invalid email format',
      'any.required': 'Email is required'
    })
});

/**
 * OTP Verification Schema
 */
export const otpVerifySchema = Joi.object({
  email: Joi.string().email().lowercase().trim().required()
    .messages({
      'string.email': 'Invalid email format',
      'any.required': 'Email is required'
    }),
  otp: Joi.string().pattern(/^\d{4,8}$/).required()
    .messages({
      'string.pattern.base': 'OTP must be 4-8 digits',
      'any.required': 'OTP is required'
    })
});

/**
 * Password Reset Schema
 */
export const passwordResetSchema = Joi.object({
  uid: Joi.string().min(10).required()
    .messages({
      'string.min': 'Invalid user ID',
      'any.required': 'User ID is required'
    }),
  password: Joi.string()
    .min(8)
    .max(128)
    .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .required()
    .messages({
      'string.min': 'Password must be at least 8 characters',
      'string.max': 'Password must be less than 128 characters',
      'string.pattern.base': 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character',
      'any.required': 'Password is required'
    })
});

/**
 * Event ID Parameter Schema
 */
export const eventIdParamSchema = Joi.object({
  event_id: Joi.number().integer().positive().required()
    .messages({
      'number.positive': 'Event ID must be positive',
      'any.required': 'Event ID is required'
    })
});

/**
 * Pagination Schema
 */
export const paginationSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1)
    .messages({
      'number.min': 'Page must be at least 1'
    }),
  limit: Joi.number().integer().min(1).max(100).default(20)
    .messages({
      'number.min': 'Limit must be at least 1',
      'number.max': 'Limit cannot exceed 100'
    }),
  offset: Joi.number().integer().min(0).optional()
    .messages({
      'number.min': 'Offset cannot be negative'
    })
});

/**
 * Ticket Token Query Schema (for GET /tickets/verify)
 */
export const ticketTokenQuerySchema = Joi.object({
  token: Joi.string().min(10).trim().required()
    .messages({
      'string.min': 'Invalid ticket token',
      'any.required': 'Ticket token is required'
    })
});

/**
 * Ticket Token Param Schema (for GET /tickets/qr/:token)
 */
export const ticketTokenParamSchema = Joi.object({
  token: Joi.string().min(10).trim().required()
    .messages({
      'string.min': 'Invalid ticket token',
      'any.required': 'Ticket token is required'
    })
});

/**
 * QR Size Query Schema
 */
export const qrSizeQuerySchema = Joi.object({
  size: Joi.number().integer().min(100).max(1000).default(200)
    .messages({
      'number.min': 'QR code size must be at least 100',
      'number.max': 'QR code size cannot exceed 1000'
    })
});
