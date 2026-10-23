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

/**
 * Single file into memory, with the same error mapping as uploadSingle.
 *
 * Application documents use this rather than disk storage: the clarity check
 * needs the bytes before anything is written, and the file may end up on
 * Cloudinary rather than on the container.
 *
 * Usage: uploadSingleToMemory('file')
 */
export const uploadSingleToMemory = (fieldName) => {
  return (req, res, next) => {
    uploadToMemory.single(fieldName)(req, res, (err) => {
      if (err) {
        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            return next(
              ApiError.badRequest(
                `File too large. Max size: ${(config.MAX_FILE_SIZE || 5 * 1024 * 1024) / 1024 / 1024}MB`
              )
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

// ============================================
// PUBLIC SITE MEDIA
// ============================================

/**
 * Photographs and short films for a project story, plus banner artwork.
 *
 * Kept apart from the shared `upload` above for two reasons: that filter is
 * deliberately narrow (a purchase invoice has no business being a video), and a
 * gallery clip needs a far larger limit than a document. Memory storage is used
 * on purpose — the bytes go straight to Cloudinary, so there is no temporary file
 * left behind on the container if the request dies halfway.
 */
const SHOWCASE_MAX_BYTES = 50 * 1024 * 1024; // 50 MB
const BANNER_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

const SHOWCASE_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const SHOWCASE_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];

const buildMemoryUploader = ({ allowed, maxBytes, label }) =>
  multer({
    storage: multer.memoryStorage(),
    fileFilter: (req, file, cb) => {
      if (allowed.includes(file.mimetype)) {
        cb(null, true);
        return;
      }
      cb(
        new ApiError(
          400,
          `Invalid ${label} type. Allowed: ${allowed.join(', ')}`,
          'INVALID_FILE_TYPE'
        ),
        false
      );
    },
    limits: { fileSize: maxBytes, files: 1 },
  });

const showcaseUploader = buildMemoryUploader({
  allowed: [...SHOWCASE_IMAGE_TYPES, ...SHOWCASE_VIDEO_TYPES],
  maxBytes: SHOWCASE_MAX_BYTES,
  label: 'media',
});

const bannerUploader = buildMemoryUploader({
  allowed: SHOWCASE_IMAGE_TYPES,
  maxBytes: BANNER_MAX_BYTES,
  label: 'image',
});

/** Wrap a single-file uploader with the same error mapping the rest of the app uses. */
const singleFile = (instance, field, maxBytes, label) => (req, res, next) => {
  instance.single(field)(req, res, (err) => {
    if (!err) return next();

    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(
          ApiError.badRequest(`${label} too large. Max size: ${Math.round(maxBytes / 1024 / 1024)}MB`)
        );
      }
      if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return next(ApiError.badRequest(`Unexpected file field: ${err.field}`));
      }
      return next(ApiError.badRequest(`Upload error: ${err.message}`));
    }

    return next(err);
  });
};

/** One image or one short video, as `multipart/form-data` under `file`. */
export const uploadShowcaseMedia = (fieldName = 'file') =>
  singleFile(showcaseUploader, fieldName, SHOWCASE_MAX_BYTES, 'File');

/** One image, as `multipart/form-data` under `image`. */
export const uploadBannerImage = (fieldName = 'image') =>
  singleFile(bannerUploader, fieldName, BANNER_MAX_BYTES, 'Image');

export default upload;