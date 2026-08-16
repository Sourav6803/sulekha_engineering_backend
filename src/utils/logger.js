// src/utils/logger.js
import winston from 'winston';
import path from 'path';
import { fileURLToPath } from 'url';
import config from '../config/env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define custom log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Define level colors
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'blue',
};

winston.addColors(colors);

// Custom format for console output
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(
    (info) => `${info.timestamp} [${info.level}]: ${info.message}`
  )
);

// Custom format for file output
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.json()
);

// Determine transports based on environment
const createTransports = () => {
  const transports = [];

  // Always log to console
  transports.push(
    new winston.transports.Console({
      format: consoleFormat,
      level: config.NODE_ENV === 'production' ? 'info' : 'debug',
    })
  );

  // Log to files in production/staging
  if (config.NODE_ENV !== 'development') {
    const logDir = config.LOG_DIR || './logs';
    
    // Error log
    transports.push(
      new winston.transports.File({
        filename: path.join(logDir, 'error.log'),
        level: 'error',
        format: fileFormat,
        maxsize: 5242880, // 5MB
        maxFiles: 5,
      })
    );

    // Combined log
    transports.push(
      new winston.transports.File({
        filename: path.join(logDir, 'combined.log'),
        format: fileFormat,
        maxsize: 5242880,
        maxFiles: 5,
      })
    );

    // HTTP access log
    transports.push(
      new winston.transports.File({
        filename: path.join(logDir, 'access.log'),
        level: 'http',
        format: fileFormat,
        maxsize: 5242880,
        maxFiles: 5,
      })
    );
  }

  return transports;
};

// Create the logger
const logger = winston.createLogger({
  level: config.LOG_LEVEL || 'info',
  levels,
  format: winston.format.combine(
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.metadata(),
    winston.format.timestamp()
  ),
  transports: createTransports(),
  exitOnError: false,
});

// Create a stream for Morgan (HTTP request logging)
export const stream = {
  write: (message) => {
    logger.http(message.trim());
  },
};

// Export logger methods
export const logError = (message, meta = {}) => {
  logger.error(message, meta);
};

export const logWarn = (message, meta = {}) => {
  logger.warn(message, meta);
};

export const logInfo = (message, meta = {}) => {
  logger.info(message, meta);
};

export const logDebug = (message, meta = {}) => {
  logger.debug(message, meta);
};

export const logHttp = (message, meta = {}) => {
  logger.http(message, meta);
};

// Create a child logger with context
export const createLogger = (context) => {
  return logger.child({ context });
};

export default logger;