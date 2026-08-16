// src/app.js
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import config from './config/env.js';
import logger, { stream } from './utils/logger.js';
import { errorHandler } from './middlewares/errorHandler.js';
import { rateLimiter } from './middlewares/rateLimiter.js';
import { authenticate } from './middlewares/auth.js';
import routes from './routes/index.js';

// Initialize Express
const app = express();

// ============================================
// SECURITY MIDDLEWARES
// ============================================

// Helmet helps secure Express apps by setting HTTP response headers
app.use(
  helmet({
    contentSecurityPolicy: config.NODE_ENV === 'production',
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    // Add other helmet configurations as needed
  })
);

// CORS configuration
const corsOptions = {
  origin: config.CORS_ORIGIN || '*',
  credentials: config.CORS_CREDENTIALS,
  maxAge: config.CORS_MAX_AGE,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['X-Total-Count', 'X-Page-Total'],
};

if (config.NODE_ENV === 'production') {
  // In production, only allow specific origins
  app.use(cors(corsOptions));
} else {
  // In development, allow all origins
  app.use(cors());
}

// ============================================
// PARSING MIDDLEWARES
// ============================================

// Parse JSON bodies
app.use(express.json({ limit: '10mb' }));

// Parse URL-encoded bodies
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Parse cookies
app.use(cookieParser());

// ============================================
// COMPRESSION
// ============================================

// Compress responses
app.use(compression());

// ============================================
// LOGGING
// ============================================

// Request logging with Morgan
const morganFormat = config.NODE_ENV === 'production' ? 'combined' : 'dev';
app.use(morgan(morganFormat, { stream }));

// Custom request logger
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.http(`${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms`);
  });
  next();
});

// ============================================
// RATE LIMITING
// ============================================

// Apply rate limiting to all routes
app.use(rateLimiter);

// ============================================
// HEALTH CHECK
// ============================================

// Simple health check endpoint (no auth required)
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: config.APP_NAME,
    version: process.env.npm_package_version || '1.0.0',
    environment: config.NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

// Readiness probe
app.get('/ready', (req, res) => {
  // Check database connection
  // This will be implemented after DB connection
  res.status(200).json({
    status: 'ready',
    timestamp: new Date().toISOString(),
  });
});

// Liveness probe
app.get('/live', (req, res) => {
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString(),
  });
});

// ============================================
// API ROUTES
// ============================================

// Mount API routes
app.use(config.API_PREFIX || '/api/v1', routes);

// ============================================
// 404 HANDLER
// ============================================

// Catch 404 and forward to error handler
app.use((req, res, next) => {
  const error = new Error('Not Found');
  error.status = 404;
  next(error);
});

// ============================================
// ERROR HANDLER
// ============================================

// Centralized error handler
app.use(errorHandler);

// ============================================
// EXPORT APP
// ============================================

export default app;