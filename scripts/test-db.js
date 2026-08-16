// scripts/test-db.js
import { connectDB } from '../src/config/db.js';
import logger from '../src/utils/logger.js';

async function testConnection() {
  try {
    await connectDB();
    logger.info('✅ Database connected successfully');
    process.exit(0);
  } catch (error) {
    logger.error('❌ Database connection failed:', error.message);
    process.exit(1);
  }
}

testConnection();