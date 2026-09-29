// src/services/documentStorage.service.js
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import config from '../config/env.js';
import logger from '../utils/logger.js';
import { uploadToCloudinaryDetailed, deleteFromCloudinary } from './storage.service.js';

/**
 * Where an application document physically lives.
 *
 * Cloudinary is the intended home: a container filesystem is wiped on every
 * redeploy, so Aadhaar scans kept on disk would silently disappear from a live
 * system. When Cloudinary is not configured (local development, a first run
 * before the keys are set) the file is written to UPLOAD_DIR instead and served
 * by the static handler, so the flow is still testable end to end.
 */

const CLOUDINARY_CONFIGURED = () =>
  Boolean(config.CLOUDINARY_CLOUD_NAME && config.CLOUDINARY_API_KEY && config.CLOUDINARY_API_SECRET);

const DOCUMENT_ROOT = path.join(config.UPLOAD_DIR || './uploads', 'applications');

const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

/**
 * @param {{ buffer?: Buffer, path?: string, originalname: string, mimetype: string, size: number }} file
 * @param {{ folder?: string, applicationNo?: string }} [options]
 * @returns {Promise<{ url: string, publicId: string|null, provider: 'cloudinary'|'local', bytes: number, fileName: string }>}
 */
export const storeDocument = async (file, options = {}) => {
  const folder = options.folder || 'sulekha/applications';
  const fileName = file.originalname;

  if (CLOUDINARY_CONFIGURED()) {
    // Multer's memory storage hands us a buffer; the Cloudinary SDK uploads a
    // path, so a temporary file bridges the two.
    if (file.buffer) {
      const tempDir = path.join(config.UPLOAD_DIR || './uploads', 'tmp');
      ensureDir(tempDir);
      const tempPath = path.join(tempDir, `${uuidv4()}${path.extname(file.originalname) || ''}`);
      fs.writeFileSync(tempPath, file.buffer);

      try {
        const result = await uploadToCloudinaryDetailed(
          { path: tempPath },
          { folder, public_id: undefined }
        );

        return {
          url: result.url,
          publicId: result.publicId,
          provider: 'cloudinary',
          bytes: result.bytes ?? file.size,
          fileName,
        };
      } finally {
        fs.rmSync(tempPath, { force: true });
      }
    }

    const result = await uploadToCloudinaryDetailed(file, { folder, public_id: undefined });
    return {
      url: result.url,
      publicId: result.publicId,
      provider: 'cloudinary',
      bytes: result.bytes ?? file.size,
      fileName,
    };
  }

  // ------------------------------------------------------------- local fallback
  if (!file.buffer && file.path) {
    // Already on disk (multer diskStorage) — just report where it landed.
    return {
      url: `/uploads/applications/${path.basename(file.path)}`,
      publicId: null,
      provider: 'local',
      bytes: file.size,
      fileName,
    };
  }

  ensureDir(DOCUMENT_ROOT);
  const safeBase = String(file.originalname)
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9]/g, '_')
    .slice(0, 60);
  const stored = `${safeBase || 'document'}_${Date.now()}_${uuidv4().slice(0, 8)}${path.extname(file.originalname) || ''}`;
  const destination = path.join(DOCUMENT_ROOT, stored);

  fs.writeFileSync(destination, file.buffer);

  logger.warn(
    { provider: 'local', destination },
    'Cloudinary is not configured — application document kept on local disk (lost on redeploy)'
  );

  return {
    url: `/uploads/applications/${stored}`,
    publicId: null,
    provider: 'local',
    bytes: file.size,
    fileName,
  };
};

/**
 * Best-effort removal. Never throws: losing the blob must not roll back a
 * database change the operator already saw succeed.
 */
export const removeDocument = async (doc) => {
  if (!doc) return false;

  if (doc.publicId) return deleteFromCloudinary(doc.publicId);

  if (doc.url && doc.url.startsWith('/uploads/')) {
    try {
      const relative = doc.url.replace(/^\/uploads\//, '');
      const target = path.join(config.UPLOAD_DIR || './uploads', relative);
      fs.rmSync(target, { force: true });
      return true;
    } catch {
      return false;
    }
  }

  return false;
};

export default { storeDocument, removeDocument };
