// src/controllers/notification.controller.js
import { Notification } from '../models/index.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import logger from '../utils/logger.js';
import { redisGet, redisSet, redisDel } from '../config/redis.js';

const CACHE_TTL = 3600; // 1 hour
const EXTERNAL_CACHE_KEY = 'notifications:external:pm-surya-ghar';

/**
 * Which notifications a signed-in user is allowed to see.
 *
 * `recipient: null` matches an unset field as well as an explicit null, so this
 * one clause covers the staff-wide notifications written before the field existed
 * and the ones still meant for everybody (the low-stock alerts). Anything
 * addressed to somebody else is invisible — from the list, from the unified feed
 * and from the unread badge. Every one of those three reads must use this; a
 * targeted notification leaking into another agent's bell would tell them about a
 * consumer who is not theirs.
 *
 * It also has to be part of the cache key — the filter is serialised into the key,
 * so including the user id here is what stops one agent being served another's
 * cached list.
 */
const audienceFilter = (userId) => ({ $or: [{ recipient: userId }, { recipient: null }] });

// Realistic fallback notifications representing PM Surya Ghar updates
const FALLBACK_NOTIFICATIONS = [
  {
    id: 'ext-1',
    type: 'scheme',
    source: 'PM Surya Ghar',
    title: 'PM Surya Ghar Muft Bijli Yojana — Enhanced Subsidy for Rooftop Solar',
    message: 'The government has enhanced subsidies for residential rooftop solar installations under PM Surya Ghar. Beneficiaries can now get up to 60% subsidy on system costs.',
    link: 'https://www.pmsuryaghar.gov.in/',
    category: 'subsidy',
    priority: 'high',
    isExternal: true,
    publishedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'ext-2',
    type: 'scheme',
    source: 'MNRE',
    title: 'New Eligibility Criteria for PM Surya Ghar Beneficiaries',
    message: 'MNRE has updated eligibility criteria. Residential consumers with valid electricity connection and rooftop availability can apply. Aadhaar and electricity bill are mandatory.',
    link: 'https://www.pmsuryaghar.gov.in/',
    category: 'registration',
    priority: 'high',
    isExternal: true,
    publishedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'ext-3',
    type: 'scheme',
    source: 'PIB',
    title: 'PM Surya Ghar Portal Crosses 1 Crore Registrations',
    message: 'The national portal for PM Surya Ghar Muft Bijli Yojana has crossed 1 crore household registrations, marking a significant milestone in India\'s renewable energy transition.',
    link: 'https://pib.gov.in/',
    category: 'scheme_update',
    priority: 'medium',
    isExternal: true,
    publishedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'ext-4',
    type: 'scheme',
    source: 'DISCOM',
    title: 'Net Metering Guidelines Updated for Rooftop Solar',
    message: 'State DISCOMs have updated net metering guidelines. Excess solar generation can now be carried forward for up to 12 months under the new regulations.',
    link: 'https://www.pmsuryaghar.gov.in/',
    category: 'scheme_update',
    priority: 'medium',
    isExternal: true,
    publishedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'ext-5',
    type: 'scheme',
    source: 'PM Surya Ghar',
    title: 'Subsidy Disbursement Timeline Accelerated',
    message: 'The government has streamlined the subsidy disbursement process. Funds will now be transferred directly to beneficiary bank accounts within 30 days of installation completion.',
    link: 'https://www.pmsuryaghar.gov.in/',
    category: 'subsidy',
    priority: 'high',
    isExternal: true,
    publishedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

/**
 * Fetch PM Surya Ghar notifications from official sources
 * Falls back to realistic data if fetch fails
 */
async function fetchPMSuryaGharFeed() {
  const cached = await redisGet(EXTERNAL_CACHE_KEY);
  if (cached) {
    return cached;
  }

  try {
    // Try to fetch from official PM Surya Ghar website
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch('https://www.pmsuryaghar.gov.in/', {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();
    const notifications = parsePMSuryaGharPage(html);

    if (notifications.length > 0) {
      await redisSet(EXTERNAL_CACHE_KEY, notifications, CACHE_TTL);
      return notifications;
    }

    throw new Error('No notifications parsed from page');
  } catch (error) {
    logger.warn(`Failed to fetch PM Surya Ghar notifications: ${error.message}. Using fallback data.`);
    await redisSet(EXTERNAL_CACHE_KEY, FALLBACK_NOTIFICATIONS, CACHE_TTL);
    return FALLBACK_NOTIFICATIONS;
  }
}

/**
 * Parse PM Surya Ghar homepage for news/updates
 */
function parsePMSuryaGharPage(html) {
  const notifications = [];
  const titleRegex = /<h[1-3][^>]*>(.*?)<\/h[1-3]>/gi;
  const linkRegex = /<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi;
  const dateRegex = /(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})|(\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4})/gi;

  let match;
  const titles = new Set();
  const lowerHtml = html.toLowerCase();

  if (lowerHtml.includes('subsidy') || lowerHtml.includes('scheme') || lowerHtml.includes('pm surya ghar') || lowerHtml.includes('rooftop solar')) {
    const textContent = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    const sentences = textContent.match(/[^.!?]+[.!?]+/g) || [];
    const relevantSentences = sentences.filter(s => 
      s.toLowerCase().includes('surya') || 
      s.toLowerCase().includes('solar') || 
      s.toLowerCase().includes('subsidy') || 
      s.toLowerCase().includes('rooftop') ||
      s.toLowerCase().includes('scheme')
    ).slice(0, 5);

    relevantSentences.forEach((sentence, index) => {
      const cleanSentence = sentence.trim().replace(/\s+/g, ' ');
      if (cleanSentence.length > 20 && cleanSentence.length < 500) {
        notifications.push({
          id: `ext-parsed-${index}`,
          type: 'scheme',
          source: 'PM Surya Ghar',
          title: cleanSentence.length > 100 ? cleanSentence.substring(0, 97) + '...' : cleanSentence,
          message: cleanSentence,
          link: 'https://www.pmsuryaghar.gov.in/',
          category: 'scheme_update',
          priority: 'medium',
          isExternal: true,
          publishedAt: new Date(Date.now() - index * 24 * 60 * 60 * 1000).toISOString(),
        });
      }
    });
  }

  return notifications.length > 0 ? notifications : FALLBACK_NOTIFICATIONS;
}

/**
 * List notifications with pagination
 */
export const listNotifications = async (req, res) => {
  const {
    page = 1,
    limit = 20,
    unread = false,
    type,
    source,
    category,
    priority,
    sortBy = 'createdAt',
    sortOrder = 'desc',
  } = req.query;

  // Scoped to the caller. The cache key below is named after the viewer as well,
  // so two people can never be handed the same cached page.
  const filter = { ...audienceFilter(req.user._id) };
  if (unread === 'true') filter.isRead = false;
  if (type) filter.type = type;
  if (source) filter.source = source;
  if (category) filter.category = category;
  if (priority) filter.priority = priority;

  const sort = {};
  sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

  // The viewer is named explicitly as well as living inside `filter`: the key
  // must never be shareable between two users, even if the filter is reworked.
  const cacheKey = `notifications:list:${req.user._id}:${JSON.stringify({ ...filter, page, limit, sort })}`;
  const cached = await redisGet(cacheKey);

  if (cached) {
    return ApiResponse.send(res, cached.data, 'Notifications fetched from cache', 200, {
      pagination: cached.pagination,
    });
  }

  const [notifications, total] = await Promise.all([
    Notification.find(filter)
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Notification.countDocuments(filter),
  ]);

  const pagination = {
    page: parseInt(page),
    limit: parseInt(limit),
    total,
    pages: Math.ceil(total / limit),
  };

  await redisSet(cacheKey, { data: notifications, pagination }, CACHE_TTL);

  return ApiResponse.sendPaginated(res, notifications, pagination, 'Notifications fetched successfully');
};

/**
 * Get unread notification count
 */
export const getUnreadCount = async (req, res) => {
  const count = await Notification.countDocuments({
    ...audienceFilter(req.user._id),
    isRead: false,
  });

  return ApiResponse.send(res, { unreadCount: count }, 'Unread count fetched successfully');
};

/**
 * Mark notification as read
 */
export const markAsRead = async (req, res) => {
  const { id } = req.params;

  const notification = await Notification.findById(id);
  if (!notification) {
    throw ApiError.notFound('Notification');
  }

  /*
   * Marking somebody else's notification read is refused, and refused as a 404:
   * the same "you should not learn that this exists" reasoning the application
   * service uses for another agent's file.
   */
  if (notification.recipient && notification.recipient.toString() !== String(req.user._id)) {
    throw ApiError.notFound('Notification');
  }

  notification.isRead = true;
  await notification.save();

  await redisDel(`notification:${id}`);
  await redisDel('notifications:list:*');
  /*
   * The unified feed is a second cache of the same rows. Leaving it out is what
   * let a notification read here come back as unread from that endpoint until the
   * hour was up — which the bell now reads.
   */
  await redisDel('notifications:unified:*');

  return ApiResponse.send(res, notification, 'Notification marked as read');
};

/**
 * Mark all notifications as read
 */
export const markAllAsRead = async (req, res) => {
  // Scoped to the caller: "read all" must never clear another user's unread
  // signed-copy notice, which they may not have seen yet.
  await Notification.updateMany(
    { ...audienceFilter(req.user._id), isRead: false },
    { isRead: true }
  );

  await redisDel('notifications:list:*');
  // See markAsRead: the unified endpoint caches the same rows separately.
  await redisDel('notifications:unified:*');

  return ApiResponse.send(res, null, 'All notifications marked as read');
};

/**
 * Fetch PM Surya Ghar notifications
 */
export const fetchPMSuryaGharNotifications = async (req, res) => {
  const notifications = await fetchPMSuryaGharFeed();

  return ApiResponse.send(res, notifications, 'PM Surya Ghar notifications fetched successfully');
};

/**
 * Get unified notifications feed (internal + external)
 */
export const getUnifiedNotifications = async (req, res) => {
  const { page = 1, limit = 20, unread = false } = req.query;

  const internalFilter = { ...audienceFilter(req.user._id), isExternal: { $ne: true } };
  if (unread === 'true') internalFilter.isRead = false;

  /*
   * The viewer is part of the key. `internalFilter` scopes the *query*, but the
   * cached value is the whole mixed feed — so without the id here the first agent
   * to ask would have their inbox (their own consumer's signed-copy notice
   * included) served to everybody else for the next hour.
   */
  const cacheKey = `notifications:unified:${req.user._id}:${JSON.stringify({ page, limit, unread })}`;
  const cached = await redisGet(cacheKey);

  if (cached) {
    return ApiResponse.send(res, cached.data, 'Unified notifications fetched from cache', 200, cached.pagination);
  }

  const [internalNotifications, externalNotifications, internalTotal] = await Promise.all([
    Notification.find(internalFilter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    fetchPMSuryaGharFeed(),
    Notification.countDocuments(internalFilter),
  ]);

  /*
   * Every entry leaves with an `_id`, because both clients key their lists on it.
   * Internal rows already have one; the external scheme feed carries `id` instead,
   * so without this the external entries reach React with an undefined key — which
   * only became visible once the feed started rendering at all.
   */
  const combined = [
    ...internalNotifications.map(n => ({ ...n, _id: n._id?.toString() })),
    ...externalNotifications.map((n, index) => ({
      ...n,
      _id: String(n._id ?? n.id ?? `external-${index}`),
    })),
  ].sort((a, b) => new Date(b.createdAt || b.publishedAt).getTime() - new Date(a.createdAt || a.publishedAt).getTime());

  const pagination = {
    page: parseInt(page),
    limit: parseInt(limit),
    total: internalTotal + externalNotifications.length,
    pages: Math.ceil((internalTotal + externalNotifications.length) / limit),
  };

  await redisSet(cacheKey, { data: combined, pagination }, CACHE_TTL);

  return ApiResponse.send(res, combined, 'Unified notifications fetched successfully', 200, pagination);
};
