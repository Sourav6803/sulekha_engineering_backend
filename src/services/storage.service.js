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

export default { uploadToCloudinary };
