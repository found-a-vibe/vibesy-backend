import { Request, Response, NextFunction } from 'express';
import { adminService } from '../services/adminService';
import { ApiError } from '../utils/errors';

interface ExtendedRequest extends Request {
  uid?: string;
  userRecord?: any;
}

/**
 * Middleware to verify that an email exists in Firebase Auth
 */
export const verifyEmail = async (req: ExtendedRequest, res: Response, next: NextFunction): Promise<void> => {
  const { email } = req.body;

  if (!email) {
    return next(new ApiError(400, 'Bad Request', 'Email is required in request body'));
  }

  if (!isValidEmail(email)) {
    return next(new ApiError(400, 'Bad Request', 'Invalid email format'));
  }

  try {
    const userRecord = await adminService.auth().getUserByEmail(email);
    
    if (!userRecord) {
      return next(new ApiError(404, 'Not Found', 'Email is not registered with our system'));
    }

    // Check if user is disabled
    if (userRecord.disabled) {
      return next(new ApiError(403, 'Forbidden', 'Account is disabled'));
    }

    // Attach user information to request for downstream use
    req.uid = userRecord.uid;
    req.userRecord = userRecord;

    console.log(`Email verified successfully for user: ${userRecord.uid}`);
    next();
  } catch (error: any) {
    console.error('Error verifying email:', error);

    // Handle specific Firebase Auth errors
    if (error.code === 'auth/user-not-found') {
      return next(new ApiError(404, 'Not Found', 'Email is not registered with our system'));
    }
    
    if (error.code === 'auth/invalid-email') {
      return next(new ApiError(400, 'Bad Request', 'Invalid email format'));
    }

    if (error.code === 'auth/too-many-requests') {
      return next(new ApiError(429, 'Too Many Requests', 'Too many requests. Please try again later'));
    }

    return next(new ApiError(500, 'Internal Server Error', 'Unable to verify email'));
  }
};

/**
 * Middleware to verify email exists and is verified
 */
export const verifyEmailIsVerified = async (req: ExtendedRequest, res: Response, next: NextFunction): Promise<void> => {
  // First run email verification
  await verifyEmail(req, res, (error) => {
    if (error) return next(error);

    // Check if email is verified
    if (req.userRecord && !req.userRecord.emailVerified) {
      return next(new ApiError(403, 'Forbidden', 'Email address is not verified'));
    }

    next();
  });
};

/**
 * Middleware to create user if email doesn't exist (optional registration flow)
 */
export const verifyOrCreateUser = async (req: ExtendedRequest, res: Response, next: NextFunction): Promise<void> => {
  const { email, displayName } = req.body;

  if (!email) {
    return next(new ApiError(400, 'Bad Request', 'Email is required in request body'));
  }

  if (!isValidEmail(email)) {
    return next(new ApiError(400, 'Bad Request', 'Invalid email format'));
  }

  try {
    // Try to get existing user
    let userRecord = await adminService.auth().getUserByEmail(email);
    
    req.uid = userRecord.uid;
    req.userRecord = userRecord;

    console.log(`Existing user found: ${userRecord.uid}`);
    next();
  } catch (error: any) {
    if (error.code === 'auth/user-not-found') {
      // Create new user if not found
      try {
        const newUserRecord = await adminService.auth().createUser({
          email,
          displayName,
          emailVerified: false
        });

        req.uid = newUserRecord.uid;
        req.userRecord = newUserRecord;

        console.log(`New user created: ${newUserRecord.uid}`);
        next();
      } catch (createError: any) {
        console.error('Error creating new user:', createError);
        
        if (createError.code === 'auth/email-already-exists') {
          return next(new ApiError(409, 'Conflict', 'Email already exists but could not be retrieved'));
        }
        
        return next(new ApiError(500, 'Internal Server Error', 'Unable to create user'));
      }
    } else {
      console.error('Error verifying or creating user:', error);
      return next(new ApiError(500, 'Internal Server Error', 'Unable to verify or create user'));
    }
  }
};

/**
 * Helper function to validate email format
 */
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}