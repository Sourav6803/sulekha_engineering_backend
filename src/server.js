// src/server.js
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import app from './app.js';
import config from './config/env.js';
import logger from './utils/logger.js';
import { connectDB, disconnectDB } from './config/db.js';
import { getRedis, redisQuit } from './config/redis.js';
import { initializeQueue, closeQueue } from './jobs/queue.js';
import { describeChrome } from './services/chromeLaunch.js';
import { describeOrigins, allowsAnyOrigin } from './config/cors.js';
import { getAppUrl } from './services/email.service.js';

// ============================================
// GRACEFUL SHUTDOWN
// ============================================

const gracefulShutdown = async (server) => {
  logger.info('Received shutdown signal. Starting graceful shutdown...');
  
  // Create a timeout to force exit
  const timeout = setTimeout(() => {
    logger.error('Forcing shutdown due to timeout');
    process.exit(1);
  }, 30000); // 30 seconds

  try {
    // Close server
    server.close(() => {
      logger.info('HTTP server closed');
    });

    // Disconnect from database
    await disconnectDB();
    logger.info('Database disconnected');

    // Close Redis connection. Wrapped because a shutdown should still finish
    // when Redis is unreachable or over quota.
    try {
      await redisQuit();
      logger.info('Redis disconnected');
    } catch (error) {
      logger.warn(`Redis was already down at shutdown: ${error.message}`);
    }

    // Close queue connections
    await closeQueue();
    logger.info('Queue connections closed');

    clearTimeout(timeout);
    logger.info('Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    logger.error('Error during graceful shutdown:', error);
    process.exit(1);
  }
};

// ============================================
// SERVER STARTUP
// ============================================

const startServer = async () => {
  try {
    // ============================================
    // CONNECT TO DATABASE
    // ============================================
    await connectDB();
    logger.info('✅ Database connection established');

    // ============================================
    // CONNECT TO REDIS
    // ============================================
    //
    // Redis is a cache here, never the source of truth. It was previously
    // connected inside the same try block as the database, so a Redis problem —
    // an over-quota Upstash account replying "max requests limit exceeded", for
    // instance — aborted startServer() and the API never listened at all.
    // Failing to reach it now only costs us caching.
    try {
      const redis = getRedis();
      await redis.connect();
      logger.info('✅ Redis connection established');
    } catch (error) {
      logger.error(
        `⚠️  Redis unavailable, continuing without cache: ${error.message}`
      );
    }

    // ============================================
    // INITIALIZE BACKGROUND JOBS
    // ============================================
    // Gated on ENABLE_QUEUE_WORKERS, which is also what stops queue.js from
    // starting BullMQ workers at import time. See src/jobs/queue.js — those
    // workers poll Redis continuously and will drain a metered plan.
    if (config.ENABLE_QUEUE_WORKERS) {
      await initializeQueue();
      logger.info('✅ Queue system initialized');
    } else {
      logger.info('Background job workers are disabled (ENABLE_QUEUE_WORKERS is not "true")');
    }

    // ============================================
    // DOCUMENT RENDERER
    // ============================================
    // Reported at boot because a deploy that cannot find Chrome stays invisible
    // until someone opens a PDF — and by then nobody is reading the build log.
    // Read-only: it resolves paths and reads the filesystem, never launching a
    // browser (see GET /health/renderer for the same answer on demand).
    try {
      const renderer = await describeChrome();
      const browser = renderer.resolvedPath;

      logger.info(
        browser
          ? `Document renderer: ${browser}`
          : `Document renderer: NO BROWSER FOUND (cache checked: ${renderer.projectCacheDir})`
      );
    } catch (error) {
      logger.warn(`Document renderer could not be inspected: ${error.message}`);
    }

    // ============================================
    // CROSS-ORIGIN POLICY
    // ============================================
    // Printed for the same reason as the line above: a policy that refuses the
    // deployed frontend is otherwise only visible as a browser console error — and
    // the value that reads as "allow everything" is capable of refusing all.
    if (config.NODE_ENV === 'production') {
      logger.info(`CORS allowed origins: ${describeOrigins(config.CORS_ORIGIN)}`);

      // `*` is honoured — any origin is reflected — but it is a policy worth
      // noticing, because the safer answer costs one environment variable.
      if (allowsAnyOrigin(config.CORS_ORIGIN)) {
        logger.warn(
          'CORS_ORIGIN is not set to a frontend origin, so every origin is accepted. Set it to the frontend URL to narrow this.'
        );
      }

      // Every email links to the frontend ("sign in here"), and without CLIENT_URL
      // the link falls back to whichever origin happens to be first — which is
      // localhost, the one place an agent cannot reach. Worth saying out loud,
      // because the mail itself still sends and nothing else shows it.
      if (!config.CLIENT_URL) {
        logger.warn(
          `CLIENT_URL is not set, so links in outgoing email are built from CORS_ORIGIN (${getAppUrl()}). Set CLIENT_URL to the frontend URL.`
        );
      }
    } else {
      logger.info('CORS: every origin allowed (development)');
    }

    // ============================================
    // CREATE HTTP SERVER
    // ============================================
    const server = http.createServer(app);

    // Set keep-alive timeout
    server.keepAliveTimeout = 65000;
    server.headersTimeout = 66000;

    // Start listening
    server.listen(config.PORT, config.HOST, () => {
      const address = server.address();
      const host = address.address === '::' ? 'localhost' : address.address;
      
      logger.info('=========================================');
      logger.info(`🚀 ${config.APP_NAME} is running!`);
      logger.info(`   Environment: ${config.NODE_ENV}`);
      logger.info(`   Server: http://${host}:${address.port}`);
      logger.info(`   API: http://${host}:${address.port}${config.API_PREFIX}`);
      logger.info(`   Health: http://${host}:${address.port}/health`);
      logger.info('=========================================');

      if (config.NODE_ENV === 'development') {
        logger.info(`📚 API Documentation: http://${host}:${address.port}/api-docs`);
      }
    });

    // ============================================
    // GRACEFUL SHUTDOWN HANDLERS
    // ============================================
    const shutdownHandler = () => gracefulShutdown(server);

    process.on('SIGTERM', shutdownHandler);
    process.on('SIGINT', shutdownHandler);

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught Exception:', error);
      gracefulShutdown(server);
    });

    // Handle unhandled rejections
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
      gracefulShutdown(server);
    });

    // Return server instance
    return server;

  } catch (error) {
    logger.error('❌ Server startup failed:', error);
    process.exit(1);
  }
};

// ============================================
// START SERVER
// ============================================

// Only start server if this file is run directly
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer().catch((error) => {
    logger.error('Server startup error:', error);
    process.exit(1);
  });
}

// ============================================
// EXPORT
// ============================================

export default startServer;