import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';
import { initializeDatabase } from './database';
import { logRequest, logError } from './middleware/logger';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { createErrorResponse, ApiError } from './utils/errors';
import { jobScheduler } from './jobs/jobScheduler';

// Load environment variables
if (process.env.NODE_ENV !== 'production') {
  config();
}

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

// CORS configuration
app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:3001', 
    'https://your-frontend-domain.com', // Add your production domain
    'vibesy://', // Allow iOS app scheme
  ],
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
