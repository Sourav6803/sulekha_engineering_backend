// src/config/db.js
import mongoose from 'mongoose';
import config from './env.js';
import logger from '../utils/logger.js';

class Database {
  constructor() {
    this.isConnected = false;
    this.connection = null;
  }

  /**
   * Connect to MongoDB
   */
  async connect() {
    if (this.isConnected) {
      logger.info('Using existing database connection');
      return this.connection;
    }

    try {
      logger.info('Connecting to MongoDB...');
      const startTime = Date.now();

      const options = {
        maxPoolSize: config.MONGO_MAX_POOL_SIZE,
        minPoolSize: config.MONGO_MIN_POOL_SIZE,
        connectTimeoutMS: config.MONGO_CONNECT_TIMEOUT_MS,
        socketTimeoutMS: config.MONGO_SOCKET_TIMEOUT_MS,
        serverSelectionTimeoutMS: config.MONGO_CONNECT_TIMEOUT_MS,
        readPreference: config.MONGO_READ_PREFERENCE,
        retryWrites: true,
        retryReads: true,
        w: 'majority',
        autoIndex: config.NODE_ENV !== 'production',
        family: 4 
      };

      // Connect to MongoDB
      await mongoose.connect(config.MONGO_URI, options);
      await mongoose.connection.db.admin().ping();
      const elapsed = Date.now() - startTime;
      logger.info(`MongoDB connect took ${elapsed}ms`);

      this.isConnected = true;
      this.connection = mongoose.connection;

      // Set up event listeners
      this.setupEventListeners();

      logger.info('✅ MongoDB connected successfully');
      logger.info(`   Database: ${this.connection.name}`);
      logger.info(`   Host: ${this.connection.host}`);
      logger.info(`   Port: ${this.connection.port}`);

      return this.connection;
    } catch (error) {
      logger.error('❌ MongoDB connection error:', error.message);
      throw error;
    }
  }

  /**
   * Set up MongoDB event listeners
   */
  setupEventListeners() {
    mongoose.connection.on('connected', () => {
      logger.info('MongoDB reconnected');
    });

    mongoose.connection.on('error', (err) => {
      logger.error('MongoDB connection error:', err.message);
    });

    mongoose.connection.on('disconnected', () => {
      this.isConnected = false;
      logger.warn('MongoDB disconnected');
    });

    // Handle application termination
    process.on('SIGINT', async () => {
      await this.disconnect();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      await this.disconnect();
      process.exit(0);
    });
  }

  /**
   * Disconnect from MongoDB
   */
  async disconnect() {
    if (this.isConnected) {
      try {
        await mongoose.disconnect();
        this.isConnected = false;
        this.connection = null;
        logger.info('MongoDB disconnected gracefully');
      } catch (error) {
        logger.error('Error disconnecting from MongoDB:', error.message);
        throw error;
      }
    }
  }

  /**
   * Check database health
   */
  async healthCheck() {
    try {
      if (!this.isConnected) {
        await this.connect();
      }
      // Run a ping command
      await mongoose.connection.db.admin().ping();
      return {
        status: 'healthy',
        isConnected: this.isConnected,
        database: mongoose.connection.name,
        host: mongoose.connection.host,
        port: mongoose.connection.port,
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
   * Get mongoose instance
   */
  getMongoose() {
    return mongoose;
  }

  /**
   * Get connection instance
   */
  getConnection() {
    return this.connection;
  }

  /**
   * Check if database is connected
   */
  isConnectedState() {
    return this.isConnected;
  }

  /**
   * Start a session for transactions
   */
  async startSession() {
    if (!this.isConnected) {
      throw new Error('Database not connected');
    }
    return await mongoose.startSession();
  }
}

// Create singleton instance
const database = new Database();

// Export connection functions
export const connectDB = () => database.connect();
export const disconnectDB = () => database.disconnect();
export const getDB = () => database.getConnection();
export const getMongoose = () => database.getMongoose();
export const healthCheck = () => database.healthCheck();
export const startSession = () => database.startSession();

export default database;





