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
import { describeChrome } from './services/chromeLaunch.js';
import { buildCorsOptions, warnOnRefusedOrigin } from './config/cors.js';
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

/**
 * CORS configuration.
 *
 * The policy itself lives in `config/cors.js` — reading `CORS_ORIGIN` straight into
 * the middleware is what made an unset variable refuse every origin in production
 * (that file explains the mechanism). Here we only decide that production enforces
 * the list while development allows anything, which is why a wrong `CORS_ORIGIN`
 * stays invisible until after a deploy.
 *
 * `warnOnRefusedOrigin` sets no headers and decides nothing; it exists so a refusal
 * becomes a line in the host's log naming the origin to add, instead of only a
 * browser console error.
 */
const corsOptions = buildCorsOptions({
  origin: config.CORS_ORIGIN,
  credentials: config.CORS_CREDENTIALS,
  maxAge: config.CORS_MAX_AGE,
});

if (config.NODE_ENV === 'production') {
  app.use(warnOnRefusedOrigin(config.CORS_ORIGIN));
  app.use(cors(corsOptions));
} else {
  // In development every origin is allowed, which is what a frontend on another
  // port needs — and why this configuration never gets exercised locally.
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

/**
 * Renderer probe — the answer to "why does the PDF route 503 on this host?".
 *
 * Read-only and cheap: it resolves paths and reads the filesystem but never
 * launches a browser. On a host with no shell access this is the only way to tell
 * a missing browser apart from a mispointed one after a deploy.
 *
 * Always answers 200. A 503 here would be read as "this service is down" by a
 * health check pointed at it, and restart the very instance it is inspecting.
 */
app.get('/health/renderer', async (req, res) => {
  try {
    const renderer = await describeChrome();

    res.status(200).json({
      status: 'ok',
      ready: Boolean(renderer.resolvedPath),
      renderer,
    });
  } catch (error) {
    res.status(200).json({
      status: 'ok',
      ready: false,
      error: error.message,
    });
  }
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