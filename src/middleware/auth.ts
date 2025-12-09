import { Request, Response, NextFunction } from 'express';
import { adminService } from '../services/adminService';
import { findUserByEmail, findEventById } from '../database';
import { ApiError } from '../utils/errors';

/**
 * Extended Request interface with authenticated user information
 */
export interface AuthRequest extends Request {
  user?: {
    uid: string;
    email: string;
    role?: string;
  };
}

/**
 * Middleware to require authentication via Firebase token
 * Verifies the Bearer token in Authorization header
 */
export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new ApiError(401, 'Unauthorized', 'No authentication token provided');
    }

    const token = authHeader.split('Bearer ')[1];
    
    if (!token || token.trim() === '') {
      throw new ApiError(401, 'Unauthorized', 'Invalid token format');
    }

    try {
      // Verify the Firebase ID token
      const decodedToken = await adminService.auth().verifyIdToken(token);
      
      if (!decodedToken.email) {
        throw new ApiError(401, 'Unauthorized', 'Token does not contain email');
      }

      // Attach user info to request
      req.user = {
        uid: decodedToken.uid,
        email: decodedToken.email,
        role: decodedToken.role || undefined
      };
      
      next();
    } catch (error: any) {
      // Handle Firebase auth errors
      if (error.code === 'auth/id-token-expired') {
        throw new ApiError(401, 'Unauthorized', 'Token has expired');
      } else if (error.code === 'auth/id-token-revoked') {
        throw new ApiError(401, 'Unauthorized', 'Token has been revoked');
      } else if (error.code === 'auth/argument-error') {
        throw new ApiError(401, 'Unauthorized', 'Invalid token format');
      } else {
        throw new ApiError(401, 'Unauthorized', 'Invalid or expired token');
      }
    }
  } catch (error) {
    next(error);
  }
};

/**
 * Middleware to require host role
 * Must be used AFTER requireAuth
 */
export const requireHost = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      throw new ApiError(401, 'Unauthorized', 'Authentication required');
    }

    // Check if user has host role in database
    const user = await findUserByEmail(req.user.email);
    
    if (!user) {
      throw new ApiError(404, 'Not Found', 'User not found');
    }

    if (user.role !== 'host' && user.role !== 'admin') {
      throw new ApiError(403, 'Forbidden', 'Host privileges required');
    }

    // Attach user ID to request for convenience
    (req as any).userId = user.id;

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Middleware to require event access
 * Verifies the authenticated user owns/manages the event
 * Must be used AFTER requireAuth
 */
export const requireEventAccess = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      throw new ApiError(401, 'Unauthorized', 'Authentication required');
    }

    // Get event ID from params or body
    const eventId = req.params.event_id || req.body.event_id;
    
    if (!eventId) {
      throw new ApiError(400, 'Bad Request', 'Event ID required');
    }

    // Get event details
    const event = await findEventById(parseInt(eventId));
    
    if (!event) {
      throw new ApiError(404, 'Not Found', 'Event not found');
    }

    // Get user details
    const user = await findUserByEmail(req.user.email);
    
    if (!user) {
      throw new ApiError(404, 'Not Found', 'User not found');
    }

    // Check if user is the event host or admin
    if (event.host_id !== user.id && user.role !== 'admin') {
      throw new ApiError(403, 'Forbidden', 'Not authorized for this event');
    }

    // Attach user ID and event to request for convenience
    (req as any).userId = user.id;
    (req as any).event = event;

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Middleware to require admin role
 * Must be used AFTER requireAuth
 */
export const requireAdmin = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      throw new ApiError(401, 'Unauthorized', 'Authentication required');
    }

    // Check if user has admin role in database
    const user = await findUserByEmail(req.user.email);
    
    if (!user) {
      throw new ApiError(404, 'Not Found', 'User not found');
    }

    if (user.role !== 'admin') {
      throw new ApiError(403, 'Forbidden', 'Admin privileges required');
    }

    // Attach user ID to request for convenience
    (req as any).userId = user.id;

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Optional authentication middleware
 * Attaches user info if token is present, but doesn't require it
 * Useful for endpoints that behave differently for authenticated users
 */
export const optionalAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      // No auth provided, continue without user
      return next();
    }

    const token = authHeader.split('Bearer ')[1];
    
    if (!token || token.trim() === '') {
      // Invalid token format, continue without user
      return next();
    }

    try {
      const decodedToken = await adminService.auth().verifyIdToken(token);
      
      if (decodedToken.email) {
        req.user = {
          uid: decodedToken.uid,
          email: decodedToken.email,
          role: decodedToken.role || undefined
        };
      }
    } catch (error) {
      // Token verification failed, continue without user
      // Don't throw error for optional auth
    }

    next();
  } catch (error) {
    next(error);
  }
};
