// src/controllers/banner.controller.js
import config from '../config/env.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import { uploadBufferToCloudinary } from '../services/storage.service.js';
import * as bannerService from '../services/banner.service.js';

/** Artwork for the public site: official scheme banners and campaign banners. */

const folderFor = (name) => `${config.CLOUDINARY_FOLDER || 'sulekha'}/${name}`;

// ===========================================================================
// PUBLIC
// ===========================================================================

export const list = async (req, res) => {
  const data = await bannerService.listPublic(req.query);
  return ApiResponse.send(res, data, 'Banners fetched');
};

// ===========================================================================
// ADMIN
// ===========================================================================

export const adminList = async (req, res) => {
  const data = await bannerService.listAdmin(req.query);
  return ApiResponse.send(res, data, 'Banners fetched');
};

export const create = async (req, res) => {
  const banner = await bannerService.create(req.body, req.user);
  return ApiResponse.sendCreated(res, banner, 'Banner created');
};

export const update = async (req, res) => {
  const banner = await bannerService.update(req.params.id, req.body, req.user);
  return ApiResponse.send(res, banner, 'Banner updated');
};

export const setActive = async (req, res) => {
  const banner = await bannerService.setActive(req.params.id, req.body.isActive);
  return ApiResponse.send(res, banner, req.body.isActive ? 'Banner switched on' : 'Banner switched off');
};

export const reorder = async (req, res) => {
  const data = await bannerService.reorder(req.body.ids);
  return ApiResponse.send(res, data, 'Banner order saved');
};

export const remove = async (req, res) => {
  const result = await bannerService.remove(req.params.id, req.user);
  return ApiResponse.send(res, result, 'Banner removed');
};

/**
 * Upload the artwork first, then send the returned url in the create/update body.
 *
 * Splitting it this way means a failed upload cannot leave a half-created banner,
 * and the same file can be reused for two placements without being uploaded twice.
 */
export const uploadImage = async (req, res) => {
  if (!req.file) throw ApiError.badRequest('An image file is required');

  const uploaded = await uploadBufferToCloudinary(req.file.buffer, {
    folder: folderFor('banners'),
    resourceType: 'image',
  });

  return ApiResponse.sendCreated(
    res,
    {
      url: uploaded.url,
      publicId: uploaded.publicId,
      width: uploaded.width,
      height: uploaded.height,
      bytes: uploaded.bytes,
    },
    'Image uploaded'
  );
};
