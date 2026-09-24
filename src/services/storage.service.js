import { v2 as cloudinary } from 'cloudinary';
import config from '../config/env.js';

cloudinary.config({
  cloud_name: config.CLOUDINARY_CLOUD_NAME,
  api_key: config.CLOUDINARY_API_KEY,
  api_secret: config.CLOUDINARY_API_SECRET,
  secure: true,
});

export const uploadToCloudinary = async (file, options = {}) => {
  if (!config.CLOUDINARY_CLOUD_NAME || !config.CLOUDINARY_API_KEY || !config.CLOUDINARY_API_SECRET) {
    throw new Error('Cloudinary credentials are not configured');
  }

  const result = await cloudinary.uploader.upload(file.path, {
    folder: options.folder || config.CLOUDINARY_FOLDER,
    public_id: options.public_id,
    resource_type: 'auto',
  });

  return result.secure_url;
};

/**
 * Same as uploadToCloudinary but returns the full Cloudinary result so callers
 * can keep the public_id and clean the asset up later. Additive: existing
 * callers keep using uploadToCloudinary and its string return value.
 */
export const uploadToCloudinaryDetailed = async (file, options = {}) => {
  if (!config.CLOUDINARY_CLOUD_NAME || !config.CLOUDINARY_API_KEY || !config.CLOUDINARY_API_SECRET) {
    throw new Error('Cloudinary credentials are not configured');
  }

  const result = await cloudinary.uploader.upload(file.path, {
    folder: options.folder || config.CLOUDINARY_FOLDER,
    public_id: options.public_id,
    resource_type: 'auto',
  });

  return {
    url: result.secure_url,
    publicId: result.public_id,
    bytes: result.bytes,
    format: result.format,
    resourceType: result.resource_type,
  };
};

/**
 * Best-effort delete of a previously uploaded asset. Never throws: a failure
 * here must not roll back a database change.
 */
export const deleteFromCloudinary = async (publicId) => {
  if (!publicId) return false;
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: 'image', invalidate: true });
    return true;
  } catch {
    try {
      await cloudinary.uploader.destroy(publicId, { resource_type: 'raw', invalidate: true });
      return true;
    } catch {
      return false;
    }
  }
};

export default { uploadToCloudinary, uploadToCloudinaryDetailed, deleteFromCloudinary };
