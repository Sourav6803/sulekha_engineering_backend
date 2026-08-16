// src/config/env.js
import dotenv from 'dotenv';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables based on NODE_ENV
const envFile = process.env.NODE_ENV === 'production'
  ? '.env.production'
  : process.env.NODE_ENV === 'staging'
    ? '.env.staging'
    : '.env.development';

const envFiles = [
  '.env',
  envFile,
  '.env.local',
];

const loadedEnvFiles = [];

for (const file of envFiles) {
  const filePath = path.resolve(__dirname, '../../', file);
  if (fs.existsSync(filePath)) {
    dotenv.config({ path: filePath, override: true });
    loadedEnvFiles.push(file);
  }
}

if (loadedEnvFiles.length > 0) {
  console.log(`Loaded environment variables from: ${loadedEnvFiles.join(', ')}`);
} else {
  console.warn('No environment file loaded. Check that .env or the environment-specific file exists.');
}

// Define validation schema
const envSchema = z.object({
  // Application
  NODE_ENV: z.enum(['development', 'staging', 'production', 'test']).default('development'),
  PORT: z.string().default('3000'),
  HOST: z.string().default('0.0.0.0'),
  APP_NAME: z.string().default('Sulekha Engineering'),
  API_VERSION: z.string().default('v1'),
  API_PREFIX: z.string().default('/api/v1'),

  // MongoDB
  MONGO_URI: z.string().min(1, 'MongoDB URI is required'),
  MONGO_READ_PREFERENCE: z.enum(['primary', 'secondary', 'primaryPreferred', 'secondaryPreferred']).default('primaryPreferred'),
  MONGO_MAX_POOL_SIZE: z.string().default('100'),
  MONGO_MIN_POOL_SIZE: z.string().default('10'),
  MONGO_CONNECT_TIMEOUT_MS: z.string().default('30000'),
  MONGO_SOCKET_TIMEOUT_MS: z.string().default('45000'),

  // Redis
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.string().default('6379'),
  REDIS_USERNAME: z.string().optional(),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: z.string().default('0'),
  REDIS_KEY_PREFIX: z.string().default('sulekha'),
  REDIS_CONNECT_TIMEOUT: z.string().default('10000'),
  REDIS_MAX_RETRIES: z.string().default('3'),
  REDIS_TLS: z.string().default('false'),

  // JWT
  JWT_SECRET: z.string().min(32, 'JWT secret must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),
  JWT_ALGORITHM: z.enum(['HS256', 'RS256']).default('HS256'),

  // Bcrypt
  BCRYPT_SALT_ROUNDS: z.string().default('10'),

  // CORS
  CORS_ORIGIN: z.string().default('*'),
  CORS_CREDENTIALS: z.string().default('true'),
  CORS_MAX_AGE: z.string().default('86400'),

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: z.string().default('900000'),
  RATE_LIMIT_MAX_REQUESTS: z.string().default('100'),
  RATE_LIMIT_SKIP_SUCCESSFUL: z.string().default('false'),

  // File Upload
  MAX_FILE_SIZE: z.string().default('5242880'),
  ALLOWED_FILE_TYPES: z.string().default('image/jpeg,image/png,image/jpg,application/pdf'),
  UPLOAD_DIR: z.string().default('./uploads'),

  // Cloudinary
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  CLOUDINARY_FOLDER: z.string().default('sulekha'),

  // AWS S3
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_REGION: z.string().default('ap-south-1'),
  AWS_S3_BUCKET: z.string().optional(),
  AWS_CDN_DOMAIN: z.string().optional(),

  // Email
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  EMAIL_ENABLED: z.string().default('false'),

  // SMS
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().optional(),
  SMS_ENABLED: z.string().default('false'),

  // BullMQ
  BULL_REDIS_HOST: z.string().default('localhost'),
  BULL_REDIS_PORT: z.string().default('6379'),
  BULL_REDIS_USERNAME: z.string().optional(),
  BULL_REDIS_PASSWORD: z.string().optional(),
  BULL_REDIS_DB: z.string().default('1'),
  BULL_PREFIX: z.string().default('bull'),
  BULL_STALLED_INTERVAL: z.string().default('30000'),
  BULL_MAX_STALLED_COUNT: z.string().default('3'),

  // Puppeteer
  PUPPETEER_EXECUTABLE_PATH: z.string().optional(),
  PUPPETEER_HEADLESS: z.string().default('true'),
  PUPPETEER_TIMEOUT: z.string().default('30000'),
  PUPPETEER_LAUNCH_ARGS: z.string().default('--no-sandbox,--disable-setuid-sandbox'),

  // Logging
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  LOG_FORMAT: z.enum(['json', 'simple']).default('json'),
  LOG_RETENTION_DAYS: z.string().default('30'),
  LOG_DIR: z.string().default('./logs'),

  // Monitoring
  PROMETHEUS_ENABLED: z.string().default('false'),
  PROMETHEUS_PORT: z.string().default('9090'),
  SENTRY_DSN: z.string().optional(),
  NEW_RELIC_LICENSE_KEY: z.string().optional(),

  // Feature Flags
  ENABLE_PDF_GENERATION: z.string().default('true'),
  ENABLE_EMAIL_NOTIFICATIONS: z.string().default('false'),
  ENABLE_SMS_NOTIFICATIONS: z.string().default('false'),
  ENABLE_AUDIT_LOGS: z.string().default('true'),
  ENABLE_BACKGROUND_JOBS: z.string().default('true'),
});

// Parse and validate environment variables
const envData = {
  // Application
  NODE_ENV: process.env.NODE_ENV,
  PORT: process.env.PORT,
  HOST: process.env.HOST,
  APP_NAME: process.env.APP_NAME,
  API_VERSION: process.env.API_VERSION,
  API_PREFIX: process.env.API_PREFIX,

  // MongoDB
  MONGO_URI: process.env.MONGO_URI,
  MONGO_READ_PREFERENCE: process.env.MONGO_READ_PREFERENCE,
  MONGO_MAX_POOL_SIZE: process.env.MONGO_MAX_POOL_SIZE,
  MONGO_MIN_POOL_SIZE: process.env.MONGO_MIN_POOL_SIZE,
  MONGO_CONNECT_TIMEOUT_MS: process.env.MONGO_CONNECT_TIMEOUT_MS,
  MONGO_SOCKET_TIMEOUT_MS: process.env.MONGO_SOCKET_TIMEOUT_MS,

  // Redis
  REDIS_HOST: process.env.REDIS_HOST,
  REDIS_PORT: process.env.REDIS_PORT,
  REDIS_PASSWORD: process.env.REDIS_PASSWORD,
  REDIS_DB: process.env.REDIS_DB,
  REDIS_KEY_PREFIX: process.env.REDIS_KEY_PREFIX,
  REDIS_CONNECT_TIMEOUT: process.env.REDIS_CONNECT_TIMEOUT,
  REDIS_MAX_RETRIES: process.env.REDIS_MAX_RETRIES,
  REDIS_TLS: process.env.REDIS_TLS,

  // JWT
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN,
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN,
  JWT_ALGORITHM: process.env.JWT_ALGORITHM,

  // Bcrypt
  BCRYPT_SALT_ROUNDS: process.env.BCRYPT_SALT_ROUNDS,

  // CORS
  CORS_ORIGIN: process.env.CORS_ORIGIN,
  CORS_CREDENTIALS: process.env.CORS_CREDENTIALS,
  CORS_MAX_AGE: process.env.CORS_MAX_AGE,

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: process.env.RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX_REQUESTS: process.env.RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_SKIP_SUCCESSFUL: process.env.RATE_LIMIT_SKIP_SUCCESSFUL,

  // File Upload
  MAX_FILE_SIZE: process.env.MAX_FILE_SIZE,
  ALLOWED_FILE_TYPES: process.env.ALLOWED_FILE_TYPES,
  UPLOAD_DIR: process.env.UPLOAD_DIR,

  // Cloudinary
  CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME,
  CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET,
  CLOUDINARY_FOLDER: process.env.CLOUDINARY_FOLDER,

  // AWS S3
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
  AWS_REGION: process.env.AWS_REGION,
  AWS_S3_BUCKET: process.env.AWS_S3_BUCKET,
  AWS_CDN_DOMAIN: process.env.AWS_CDN_DOMAIN,

  // Email
  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_PORT: process.env.SMTP_PORT,
  SMTP_USER: process.env.SMTP_USER,
  SMTP_PASSWORD: process.env.SMTP_PASSWORD,
  SMTP_FROM: process.env.SMTP_FROM,
  EMAIL_ENABLED: process.env.EMAIL_ENABLED,

  // SMS
  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
  TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER,
  SMS_ENABLED: process.env.SMS_ENABLED,

  // BullMQ
  BULL_REDIS_HOST: process.env.BULL_REDIS_HOST,
  BULL_REDIS_PORT: process.env.BULL_REDIS_PORT,
  BULL_REDIS_PASSWORD: process.env.BULL_REDIS_PASSWORD,
  BULL_REDIS_DB: process.env.BULL_REDIS_DB,
  BULL_PREFIX: process.env.BULL_PREFIX,
  BULL_STALLED_INTERVAL: process.env.BULL_STALLED_INTERVAL,
  BULL_MAX_STALLED_COUNT: process.env.BULL_MAX_STALLED_COUNT,

  // Puppeteer
  PUPPETEER_EXECUTABLE_PATH: process.env.PUPPETEER_EXECUTABLE_PATH,
  PUPPETEER_HEADLESS: process.env.PUPPETEER_HEADLESS,
  PUPPETEER_TIMEOUT: process.env.PUPPETEER_TIMEOUT,
  PUPPETEER_LAUNCH_ARGS: process.env.PUPPETEER_LAUNCH_ARGS,

  // Logging
  LOG_LEVEL: process.env.LOG_LEVEL,
  LOG_FORMAT: process.env.LOG_FORMAT,
  LOG_RETENTION_DAYS: process.env.LOG_RETENTION_DAYS,
  LOG_DIR: process.env.LOG_DIR,

  // Monitoring
  PROMETHEUS_ENABLED: process.env.PROMETHEUS_ENABLED,
  PROMETHEUS_PORT: process.env.PROMETHEUS_PORT,
  SENTRY_DSN: process.env.SENTRY_DSN,
  NEW_RELIC_LICENSE_KEY: process.env.NEW_RELIC_LICENSE_KEY,

  // Feature Flags
  ENABLE_PDF_GENERATION: process.env.ENABLE_PDF_GENERATION,
  ENABLE_EMAIL_NOTIFICATIONS: process.env.ENABLE_EMAIL_NOTIFICATIONS,
  ENABLE_SMS_NOTIFICATIONS: process.env.ENABLE_SMS_NOTIFICATIONS,
  ENABLE_AUDIT_LOGS: process.env.ENABLE_AUDIT_LOGS,
  ENABLE_BACKGROUND_JOBS: process.env.ENABLE_BACKGROUND_JOBS,
};

// Validate and parse environment variables
let config;
try {
  const validated = envSchema.parse(envData);
  
  // Convert string values to appropriate types
  config = {
    ...validated,
    PORT: parseInt(validated.PORT, 10),
    MONGO_MAX_POOL_SIZE: parseInt(validated.MONGO_MAX_POOL_SIZE, 10),
    MONGO_MIN_POOL_SIZE: parseInt(validated.MONGO_MIN_POOL_SIZE, 10),
    MONGO_CONNECT_TIMEOUT_MS: parseInt(validated.MONGO_CONNECT_TIMEOUT_MS, 10),
    MONGO_SOCKET_TIMEOUT_MS: parseInt(validated.MONGO_SOCKET_TIMEOUT_MS, 10),
    REDIS_PORT: parseInt(validated.REDIS_PORT, 10),
    REDIS_DB: parseInt(validated.REDIS_DB, 10),
    REDIS_CONNECT_TIMEOUT: parseInt(validated.REDIS_CONNECT_TIMEOUT, 10),
    REDIS_MAX_RETRIES: parseInt(validated.REDIS_MAX_RETRIES, 10),
    BCRYPT_SALT_ROUNDS: parseInt(validated.BCRYPT_SALT_ROUNDS, 10),
    RATE_LIMIT_WINDOW_MS: parseInt(validated.RATE_LIMIT_WINDOW_MS, 10),
    RATE_LIMIT_MAX_REQUESTS: parseInt(validated.RATE_LIMIT_MAX_REQUESTS, 10),
    MAX_FILE_SIZE: parseInt(validated.MAX_FILE_SIZE, 10),
    CORS_MAX_AGE: parseInt(validated.CORS_MAX_AGE, 10),
    BULL_REDIS_PORT: parseInt(validated.BULL_REDIS_PORT, 10),
    BULL_REDIS_DB: parseInt(validated.BULL_REDIS_DB, 10),
    BULL_STALLED_INTERVAL: parseInt(validated.BULL_STALLED_INTERVAL, 10),
    BULL_MAX_STALLED_COUNT: parseInt(validated.BULL_MAX_STALLED_COUNT, 10),
    PUPPETEER_TIMEOUT: parseInt(validated.PUPPETEER_TIMEOUT, 10),
    LOG_RETENTION_DAYS: parseInt(validated.LOG_RETENTION_DAYS, 10),
    PROMETHEUS_PORT: parseInt(validated.PROMETHEUS_PORT, 10),
    // Convert boolean strings
    CORS_CREDENTIALS: validated.CORS_CREDENTIALS === 'true',
    RATE_LIMIT_SKIP_SUCCESSFUL: validated.RATE_LIMIT_SKIP_SUCCESSFUL === 'true',
    EMAIL_ENABLED: validated.EMAIL_ENABLED === 'true',
    SMS_ENABLED: validated.SMS_ENABLED === 'true',
    PROMETHEUS_ENABLED: validated.PROMETHEUS_ENABLED === 'true',
    ENABLE_PDF_GENERATION: validated.ENABLE_PDF_GENERATION === 'true',
    ENABLE_EMAIL_NOTIFICATIONS: validated.ENABLE_EMAIL_NOTIFICATIONS === 'true',
    ENABLE_SMS_NOTIFICATIONS: validated.ENABLE_SMS_NOTIFICATIONS === 'true',
    ENABLE_AUDIT_LOGS: validated.ENABLE_AUDIT_LOGS === 'true',
    ENABLE_BACKGROUND_JOBS: validated.ENABLE_BACKGROUND_JOBS === 'true',
    PUPPETEER_HEADLESS: validated.PUPPETEER_HEADLESS === 'true',
    REDIS_TLS: validated.REDIS_TLS === 'true',
    // Split arrays
    ALLOWED_FILE_TYPES: validated.ALLOWED_FILE_TYPES.split(',').map(s => s.trim()),
    CORS_ORIGIN: validated.CORS_ORIGIN.split(',').map(s => s.trim()),
    PUPPETEER_LAUNCH_ARGS: validated.PUPPETEER_LAUNCH_ARGS.split(',').map(s => s.trim()),
  };
} catch (error) {
  console.error('❌ Environment validation failed:');
  console.error(error.errors.map(e => `  - ${e.path.join('.')}: ${e.message}`).join('\n'));
  process.exit(1);
}


// console.log("config-->", config)
// Export validated configuration
export default config;