// src/config/cors.js
import logger from '../utils/logger.js';

/**
 * Cross-origin policy, in one place.
 *
 * `CORS_ORIGIN` arrives here **as an array** — `config/env.js` splits it on commas
 * — and that detail decides whether anything works. The `cors` package treats the
 * string `'*'` as "allow any origin", but treats anything else, an array included,
 * as an exact-match list: a request whose origin is not in the list gets no
 * `Access-Control-Allow-Origin` header at all, and the browser reports a CORS
 * failure. The environment default is `'*'`, which the split turns into `['*']`,
 * and no real origin ever equals the string `'*'`.
 *
 * So an unset `CORS_ORIGIN` — the value that reads as "allow everything" — refused
 * *every* origin in production, while development passed because it does not go
 * through this configuration at all (`app.js` uses a bare `cors()` there). That is
 * why a wrong value only ever shows up after a deploy.
 *
 * Verified against cors 2.8.6 (`lib/index.js`): `configureOrigin` reflects the
 * request origin when the resolved value is the boolean `true`, and
 * `isOriginAllowed` compares each array entry with `===`.
 */

/** What "any origin" looks like before the environment value is split. */
export const ANY_ORIGIN = '*';

/** Where an `https://host` with a trailing slash comes from — and it never matches. */
const TRAILING_SLASHES = /\/+$/;

/** Origins already reported, so the log carries one line each instead of one per request. */
const reported = new Set();
const REPORT_LIMIT = 20;

/**
 * `https://x.vercel.app/` and `https://x.vercel.app` are the same origin.
 *
 * A browser's `Origin` header never carries a trailing slash, so a configured one
 * is a value that can never match. `.env.local` had exactly that.
 *
 * @param {String} value
 * @returns {String}
 */
export const normaliseOrigin = (value) => String(value ?? '').trim().replace(TRAILING_SLASHES, '');

/**
 * The configured value as a clean, de-duplicated list of origins.
 *
 * @param {String|String[]} value raw `CORS_ORIGIN`
 * @returns {String[]}
 */
export const normaliseOrigins = (value) => {
  const list = Array.isArray(value) ? value : String(value ?? '').split(',');
  return [...new Set(list.map(normaliseOrigin).filter(Boolean))];
};

/** True when the configuration asks for every origin. */
export const allowsAnyOrigin = (value) => normaliseOrigins(value).includes(ANY_ORIGIN);

/**
 * The options the `cors` middleware wants.
 *
 * A configured `*` becomes the boolean `true`, which makes the package reflect the
 * requesting origin. It cannot be the string `'*'` whenever credentials are on:
 * browsers reject a wildcard `Access-Control-Allow-Origin` on a credentialed
 * request, so the reflection is the only correct way to combine the two.
 *
 * @param {Object} input
 * @param {String|String[]} input.origin raw `CORS_ORIGIN`
 * @param {Boolean} [input.credentials]
 * @param {Number} [input.maxAge]
 * @returns {Object} options for `cors()`
 */
export const buildCorsOptions = ({ origin, credentials = false, maxAge } = {}) => {
  const origins = normaliseOrigins(origin);

  return {
    origin: allowsAnyOrigin(origins) ? (credentials ? true : ANY_ORIGIN) : origins,
    credentials,
    maxAge,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    exposedHeaders: ['X-Total-Count', 'X-Page-Total'],
  };
};

/** True when a request from this origin would be allowed. */
export const isOriginAllowed = (requestOrigin, value) => {
  const origins = normaliseOrigins(value);
  if (allowsAnyOrigin(origins)) return true;

  return origins.includes(normaliseOrigin(requestOrigin));
};

/**
 * Name the origin that was refused, once.
 *
 * Without this the only evidence is a browser console message and a support
 * message; with it the host's log says which origin to add to `CORS_ORIGIN` and
 * what the allow-list currently holds. Capped so a scan of invented origins cannot
 * fill the log.
 *
 * @param {String} requestOrigin value of the request's `Origin` header
 * @param {String|String[]} configured raw `CORS_ORIGIN`
 */
export const reportRefusedOrigin = (requestOrigin, configured) => {
  const origin = normaliseOrigin(requestOrigin);
  if (!origin || reported.has(origin) || reported.size >= REPORT_LIMIT) return;

  reported.add(origin);
  logger.warn(
    { origin, allowedOrigins: normaliseOrigins(configured) },
    'CORS: refused an origin that is not in CORS_ORIGIN — add it verbatim (no trailing slash)'
  );
};

/**
 * The allow-list in one line, for the boot log. A deploy that refuses every
 * cross-origin request should say so while someone is still watching the log.
 *
 * @param {String|String[]} configured raw `CORS_ORIGIN`
 * @returns {String}
 */
export const describeOrigins = (configured) => {
  const origins = normaliseOrigins(configured);

  if (allowsAnyOrigin(origins)) return 'any origin (CORS_ORIGIN is "*")';

  if (origins.length === 0) {
    return 'nothing — every cross-origin request will be refused (CORS_ORIGIN is empty)';
  }

  return origins.join(', ');
};

/**
 * Express middleware that only *reports* a refused origin. It sets no headers and
 * decides nothing: the `cors` middleware stays the single authority on the policy,
 * and it keeps emitting `Vary: Origin` for origins it refuses.
 */
export const warnOnRefusedOrigin = (configured) => (req, res, next) => {
  const origin = req.headers.origin;
  if (origin && !isOriginAllowed(origin, configured)) {
    reportRefusedOrigin(origin, configured);
  }

  next();
};

export default {
  ANY_ORIGIN,
  normaliseOrigin,
  normaliseOrigins,
  allowsAnyOrigin,
  buildCorsOptions,
  isOriginAllowed,
  reportRefusedOrigin,
  describeOrigins,
  warnOnRefusedOrigin,
};
