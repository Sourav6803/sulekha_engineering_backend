// src/services/banner.service.js
import mongoose from 'mongoose';
import { SiteBanner } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import { deleteFromCloudinary } from './storage.service.js';

/**
 * Artwork on the public site.
 *
 * The public read returns only what a browser needs, grouped by placement, and
 * only banners that are active *and* inside their date window. Scheduling is
 * therefore a property of the data: a festival banner can be added in advance and
 * stops appearing by itself.
 */

const PLACEMENTS = ['home_hero', 'scheme_strip', 'home_popup', 'footer', 'other'];

/** The window test, expressed in Mongo so it runs before any document is fetched. */
const liveWindow = () => {
  const now = new Date();
  return [
    { $or: [{ startsAt: { $exists: false } }, { startsAt: null }, { startsAt: { $lte: now } }] },
    { $or: [{ endsAt: { $exists: false } }, { endsAt: null }, { endsAt: { $gte: now } }] },
  ];
};

export const listPublic = async (query = {}) => {
  const filter = { isActive: true };
  if (query.placement) filter.placement = query.placement;

  const docs = await SiteBanner.find({
    ...filter,
    $and: liveWindow(),
  }).sort({ placement: 1, order: 1, createdAt: -1 });

  const byPlacement = {};
  for (const doc of docs) {
    if (!byPlacement[doc.placement]) byPlacement[doc.placement] = [];
    byPlacement[doc.placement].push(doc.toPublic());
  }

  return { byPlacement, all: docs.map((doc) => doc.toPublic()) };
};

export const listAdmin = async (query = {}) => {
  const filter = {};
  if (query.placement) filter.placement = query.placement;
  if (query.isActive === 'true' || query.isActive === 'false') {
    filter.isActive = query.isActive === 'true';
  }

  const docs = await SiteBanner.find(filter).sort({ placement: 1, order: 1, createdAt: -1 });

  return {
    items: docs.map((doc) => ({ ...doc.toPublic(), isActive: doc.isActive, startsAt: doc.startsAt, endsAt: doc.endsAt })),
    placements: PLACEMENTS,
  };
};

const assertPlacement = (placement) => {
  if (placement && !PLACEMENTS.includes(placement)) {
    throw ApiError.badRequest(`Unknown placement. Use one of: ${PLACEMENTS.join(', ')}`);
  }
};

export const create = async (payload, user) => {
  assertPlacement(payload.placement);

  const doc = new SiteBanner({ ...payload, createdBy: user?._id ?? null });
  await doc.save();

  return doc.toPublic();
};

export const update = async (id, payload, user) => {
  if (!mongoose.Types.ObjectId.isValid(id)) throw ApiError.badRequest('Invalid banner id');
  assertPlacement(payload.placement);

  const doc = await SiteBanner.findById(id);
  if (!doc) throw ApiError.notFound('Banner');

  const previousPublicId = doc.publicId;
  Object.assign(doc, payload, { updatedBy: user?._id ?? null });
  await doc.save();

  // Replacing the artwork leaves the old asset behind otherwise.
  if (previousPublicId && doc.publicId && previousPublicId !== doc.publicId) {
    await deleteFromCloudinary(previousPublicId, 'image');
  }

  return doc.toPublic();
};

/** Switching a banner off, rather than deleting it: seasonal artwork comes back. */
export const setActive = async (id, isActive) => {
  if (!mongoose.Types.ObjectId.isValid(id)) throw ApiError.badRequest('Invalid banner id');

  const doc = await SiteBanner.findById(id);
  if (!doc) throw ApiError.notFound('Banner');

  doc.isActive = Boolean(isActive);
  await doc.save();

  return { ...doc.toPublic(), isActive: doc.isActive };
};

/** Persist a drag-and-drop order in one call. */
export const reorder = async (ids) => {
  if (!Array.isArray(ids) || ids.length === 0) throw ApiError.badRequest('An ordered list of ids is required');

  await Promise.all(
    ids.map((id, index) =>
      mongoose.Types.ObjectId.isValid(id)
        ? SiteBanner.updateOne({ _id: id }, { $set: { order: index } })
        : Promise.resolve()
    )
  );

  return listAdmin({});
};

export const remove = async (id, user) => {
  if (!mongoose.Types.ObjectId.isValid(id)) throw ApiError.badRequest('Invalid banner id');

  const doc = await SiteBanner.findById(id);
  if (!doc) throw ApiError.notFound('Banner');

  // A printed QR banner may still point here, so the row and its artwork stay
  // until someone deliberately removes them; it simply stops being served.
  doc.isActive = false;
  doc.updatedBy = user?._id ?? null;
  await doc.save();

  return { id: doc._id };
};

export default { listPublic, listAdmin, create, update, setActive, reorder, remove, PLACEMENTS };
