// src/config/redis.js
import Redis from 'ioredis';
import config from './env.js';
import logger from '../utils/logger.js';

class RedisClient {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.retryCount = 0;
  }

  /**
   * Create Redis connection
   */
  createClient() {
    const options = {
      host: config.REDIS_HOST,
      port: config.REDIS_PORT,
      username: config.REDIS_USERNAME || (config.REDIS_PASSWORD ? 'default' : undefined),
      password: config.REDIS_PASSWORD || undefined,
      db: parseInt(config.REDIS_DB, 10),
      keyPrefix: config.REDIS_KEY_PREFIX ? `${config.REDIS_KEY_PREFIX}:` : '',
      tls: config.REDIS_TLS
        ? { servername: config.REDIS_HOST, rejectUnauthorized: false }
        : undefined,
      retryStrategy: (times) => {
        if (times > config.REDIS_MAX_RETRIES) {
          logger.error(`Redis connection failed after ${times} retries`);
          return null; // Stop retrying
        }
        const delay = Math.min(times * 50, 2000);
        logger.warn(`Redis connection retry ${times} in ${delay}ms`);
        return delay;
      },
      reconnectOnError: (err) => {
        const targetError = 'READONLY';
        if (err.message.includes(targetError)) {
          return true; // Reconnect for READONLY errors
        }
        return false;
      },
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      autoResubscribe: false,
      lazyConnect: true,
      connectTimeout: parseInt(config.REDIS_CONNECT_TIMEOUT, 10),
    };

    this.client = new Redis(options);

    // Set up event listeners
    this.setupEventListeners();

    return this.client;
  }

  /**
   * Set up Redis event listeners
   */
  setupEventListeners() {
    this.client.on('connect', () => {
      logger.info('Redis connecting...');
    });

    this.client.on('ready', () => {
      this.isConnected = true;
      this.retryCount = 0;
      logger.info('✅ Redis connected successfully');
      logger.info(`   Host: ${config.REDIS_HOST}:${config.REDIS_PORT}`);
      logger.info(`   DB: ${config.REDIS_DB}`);
    });

    this.client.on('error', (error) => {
      this.isConnected = false;
      logger.error('Redis error:', error);
    });

    this.client.on('close', () => {
      this.isConnected = false;
      logger.warn('Redis connection closed');
    });

    this.client.on('reconnecting', () => {
      this.isConnected = false;
      this.retryCount++;
      logger.warn(`Redis reconnecting... (${this.retryCount})`);
    });
  }

  /**
   * Get Redis client instance
   */
  getClient() {
    if (!this.client) {
      this.createClient();
    }
    return this.client;
  }

  /**
   * Check if Redis is connected
   */
  isConnectedState() {
    return this.isConnected && this.client?.status === 'ready';
  }

  /**
   * Set a value in Redis
   *
   * Redis is a cache — never let a write failure block the caller. On error the
   * value is simply not cached and the request continues.
   */
  async set(key, value, ttl = null) {
    try {
      if (!this.isConnectedState()) {
        throw new Error('Redis not connected');
      }
      const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
      if (ttl) {
        return await this.client.set(key, stringValue, 'EX', ttl);
      }
      return await this.client.set(key, stringValue);
    } catch (error) {
      logger.error('Redis set error:', error.message);
      return null;
    }
  }

  /**
   * Get a value from Redis
   */
  async get(key) {
    try {
      if (!this.isConnectedState()) {
        throw new Error('Redis not connected');
      }
      const value = await this.client.get(key);
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    } catch (error) {
      logger.error('Redis get error:', error.message);
      return null;
    }
  }

  /**
   * Delete a key from Redis.
   *
   * When `key` contains a glob wildcard (`*`/`?`/`[`), all matching keys are
   * deleted via SCAN — Redis `DEL` alone cannot match patterns, and callers
   * rely on pattern deletes (e.g. `materials:list:*`) to bust list caches.
   *
   * Best-effort: on a disconnected Redis we just skip invalidation so callers
   * (e.g. cache invalidation after a write) are never blocked.
   */
  async del(key) {
    try {
      if (!this.isConnectedState()) {
        throw new Error('Redis not connected');
      }
      if (/[*?[]/.test(key)) {
        const matches = [];
        let cursor = '0';
        do {
          const [next, keys] = await this.client.scan(cursor, 'MATCH', key, 'COUNT', 500);
          cursor = next;
          matches.push(...keys);
        } while (cursor !== '0');
        if (matches.length) {
          await this.client.del(...matches);
        }
        return matches.length;
      }
      return await this.client.del(key);
    } catch (error) {
      logger.error('Redis del error:', error.message);
      return null;
    }
  }

  /**
   * Set expire time for a key
   *
   * Best-effort — see `set`/`del`.
   */
  async expire(key, seconds) {
    try {
      if (!this.isConnectedState()) {
        throw new Error('Redis not connected');
      }
      return await this.client.expire(key, seconds);
    } catch (error) {
      logger.error('Redis expire error:', error.message);
      return null;
    }
  }

  /**
   * Check if key exists
   */
  async exists(key) {
    try {
      if (!this.isConnectedState()) {
        throw new Error('Redis not connected');
      }
      return await this.client.exists(key);
    } catch (error) {
      logger.error('Redis exists error:', error.message);
      return false;
    }
  }

  /**
   * Get all keys matching a pattern
   */
  async keys(pattern) {
    try {
      if (!this.isConnectedState()) {
        throw new Error('Redis not connected');
      }
      return await this.client.keys(pattern);
    } catch (error) {
      logger.error('Redis keys error:', error.message);
      return [];
    }
  }

  /**
   * Flush all keys in the current database
   *
   * Best-effort — see `set`/`del`.
   */
  async flushAll() {
    try {
      if (!this.isConnectedState()) {
        throw new Error('Redis not connected');
      }
      return await this.client.flushdb();
    } catch (error) {
      logger.error('Redis flush error:', error.message);
      return null;
    }
  }

  /**
   * Get Redis health status
   */
  async healthCheck() {
    try {
      if (!this.isConnectedState()) {
        return {
          status: 'unhealthy',
          isConnected: false,
          error: 'Redis not connected',
        };
      }
      
      await this.client.ping();
      const info = await this.client.info();
      const memoryMatch = info.match(/used_memory_human:([^\r\n]+)/);
      const memory = memoryMatch ? memoryMatch[1] : 'unknown';

      return {
        status: 'healthy',
        isConnected: true,
        memory,
        host: config.REDIS_HOST,
        port: config.REDIS_PORT,
        db: config.REDIS_DB,
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        isConnected: this.isConnected,
        error: error.message,
      };
    }
  }

  /**
   * Quit Redis connection
   */
  async quit() {
    if (this.client) {
      try {
        await this.client.quit();
        this.isConnected = false;
        logger.info('Redis disconnected gracefully');
      } catch (error) {
        logger.error('Error disconnecting Redis:', error.message);
        throw error;
      }
    }
  }
}

// Create singleton instance
const redisClient = new RedisClient();

// Export Redis functions
export const getRedis = () => redisClient.getClient();
export const isRedisConnected = () => redisClient.isConnectedState();
export const redisSet = (key, value, ttl) => redisClient.set(key, value, ttl);
export const redisGet = (key) => redisClient.get(key);
export const redisDel = (key) => redisClient.del(key);
export const redisExpire = (key, seconds) => redisClient.expire(key, seconds);
export const redisExists = (key) => redisClient.exists(key);
export const redisKeys = (pattern) => redisClient.keys(pattern);
export const redisHealthCheck = () => redisClient.healthCheck();
export const redisQuit = () => redisClient.quit();

export default redisClient;