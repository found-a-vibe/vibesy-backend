import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from 'dotenv';
import { initializeDatabase } from './database';
import { logRequest, logError } from './middleware/logger';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { createErrorResponse, ApiError } from './utils/errors';
import { jobScheduler } from './jobs/jobScheduler';
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

// Health check endpoint (before JSON parsing for webhooks)
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
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

// Admin/system routes
app.get('/system/jobs', (req, res) => {
  res.json(jobScheduler.getStatus());
});

app.post('/system/jobs/:jobName/run', async (req, res) => {
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
    console.log('🔧 Initializing database...');
    await initializeDatabase();
    console.log('✅ Database initialized successfully');
    
    console.log('🔧 Starting job scheduler...');
    jobScheduler.startAll();
    console.log('✅ Job scheduler started successfully');
    
    const server = app.listen(port, '0.0.0.0', () => {
      console.log('🚀 Vibesy API server running on port', port);
      console.log('📍 Health check:', `http://localhost:${port}/health`);
      console.log('🔗 Environment:', process.env.NODE_ENV || 'development');
      console.log('📊 System jobs:', `http://localhost:${port}/system/jobs`);
    });

    // Graceful shutdown
    const gracefulShutdown = async () => {
      console.log('📄 Starting graceful shutdown...');
      
      server.close(() => {
        console.log('🔌 HTTP server closed');
      });
      
      await jobScheduler.shutdown();
      console.log('✅ Graceful shutdown complete');
      process.exit(0);
    };

    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
