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

    // Close Redis connection
    await redisQuit();
    logger.info('Redis disconnected');

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
    const redis = getRedis();
    await redis.connect();
    logger.info('✅ Redis connection established');

    // ============================================
    // INITIALIZE BACKGROUND JOBS
    // ============================================
    if (config.ENABLE_BACKGROUND_JOBS) {
      await initializeQueue();
      logger.info('✅ Queue system initialized');
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