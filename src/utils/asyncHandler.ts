import { Request, Response, NextFunction } from 'express';
import { ApiError } from './errors';

type AsyncFunction = (req: Request, res: Response, next: NextFunction) => Promise<any>;

/**
 * Wrapper for async route handlers to catch errors and pass them to error handling middleware
 */
export const asyncHandler = (fn: AsyncFunction) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * Wrapper for async middleware functions
 */
export const asyncMiddleware = (fn: AsyncFunction) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch((error) => {
      // Convert non-ApiError errors to ApiError for consistent handling
      if (!(error instanceof ApiError)) {
        const apiError = new ApiError(
          500,
          'Internal Server Error',
          error.message || 'An unexpected error occurred'
        );
        return next(apiError);
      }
      next(error);
    });
  };
};

/**
 * Wrapper for service layer functions to handle errors consistently
 */
export const asyncService = <T extends any[], R>(
  fn: (...args: T) => Promise<R>
) => {
  return async (...args: T): Promise<R> => {
    try {
      return await fn(...args);
    } catch (error) {
      // Log service errors for debugging
      console.error('Service error:', error);
      
      // Re-throw ApiErrors as-is
      if (error instanceof ApiError) {
        throw error;
      }
      
      // Convert other errors to ApiError
      throw new ApiError(
        500,
        'Internal Server Error',
        error instanceof Error ? error.message : 'An unexpected error occurred'
      );
    }
  };
};

/**
 * Retry wrapper for functions that may fail temporarily
 */
export const withRetry = <T extends any[], R>(
  fn: (...args: T) => Promise<R>,
  maxRetries: number = 3,
  delayMs: number = 1000
) => {
  return async (...args: T): Promise<R> => {
    let lastError: Error = new Error('Unknown error');
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn(...args);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        // Don't retry on certain types of errors
        if (error instanceof ApiError && error.statusCode < 500) {
          throw error;
        }
        
        if (attempt === maxRetries) {
          break;
        }
        
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, delayMs * attempt));
        
        console.warn(`Retry attempt ${attempt}/${maxRetries} failed:`, lastError.message);
      }
    }
    
    throw lastError;
  };
};

/**
 * Timeout wrapper for functions that may hang
 */
export const withTimeout = <T extends any[], R>(
  fn: (...args: T) => Promise<R>,
  timeoutMs: number
) => {
  return async (...args: T): Promise<R> => {
    return new Promise<R>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new ApiError(408, 'Request Timeout', `Operation timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      
      fn(...args)
        .then(result => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  };
};

/**
 * Circuit breaker pattern implementation
 */
export class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';

  constructor(
    private maxFailures: number = 5,
    private resetTimeoutMs: number = 60000
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.resetTimeoutMs) {
        this.state = 'HALF_OPEN';
      } else {
        throw new ApiError(503, 'Service Unavailable', 'Circuit breaker is open');
      }
    }

    try {
      const result = await fn();
      
      if (this.state === 'HALF_OPEN') {
        this.reset();
      }
      
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  private recordFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.failures >= this.maxFailures) {
      this.state = 'OPEN';
    }
  }

  private reset(): void {
    this.failures = 0;
    this.state = 'CLOSED';
    this.lastFailureTime = 0;
  }

  getState(): string {
    return this.state;
  }

  getFailures(): number {
    return this.failures;
  }
}

/**
 * Cache wrapper with TTL support
 */
export class AsyncCache<T> {
  private cache = new Map<string, { value: T; expiry: number }>();

  constructor(private defaultTtlMs: number = 300000) {} // 5 minutes default

  async get<K extends any[]>(
    key: string,
    fn: (...args: K) => Promise<T>,
    args: K,
    ttlMs?: number
  ): Promise<T> {
    const now = Date.now();
    const cached = this.cache.get(key);

    if (cached && cached.expiry > now) {
      return cached.value;
    }

    const value = await fn(...args);
    const expiry = now + (ttlMs || this.defaultTtlMs);
    
    this.cache.set(key, { value, expiry });
    
    return value;
  }

  clear(key?: string): void {
    if (key) {
      this.cache.delete(key);
    } else {
      this.cache.clear();
    }
  }

  cleanup(): void {
    const now = Date.now();
    
    for (const [key, { expiry }] of this.cache.entries()) {
      if (expiry <= now) {
        this.cache.delete(key);
      }
    }
  }

  size(): number {
    return this.cache.size;
  }
}

export default asyncHandler;