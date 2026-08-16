// src/middlewares/rateLimiter.js
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { getRedis, isRedisConnected } from '../config/redis.js';
import config from '../config/env.js';

// Create Redis store
const createRedisStore = () => {
  const redis = getRedis();
  
  if (!redis || !isRedisConnected()) {
    return undefined;
  }

  return new RedisStore({
    prefix: 'rate-limit:',
    sendCommand: (...args) => redis.call(...args),
  });
};

const rateLimitKey = (req) => req.userId ? `user:${req.userId}` : ipKeyGenerator(req);

// Create rate limiter
export const rateLimiter = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW_MS || 900000, // 15 minutes default
  max: config.RATE_LIMIT_MAX_REQUESTS || 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: true, // Return rate limit info in the RateLimit-* headers
  legacyHeaders: false, // Disable the X-RateLimit-* headers
  store: createRedisStore(),
  keyGenerator: rateLimitKey,
  skipSuccessfulRequests: config.RATE_LIMIT_SKIP_SUCCESSFUL || false,
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests, please try again later.',
        retryAfter: Math.ceil(config.RATE_LIMIT_WINDOW_MS / 1000),
      },
    });
  },
});

// Stricter rate limiter for authentication endpoints
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  store: createRedisStore(),
  keyGenerator: ipKeyGenerator,
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many authentication attempts, please try again later.',
        retryAfter: 900, // 15 minutes in seconds
      },
    });
  },
});

// Rate limiter for API endpoints that modify data
export const writeRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 50, // 50 write operations per hour
  standardHeaders: true,
  legacyHeaders: false,
  store: createRedisStore(),
  keyGenerator: rateLimitKey,
});

// Rate limiter for PDF generation endpoints
export const pdfRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 PDF generations per hour
  standardHeaders: true,
  legacyHeaders: false,
  store: createRedisStore(),
  keyGenerator: rateLimitKey,
});

export default rateLimiter;
