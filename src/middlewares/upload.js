// src/middlewares/upload.js
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { ApiError } from '../utils/ApiError.js';
import config from '../config/env.js';
import logger from '../utils/logger.js';

// Ensure upload directory exists
const ensureUploadDir = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

// Storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let uploadPath = config.UPLOAD_DIR || './uploads';
    
    // Determine subfolder based on file type
    if (file.fieldname === 'invoice') {
      uploadPath = path.join(uploadPath, 'invoices');
    } else if (file.fieldname === 'image') {
      uploadPath = path.join(uploadPath, 'images');
    } else if (file.fieldname === 'document') {
      uploadPath = path.join(uploadPath, 'documents');
    } else {
      uploadPath = path.join(uploadPath, 'others');
    }

    ensureUploadDir(uploadPath);
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    // Generate unique filename with timestamp and random ID
    const timestamp = Date.now();
    const randomId = uuidv4().substring(0, 8);
    const extension = path.extname(file.originalname);
    const baseName = path.basename(file.originalname, extension);
    const sanitizedName = baseName.replace(/[^a-zA-Z0-9]/g, '_');
    const filename = `${sanitizedName}_${timestamp}_${randomId}${extension}`;
    cb(null, filename);
  },
});

// File filter
const fileFilter = (req, file, cb) => {
  const allowedTypes = config.ALLOWED_FILE_TYPES || [
    'image/jpeg',
    'image/png',
    'image/jpg',
    'application/pdf',
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new ApiError(
        400,
        `Invalid file type. Allowed types: ${allowedTypes.join(', ')}`,
        'INVALID_FILE_TYPE'
      ),
      false
    );
  }
};

// Create multer instance
const multerConfig = {
  storage,
  fileFilter,
  limits: {
    fileSize: config.MAX_FILE_SIZE || 5 * 1024 * 1024, // 5MB default
    files: 10, // Max 10 files per request
  },
};

const upload = multer(multerConfig);

// ============================================
// UPLOAD MIDDLEWARES
// ============================================

/**
 * Single file upload
 * Usage: uploadSingle('fieldname')
 */
export const uploadSingle = (fieldName) => {
  return (req, res, next) => {
    upload.single(fieldName)(req, res, (err) => {
      if (err) {
        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            return next(
              ApiError.badRequest(`File too large. Max size: ${config.MAX_FILE_SIZE / 1024 / 1024}MB`)
            );
          }
          if (err.code === 'LIMIT_UNEXPECTED_FILE') {
            return next(ApiError.badRequest(`Unexpected file field: ${err.field}`));
          }
          return next(ApiError.badRequest(`Upload error: ${err.message}`));
        }
        return next(err);
      }
      next();
    });
  };
};

/**
 * Multiple file upload
 * Usage: uploadMultiple('fieldname', maxCount)
 */
export const uploadMultiple = (fieldName, maxCount = 5) => {
  return (req, res, next) => {
    upload.array(fieldName, maxCount)(req, res, (err) => {
      if (err) {
        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            return next(
              ApiError.badRequest(`File too large. Max size: ${config.MAX_FILE_SIZE / 1024 / 1024}MB`)
            );
          }
          if (err.code === 'LIMIT_UNEXPECTED_FILE') {
            return next(ApiError.badRequest(`Unexpected file field: ${err.field}`));
          }
          if (err.code === 'LIMIT_FILE_COUNT') {
            return next(ApiError.badRequest(`Too many files. Max: ${maxCount}`));
          }
          return next(ApiError.badRequest(`Upload error: ${err.message}`));
        }
        return next(err);
      }
      next();
    });
  };
};

/**
 * Multiple fields upload
 * Usage: uploadFields([{ name: 'field1', maxCount: 1 }, { name: 'field2', maxCount: 3 }])
 */
export const uploadFields = (fields) => {
  return (req, res, next) => {
    upload.fields(fields)(req, res, (err) => {
      if (err) {
        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            return next(
              ApiError.badRequest(`File too large. Max size: ${config.MAX_FILE_SIZE / 1024 / 1024}MB`)
            );
          }
          if (err.code === 'LIMIT_UNEXPECTED_FILE') {
            return next(ApiError.badRequest(`Unexpected file field: ${err.field}`));
          }
          return next(ApiError.badRequest(`Upload error: ${err.message}`));
        }
        return next(err);
      }
      next();
    });
  };
};

/**
 * Memory storage for files (for cloud upload)
 */
const memoryStorage = multer.memoryStorage();

export const uploadToMemory = multer({
  storage: memoryStorage,
  fileFilter,
  limits: {
    fileSize: config.MAX_FILE_SIZE || 5 * 1024 * 1024,
    files: 10,
  },
});

export default upload;