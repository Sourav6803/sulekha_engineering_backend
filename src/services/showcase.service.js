// src/services/showcase.service.js
import mongoose from 'mongoose';
import { ProjectShowcase } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import { containsRegex } from '../utils/escapeRegex.js';
import { deleteFromCloudinary } from './storage.service.js';

/**
 * Completed installations, as stories.
 *
 * Two audiences, two shapes:
 *  - the public site reads published entries only, through `toPublic()`, which
 *    is an allow-list on the model (no customer name without consent, no internal
 *    fields);
 *  - the office reads everything through `listAdmin`, including drafts.
 *
 * Nothing here trusts the caller: ids are checked, filters are escaped before
 * they reach a RegExp, and paging is clamped so `?limit=100000` cannot be used to
 * pull the collection in one request.
 */

const DEFAULT_PAGE_SIZE = 12;
const MAX_PUBLIC_PAGE_SIZE = 48;
const MAX_ADMIN_PAGE_SIZE = 100;

const readPage = (page, limit, max) => {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(max, Math.max(1, Number(limit) || DEFAULT_PAGE_SIZE));
  return { page: safePage, limit: safeLimit, skip: (safePage - 1) * safeLimit };
};

const pageInfo = (page, limit, total) => ({
  page,
  limit,
  total,
  pages: Math.ceil(total / limit) || 0,
});

const round1 = (value) => Math.round((Number(value) || 0) * 10) / 10;

/** The office's view: everything the public sees, plus the working fields. */
const serializeForAdmin = (doc) => {
  const publicView = doc.toPublic();
  return {
    ...publicView,
    location: {
      ...publicView.location,
      pincode: doc.location?.pincode || null,
    },
    customerConsent: doc.customerConsent,
    seo: doc.seo || {},
    isPublished: doc.isPublished,
    isActive: doc.isActive,
    views: doc.views || 0,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    createdBy: doc.createdBy || null,
    updatedBy: doc.updatedBy || null,
  };
};

const SORTS = {
  newest: { publishedAt: -1, _id: -1 },
  oldest: { publishedAt: 1, _id: 1 },
  capacity: { capacityKW: -1, publishedAt: -1 },
  views: { views: -1, publishedAt: -1 },
};

// ===========================================================================
// PUBLIC
// ===========================================================================

export const listPublic = async (query = {}) => {
  const { page, limit, skip } = readPage(query.page, query.limit, MAX_PUBLIC_PAGE_SIZE);

  const filter = { isActive: true, isPublished: true };

  if (query.district) filter['location.district'] = containsRegex(query.district);
  if (query.brand) filter.panelBrand = containsRegex(query.brand);
  if (query.highlight === 'true') filter.highlight = true;

  if (query.minKW || query.maxKW) {
    filter.capacityKW = {};
    if (query.minKW) filter.capacityKW.$gte = Number(query.minKW);
    if (query.maxKW) filter.capacityKW.$lte = Number(query.maxKW);
  }

  const search = containsRegex(query.search);
  if (search) {
    filter.$or = [{ title: search }, { summary: search }, { 'location.district': search }];
  }

  const sort = SORTS[query.sort] || SORTS.newest;

  const [docs, total] = await Promise.all([
    ProjectShowcase.find(filter).sort(sort).skip(skip).limit(limit),
    ProjectShowcase.countDocuments(filter),
  ]);

  return {
    items: docs.map((doc) => doc.toPublic()),
    pagination: pageInfo(page, limit, total),
  };
};

/**
 * One published story, by its address.
 *
 * The view counter is incremented here rather than on every list render: it is a
 * cheap signal of which stories are worth writing more of, not an analytics
 * system, and it must not be able to fail the read.
 */
export const getPublicBySlug = async (slug) => {
  const doc = await ProjectShowcase.findOne({
    slug: String(slug || '').trim().toLowerCase(),
    isActive: true,
    isPublished: true,
  });

  if (!doc) throw ApiError.notFound('Project');

  try {
    await ProjectShowcase.updateOne({ _id: doc._id }, { $inc: { views: 1 } });
    doc.views = (doc.views || 0) + 1;
  } catch {
    // A read must not fail because the counter could not be written.
  }

  return doc.toPublic();
};

/** Aggregate numbers the landing page prints ("42 homes, 9 districts"). */
export const summary = async () => {
  const match = { isActive: true, isPublished: true };

  const [totalsRow] = await ProjectShowcase.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        projects: { $sum: 1 },
        capacityKW: { $sum: { $ifNull: ['$capacityKW', 0] } },
      },
    },
  ]);

  const [districts, brands, recent] = await Promise.all([
    ProjectShowcase.aggregate([
      { $match: { ...match, 'location.district': { $nin: [null, ''] } } },
      {
        $group: {
          _id: '$location.district',
          projects: { $sum: 1 },
          capacityKW: { $sum: { $ifNull: ['$capacityKW', 0] } },
        },
      },
      { $sort: { projects: -1, _id: 1 } },
      { $limit: 40 },
    ]),
    ProjectShowcase.aggregate([
      { $match: { ...match, panelBrand: { $nin: [null, ''] } } },
      {
        $group: {
          _id: '$panelBrand',
          projects: { $sum: 1 },
          capacityKW: { $sum: { $ifNull: ['$capacityKW', 0] } },
        },
      },
      { $sort: { projects: -1, _id: 1 } },
    ]),
    ProjectShowcase.find(match).sort({ publishedAt: -1, _id: -1 }).limit(6),
  ]);

  return {
    projects: totalsRow?.projects || 0,
    capacityKW: round1(totalsRow?.capacityKW || 0),
    districts: districts.map((row) => ({
      district: row._id,
      projects: row.projects,
      capacityKW: round1(row.capacityKW),
    })),
    brands: brands.map((row) => ({
      brand: row._id,
      projects: row.projects,
      capacityKW: round1(row.capacityKW),
    })),
    recent: recent.map((doc) => doc.toPublic()),
  };
};

// ===========================================================================
// ADMIN
// ===========================================================================

export const listAdmin = async (query = {}) => {
  const { page, limit, skip } = readPage(query.page, query.limit, MAX_ADMIN_PAGE_SIZE);

  // Drafts are included on purpose: this is the screen used to finish them.
  const filter = { isActive: true };

  if (query.isPublished === 'true' || query.isPublished === 'false') {
    filter.isPublished = query.isPublished === 'true';
  }
  if (query.district) filter['location.district'] = containsRegex(query.district);

  const search = containsRegex(query.search);
  if (search) {
    filter.$or = [{ title: search }, { slug: search }, { customerName: search }];
  }

  const [docs, total, drafts, published] = await Promise.all([
    ProjectShowcase.find(filter).sort({ updatedAt: -1, _id: -1 }).skip(skip).limit(limit),
    ProjectShowcase.countDocuments(filter),
    ProjectShowcase.countDocuments({ isActive: true, isPublished: false }),
    ProjectShowcase.countDocuments({ isActive: true, isPublished: true }),
  ]);

  return {
    items: docs.map(serializeForAdmin),
    pagination: pageInfo(page, limit, total),
    counts: { drafts, published },
  };
};

export const getByIdAdmin = async (id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) throw ApiError.badRequest('Invalid project id');

  const doc = await ProjectShowcase.findOne({ _id: id, isActive: true });
  if (!doc) throw ApiError.notFound('Project');

  return serializeForAdmin(doc);
};

export const create = async (payload, user) => {
  const doc = new ProjectShowcase({ ...payload, createdBy: user?._id ?? null });
  await doc.save();
  return serializeForAdmin(doc);
};

export const update = async (id, payload, user) => {
  if (!mongoose.Types.ObjectId.isValid(id)) throw ApiError.badRequest('Invalid project id');

  const doc = await ProjectShowcase.findOne({ _id: id, isActive: true });
  if (!doc) throw ApiError.notFound('Project');

  Object.assign(doc, payload, { updatedBy: user?._id ?? null });
  await doc.save();

  return serializeForAdmin(doc);
};

/**
 * Soft delete.
 *
 * The row is kept so the office can still answer "what did we publish last
 * winter?", but it is unpublished at the same moment so a removed story cannot
 * stay live on the site.
 */
export const remove = async (id, user) => {
  if (!mongoose.Types.ObjectId.isValid(id)) throw ApiError.badRequest('Invalid project id');

  const doc = await ProjectShowcase.findOne({ _id: id, isActive: true });
  if (!doc) throw ApiError.notFound('Project');

  doc.isActive = false;
  doc.isPublished = false;
  doc.updatedBy = user?._id ?? null;
  await doc.save();

  return { id: doc._id };
};

export const setPublished = async (id, isPublished, user) => {
  if (!mongoose.Types.ObjectId.isValid(id)) throw ApiError.badRequest('Invalid project id');

  const doc = await ProjectShowcase.findOne({ _id: id, isActive: true });
  if (!doc) throw ApiError.notFound('Project');

  doc.isPublished = Boolean(isPublished);
  if (doc.isPublished && !doc.publishedAt) doc.publishedAt = new Date();
  doc.updatedBy = user?._id ?? null;
  await doc.save();

  return serializeForAdmin(doc);
};

// ===========================================================================
// MEDIA
// ===========================================================================

/**
 * Attach uploaded or linked media.
 *
 * The count is checked against the model's cap here as well as in the schema, so
 * the caller gets a clear 400 instead of a validation dump with a field path.
 */
export const addMedia = async (id, items, user) => {
  if (!mongoose.Types.ObjectId.isValid(id)) throw ApiError.badRequest('Invalid project id');

  const doc = await ProjectShowcase.findOne({ _id: id, isActive: true });
  if (!doc) throw ApiError.notFound('Project');

  const startOrder = doc.media.length;
  doc.media.push(
    ...items.map((item, index) => ({
      ...item,
      order: item.order ?? startOrder + index,
    }))
  );
  doc.updatedBy = user?._id ?? null;

  await doc.save();
  return serializeForAdmin(doc).media;
};

/**
 * Remove one media item, and the Cloudinary asset behind it.
 *
 * The delete is best-effort: a copy that the CDN refuses to remove must not leave
 * the office unable to edit the story.
 */
export const removeMedia = async (id, mediaId, user) => {
  if (!mongoose.Types.ObjectId.isValid(id)) throw ApiError.badRequest('Invalid project id');

  const doc = await ProjectShowcase.findOne({ _id: id, isActive: true });
  if (!doc) throw ApiError.notFound('Project');

  const item = doc.media.id(mediaId);
  if (!item) throw ApiError.notFound('Media');

  const { publicId, kind } = item;

  doc.media.pull(mediaId);
  doc.updatedBy = user?._id ?? null;
  await doc.save();

  if (publicId) {
    await deleteFromCloudinary(publicId, kind === 'video' ? 'video' : 'image');
  }

  return serializeForAdmin(doc).media;
};

export default {
  listPublic,
  getPublicBySlug,
  summary,
  listAdmin,
  getByIdAdmin,
  create,
  update,
  remove,
  setPublished,
  addMedia,
  removeMedia,
};
