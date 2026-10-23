// src/controllers/showcase.controller.js
import config from '../config/env.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import { uploadBufferToCloudinary } from '../services/storage.service.js';
import * as showcaseService from '../services/showcase.service.js';

/**
 * HTTP layer for project stories. Everything here is thin: the shape of a story,
 * what the public may see and how paging is clamped live in the service.
 */

const folderFor = (name) => `${config.CLOUDINARY_FOLDER || 'sulekha'}/${name}`;

// ===========================================================================
// PUBLIC
// ===========================================================================

export const list = async (req, res) => {
  const { items, pagination } = await showcaseService.listPublic(req.query);
  return ApiResponse.sendPaginated(res, items, pagination, 'Projects fetched');
};

export const getBySlug = async (req, res) => {
  const project = await showcaseService.getPublicBySlug(req.params.slug);
  return ApiResponse.send(res, project, 'Project fetched');
};

export const summary = async (_req, res) => {
  const data = await showcaseService.summary();
  return ApiResponse.send(res, data, 'Showcase summary fetched');
};

// ===========================================================================
// ADMIN
// ===========================================================================

export const adminList = async (req, res) => {
  const { items, pagination, counts } = await showcaseService.listAdmin(req.query);

  // Draft/published totals ride alongside the page: the list screen shows them
  // as filter tabs, and a second request just to count would be wasteful.
  const payload = ApiResponse.paginated(items, pagination, 'Projects fetched');
  payload.counts = counts;

  return res.status(200).json(payload);
};

export const adminGet = async (req, res) => {
  const project = await showcaseService.getByIdAdmin(req.params.id);
  return ApiResponse.send(res, project, 'Project fetched');
};

export const create = async (req, res) => {
  const project = await showcaseService.create(req.body, req.user);
  return ApiResponse.sendCreated(res, project, 'Project created');
};

export const update = async (req, res) => {
  const project = await showcaseService.update(req.params.id, req.body, req.user);
  return ApiResponse.send(res, project, 'Project updated');
};

export const remove = async (req, res) => {
  const result = await showcaseService.remove(req.params.id, req.user);
  return ApiResponse.send(res, result, 'Project removed');
};

export const publish = async (req, res) => {
  const project = await showcaseService.setPublished(req.params.id, req.body.isPublished, req.user);
  return ApiResponse.send(
    res,
    project,
    req.body.isPublished ? 'Project published' : 'Project unpublished'
  );
};

// ===========================================================================
// MEDIA
// ===========================================================================

/**
 * Attach one item to a project's gallery.
 *
 * Two ways in, one endpoint:
 *  - `multipart/form-data` with a `file` part — a photograph or a short clip,
 *    uploaded to Cloudinary and referenced by URL from then on;
 *  - JSON with a `url` — a film that already lives on YouTube/Drive, embedded
 *    rather than copied.
 */
export const addMedia = async (req, res) => {
  const body = req.body || {};
  const items = [];

  if (req.file) {
    const isVideo = String(req.file.mimetype || '').startsWith('video/');
    const uploaded = await uploadBufferToCloudinary(req.file.buffer, {
      folder: folderFor('showcase'),
      resourceType: isVideo ? 'video' : 'image',
    });

    items.push({
      kind: isVideo ? 'video' : 'image',
      url: uploaded.url,
      publicId: uploaded.publicId,
      provider: 'cloudinary',
      width: uploaded.width,
      height: uploaded.height,
      durationSeconds: uploaded.durationSeconds,
      caption: body.caption || undefined,
    });
  }

  if (body.url) {
    items.push({
      kind: body.kind || 'image',
      url: body.url,
      provider: body.provider || 'other',
      thumbnailUrl: body.thumbnailUrl || undefined,
      caption: body.caption || undefined,
      width: body.width,
      height: body.height,
      durationSeconds: body.durationSeconds,
      order: body.order,
    });
  }

  if (items.length === 0) {
    throw ApiError.badRequest('Send a file (multipart) or a url to media that is already hosted');
  }

  const media = await showcaseService.addMedia(req.params.id, items, req.user);
  return ApiResponse.sendCreated(res, media, 'Media added');
};

export const removeMedia = async (req, res) => {
  const media = await showcaseService.removeMedia(req.params.id, req.params.mediaId, req.user);
  return ApiResponse.send(res, media, 'Media removed');
};

/** Replace the card image in one step (upload, then point the project at it). */
export const uploadCover = async (req, res) => {
  if (!req.file) throw ApiError.badRequest('An image file is required');

  const uploaded = await uploadBufferToCloudinary(req.file.buffer, {
    folder: folderFor('showcase'),
    resourceType: 'image',
  });

  const project = await showcaseService.update(
    req.params.id,
    { coverImage: { url: uploaded.url, publicId: uploaded.publicId } },
    req.user
  );

  return ApiResponse.send(res, project, 'Cover image updated');
};
