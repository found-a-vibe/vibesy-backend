import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { config } from 'dotenv';
import { initializeDatabase, closeDatabase, getDatabase } from './database';
import { logger, log } from './utils/logger';
import { logRequest, logError } from './middleware/logger';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { requireAuth, requireAdmin, AuthRequest } from './middleware/auth';
import { createErrorResponse, ApiError } from './utils/errors';
import { jobScheduler } from './jobs/jobScheduler';
import redisRepository from './repositories/redisRepository';
import { validateEnv } from './utils/validateEnv';
import { 
  globalLimiter, 
  otpLimiter, 
  paymentLimiter, 
  connectLimiter, 
  ticketScanLimiter, 
  authLimiter 
} from './middleware/rateLimiter';

// Load environment variables
if (process.env.NODE_ENV !== 'production') {
  config();
}

// Validate environment variables before starting
validateEnv();

// Import route handlers
import { connectRoutes } from './routes/connect';
import { paymentRoutes } from './routes/payments';
import { webhookRoutes } from './routes/webhooks';
import { ticketRoutes } from './routes/tickets';
import { eventsRoutes } from './routes/events';
import { authRoutes } from './routes/auth';
import { notificationRoutes } from './routes/notifications';
import { otpRoutes } from './routes/otp';
import { productsRoutes } from './routes/products';
import { paymentIntentsRoutes } from './routes/paymentIntents';
import { reservationsRoutes } from './routes/reservations';
import { reservationPaymentRoutes } from './routes/reservationPayments';

const app = express();
const port = parseInt(process.env.SERVER_PORT || '4242');

// Security: HTTPS redirect in production
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.header('x-forwarded-proto') !== 'https') {
      res.redirect(`https://${req.header('host')}${req.url}`);
    } else {
      next();
    }
  });
}

// Security headers with Helmet
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://api.stripe.com"],
      frameSrc: ["'self'", "https://js.stripe.com", "https://hooks.stripe.com"],
    },
  },
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true
  },
  noSniff: true,
  xssFilter: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  frameguard: { action: 'deny' }
}));

// CORS configuration with environment-based origins
const allowedOrigins = process.env.NODE_ENV === 'production'
  ? [
      process.env.FRONTEND_URL || '',
      'vibesy://stripe/onboard_complete',
      'vibesy://stripe/onboard_refresh'
    ].filter(Boolean)
  : [
      'http://localhost:3000',
      'http://localhost:3001',
      'vibesy://'
    ];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.some(allowed => origin.startsWith(allowed.replace('://', ''))) || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'stripe-signature'],
}));

// Health check endpoint (simple liveness check)
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Readiness check endpoint (verifies database connectivity)
app.get('/ready', async (req, res) => {
  const checks = {
    postgres: { status: 'unknown' as 'ok' | 'error', message: '' },
    redis: { status: 'unknown' as 'ok' | 'error', message: '' }
  };
  
  let allHealthy = true;
  
  // Check PostgreSQL
  try {
    const db = getDatabase();
    await db.query('SELECT 1');
    checks.postgres.status = 'ok';
    checks.postgres.message = 'Connected';
  } catch (error: any) {
    checks.postgres.status = 'error';
    checks.postgres.message = error.message || 'Connection failed';
    allHealthy = false;
  }
  
  // Check Redis
  try {
    await redisRepository.ping();
    checks.redis.status = 'ok';
    checks.redis.message = 'Connected';
  } catch (error: any) {
    checks.redis.status = 'error';
    checks.redis.message = error.message || 'Connection failed';
    allHealthy = false;
  }
  
  const statusCode = allHealthy ? 200 : 503;
  res.status(statusCode).json({
    status: allHealthy ? 'ready' : 'not_ready',
    timestamp: new Date().toISOString(),
    checks
  });
});

// Webhook routes MUST come before express.json() middleware
// because Stripe webhooks need raw body
app.use('/webhooks', webhookRoutes);

// JSON parsing for all other routes
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Enhanced request logging middleware
app.use(logRequest);

// Rate limiting - apply to specific route groups
app.use('/otp', otpLimiter);
app.use('/auth', authLimiter);
app.use('/payments', paymentLimiter);
app.use('/connect', connectLimiter);
app.use('/tickets/scan', ticketScanLimiter);

// Global rate limiter for all routes
app.use(globalLimiter);

// API routes
app.use('/connect', connectRoutes);
app.use('/payments', paymentRoutes);
app.use('/tickets', ticketRoutes);
app.use('/events', eventsRoutes);
app.use('/auth', authRoutes);
app.use('/notifications', notificationRoutes);
app.use('/otp', otpRoutes);
app.use('/stripe', productsRoutes);
app.use('/stripe', paymentIntentsRoutes);
app.use('/reservations', reservationsRoutes);
app.use('/reservation-payments', reservationPaymentRoutes);

// Admin/system routes (protected)
app.get('/system/jobs', requireAuth, requireAdmin, (req: AuthRequest, res) => {
  res.json(jobScheduler.getStatus());
});

app.post('/system/jobs/:jobName/run', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { jobName } = req.params;
    const result = await jobScheduler.runJobNow(jobName);
    res.json({ success: true, result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'Vibesy Ticketing API',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// Error handling middleware
app.use(logError);
app.use(errorHandler);

// 404 handler
app.use('*', notFoundHandler);

// Initialize database and start server
async function startServer() {
  try {
    log.info('Initializing database...');
    await initializeDatabase();
    log.info('Database initialized successfully');
    
    log.info('Starting job scheduler...');
    jobScheduler.startAll();
    log.info('Job scheduler started successfully');
    
    const server = app.listen(port, '0.0.0.0', () => {
      log.info('Vibesy API server running', {
        port,
        healthCheck: `/health`,
        readyCheck: `/ready`,
        environment: process.env.NODE_ENV || 'development',
        systemJobs: `/system/jobs`,
      });
    });

    // Graceful shutdown
    const gracefulShutdown = async () => {
      log.info('Starting graceful shutdown...');
      
      server.close(() => {
        log.info('HTTP server closed');
      });
      
      await jobScheduler.shutdown();
      log.info('Background jobs stopped');
      
      await closeDatabase();
      log.info('Database connections closed');
      
      log.info('Graceful shutdown complete');
      process.exit(0);
    };

    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);
    
  } catch (error) {
    log.fatal('Failed to start server', error instanceof Error ? error : undefined, {
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
}

startServer();
