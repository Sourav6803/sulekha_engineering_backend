// src/services/lead.service.js
import mongoose from 'mongoose';
import { Lead } from '../models/index.js';
import { LEAD_SOURCES, LEAD_STATUSES } from '../models/Lead.js';
import { ApiError } from '../utils/ApiError.js';
import { containsRegex } from '../utils/escapeRegex.js';
import { notifyOfficeOfNewLead } from './leadNotice.service.js';
import logger from '../utils/logger.js';

/**
 * Enquiries from the public site.
 *
 * The write path is public and therefore treated as hostile: the caller's payload
 * is stripped to the allowed fields by the validator before it reaches here, and
 * nothing in this file trusts a status, a note or an assignee from the outside.
 */

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/**
 * Two taps of the same button, or a second submit after a slow response, should
 * not become two enquiries that two people then call.
 */
const DUPLICATE_WINDOW_MS = 2 * 60 * 1000;

const readPage = (page, limit) => {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(limit) || DEFAULT_PAGE_SIZE));
  return { page: safePage, limit: safeLimit, skip: (safePage - 1) * safeLimit };
};

// ===========================================================================
// PUBLIC
// ===========================================================================

export const create = async (payload, meta = {}) => {
  const since = new Date(Date.now() - DUPLICATE_WINDOW_MS);
  const recent = await Lead.findOne({
    phone: payload.phone,
    isActive: true,
    createdAt: { $gte: since },
  }).select('_id');

  if (recent) {
    return { id: recent._id, duplicate: true };
  }

  /*
   * Attribution: an explicit source wins; otherwise a campaign tag on the URL is
   * enough to know the visit came from a printed banner's QR code.
   */
  const source = payload.source || (payload.utm?.campaign ? 'banner_qr' : 'website');

  const lead = await Lead.create({
    ...payload,
    source,
    userAgent: meta.userAgent ? String(meta.userAgent).slice(0, 300) : undefined,
    pagePath: meta.pagePath ? String(meta.pagePath).slice(0, 200) : undefined,
  });

  /*
   * Tell the office, in the app and by email.
   *
   * Deliberately not awaited: the visitor is standing at the form, and an SMTP
   * round trip must not make their submit button feel broken. The notice service
   * is already best-effort and never throws, so nothing can escape into the
   * response — but a rejected promise is still caught here so it cannot surface
   * as an unhandled rejection either.
   */
  notifyOfficeOfNewLead(lead).catch((error) => {
    logger.error({ leadId: String(lead._id), err: error.message }, 'Enquiry notice failed after save');
  });

  return { id: lead._id, duplicate: false };
};

// ===========================================================================
// ADMIN
// ===========================================================================

export const list = async (query = {}) => {
  const { page, limit, skip } = readPage(query.page, query.limit);

  const filter = { isActive: true };

  if (query.status) filter.status = query.status;
  if (query.source) filter.source = query.source;
  if (query.district) filter.district = containsRegex(query.district);
  if (query.assignedTo && mongoose.Types.ObjectId.isValid(query.assignedTo)) {
    filter.assignedTo = query.assignedTo;
  }

  if (query.from || query.to) {
    filter.createdAt = {};
    if (query.from) filter.createdAt.$gte = new Date(query.from);
    if (query.to) filter.createdAt.$lte = new Date(query.to);
  }

  const search = containsRegex(query.search);
  if (search) {
    filter.$or = [{ name: search }, { phone: search }, { email: search }, { district: search }];
  }

  const [docs, total, statusRows] = await Promise.all([
    Lead.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit),
    Lead.countDocuments(filter),
    Lead.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
  ]);

  const counts = LEAD_STATUSES.reduce((acc, status) => ({ ...acc, [status]: 0 }), {});
  for (const row of statusRows) counts[row._id] = row.count;

  return {
    items: docs.map((doc) => doc.toAdminJSON()),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) || 0 },
    counts,
  };
};

export const getById = async (id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) throw ApiError.badRequest('Invalid lead id');

  const doc = await Lead.findOne({ _id: id, isActive: true });
  if (!doc) throw ApiError.notFound('Lead');

  return doc.toAdminJSON();
};

export const updateStatus = async (id, status, user) => {
  if (!mongoose.Types.ObjectId.isValid(id)) throw ApiError.badRequest('Invalid lead id');
  if (!LEAD_STATUSES.includes(status)) {
    throw ApiError.badRequest(`Unknown status. Use one of: ${LEAD_STATUSES.join(', ')}`);
  }

  const doc = await Lead.findOne({ _id: id, isActive: true });
  if (!doc) throw ApiError.notFound('Lead');

  doc.status = status;
  if (status !== 'new' && !doc.contactedAt) doc.contactedAt = new Date();
  if (status === 'converted' && !doc.convertedAt) doc.convertedAt = new Date();
  if (user?._id) doc.assignedTo = doc.assignedTo || user._id;

  await doc.save();
  return doc.toAdminJSON();
};

export const addNote = async (id, text, user) => {
  if (!mongoose.Types.ObjectId.isValid(id)) throw ApiError.badRequest('Invalid lead id');

  const doc = await Lead.findOne({ _id: id, isActive: true });
  if (!doc) throw ApiError.notFound('Lead');

  doc.notes.push({
    text: String(text).slice(0, 500),
    by: user?._id ?? null,
    byName: user?.name ?? null,
  });

  await doc.save();
  return doc.toAdminJSON();
};

export const assign = async (id, userId, user) => {
  if (!mongoose.Types.ObjectId.isValid(id)) throw ApiError.badRequest('Invalid lead id');

  const doc = await Lead.findOne({ _id: id, isActive: true });
  if (!doc) throw ApiError.notFound('Lead');

  doc.assignedTo = mongoose.Types.ObjectId.isValid(userId) ? userId : null;
  await doc.save();
  return doc.toAdminJSON();
};

/** A small dashboard: what came in today, this week, and where from. */
export const stats = async () => {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [total, today, week, byStatus, bySource, byDistrict] = await Promise.all([
    Lead.countDocuments({ isActive: true }),
    Lead.countDocuments({ isActive: true, createdAt: { $gte: startOfToday } }),
    Lead.countDocuments({ isActive: true, createdAt: { $gte: weekAgo } }),
    Lead.aggregate([{ $match: { isActive: true } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    Lead.aggregate([{ $match: { isActive: true } }, { $group: { _id: '$source', count: { $sum: 1 } } }]),
    Lead.aggregate([
      { $match: { isActive: true, district: { $nin: [null, ''] } } },
      { $group: { _id: '$district', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),
  ]);

  return {
    total,
    today,
    week,
    byStatus: Object.fromEntries(byStatus.map((row) => [row._id, row.count])),
    bySource: Object.fromEntries(bySource.map((row) => [row._id, row.count])),
    byDistrict: byDistrict.map((row) => ({ district: row._id, count: row.count })),
    sources: LEAD_SOURCES,
    statuses: LEAD_STATUSES,
  };
};

export default { create, list, getById, updateStatus, addNote, assign, stats };
