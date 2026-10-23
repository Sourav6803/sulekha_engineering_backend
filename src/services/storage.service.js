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
export const deleteFromCloudinary = async (publicId, resourceType) => {
  if (!publicId) return false;

  /*
   * Cloudinary needs the resource type to destroy an asset, and it will not
   * guess: a video destroyed as an image is reported as not found. Callers that
   * know the type pass it; the rest keep the original image → raw fallback.
   */
  const types = resourceType ? [resourceType, 'image', 'raw', 'video'] : ['image', 'raw', 'video'];

  for (const type of [...new Set(types)]) {
    try {
      await cloudinary.uploader.destroy(publicId, { resource_type: type, invalidate: true });
      return true;
    } catch {
      // try the next type
    }
  }
  return false;
};

/**
 * Upload bytes that are already in memory.
 *
 * Used where the file must not touch the container's disk — a showcase video, an
 * image read for its dimensions — so there is no temporary file to leak if the
 * request dies halfway.
 */
export const uploadBufferToCloudinary = (buffer, options = {}) =>
  new Promise((resolve, reject) => {
    if (!config.CLOUDINARY_CLOUD_NAME || !config.CLOUDINARY_API_KEY || !config.CLOUDINARY_API_SECRET) {
      reject(new Error('Cloudinary credentials are not configured'));
      return;
    }

    const stream = cloudinary.uploader.upload_stream(
      {
        folder: options.folder || config.CLOUDINARY_FOLDER,
        public_id: options.public_id,
        resource_type: options.resourceType || 'auto',
      },
      (error, result) => {
        if (error || !result) {
          reject(error || new Error('Cloudinary upload failed'));
          return;
        }
        resolve({
          url: result.secure_url,
          publicId: result.public_id,
          bytes: result.bytes,
          format: result.format,
          resourceType: result.resource_type,
          width: result.width,
          height: result.height,
          durationSeconds: result.duration,
        });
      }
    );

    stream.end(buffer);
  });

export default {
  uploadToCloudinary,
  uploadToCloudinaryDetailed,
  uploadBufferToCloudinary,
  deleteFromCloudinary,
};
