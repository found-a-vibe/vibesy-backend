import rateLimit from 'express-rate-limit';

/**
 * Global rate limiter for all routes
 * Prevents general DoS attacks
 */
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    success: false,
    error: {
      status: 'Too Many Requests',
      message: 'Too many requests from this IP, please try again later',
      statusCode: 429,
      timestamp: new Date().toISOString()
    }
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  // Skip successful requests from rate limit count
  skipSuccessfulRequests: false,
  // Skip failed requests from rate limit count
  skipFailedRequests: false,
});

/**
 * OTP rate limiter
 * Prevents brute force attacks on OTP verification and email spam
 */
export const otpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // Max 5 OTP requests per hour per IP
  message: {
    success: false,
    error: {
      status: 'Too Many Requests',
      message: 'Too many OTP requests. Please try again later',
      statusCode: 429,
      timestamp: new Date().toISOString()
    }
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  // Log when rate limit is hit
  handler: (req, res) => {
    console.warn(`OTP rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      success: false,
      error: {
        status: 'Too Many Requests',
        message: 'Too many OTP requests. Please try again in an hour',
        statusCode: 429,
        timestamp: new Date().toISOString()
      }
    });
  },
});

/**
 * Payment rate limiter
 * Prevents payment fraud and abuse
 */
export const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Max 10 payment attempts per 15 minutes per IP
  message: {
    success: false,
    error: {
      status: 'Too Many Requests',
      message: 'Too many payment attempts. Please try again later',
      statusCode: 429,
      timestamp: new Date().toISOString()
    }
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  handler: (req, res) => {
    console.warn(`Payment rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      success: false,
      error: {
        status: 'Too Many Requests',
        message: 'Too many payment attempts. Please try again in 15 minutes',
        statusCode: 429,
        timestamp: new Date().toISOString()
      }
    });
  },
});

/**
 * Connect account rate limiter
 * Prevents abuse of Stripe Connect account creation
 */
export const connectLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // Max 3 Connect operations per hour per IP
  message: {
    success: false,
    error: {
      status: 'Too Many Requests',
      message: 'Too many account operations. Please try again later',
      statusCode: 429,
      timestamp: new Date().toISOString()
    }
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  handler: (req, res) => {
    console.warn(`Connect rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      success: false,
      error: {
        status: 'Too Many Requests',
        message: 'Too many account operations. Please try again in an hour',
        statusCode: 429,
        timestamp: new Date().toISOString()
      }
    });
  },
});

/**
 * Ticket scanning rate limiter
 * Prevents rapid ticket scanning abuse
 */
export const ticketScanLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 50, // Max 50 scans per 5 minutes per IP
  message: {
    success: false,
    error: {
      status: 'Too Many Requests',
      message: 'Too many ticket scans. Please slow down',
      statusCode: 429,
      timestamp: new Date().toISOString()
    }
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
});

/**
 * Auth rate limiter
 * Prevents brute force attacks on authentication endpoints
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Max 10 auth attempts per 15 minutes per IP
  message: {
    success: false,
    error: {
      status: 'Too Many Requests',
      message: 'Too many authentication attempts. Please try again later',
      statusCode: 429,
      timestamp: new Date().toISOString()
    }
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  handler: (req, res) => {
    console.warn(`Auth rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      success: false,
      error: {
        status: 'Too Many Requests',
        message: 'Too many authentication attempts. Please try again in 15 minutes',
        statusCode: 429,
        timestamp: new Date().toISOString()
      }
    });
  },
});
