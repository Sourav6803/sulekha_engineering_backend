// src/services/chromeLaunch.js
import fs from 'node:fs';
import puppeteer from 'puppeteer';
import config from '../config/env.js';
import logger from '../utils/logger.js';
import {
  LOCAL_CHROME_CACHE,
  EXISTING_CHROME_PATHS,
  adoptLocalCacheIfPresent,
  cacheDir,
  findCachedChrome,
} from '../config/chromeCache.js';

/**
 * Where Chrome comes from and how it is started, in one place.
 *
 * Every document type renders through the same browser, and getting these flags
 * wrong is not a per-document bug — it takes the whole renderer down at once, so
 * the three callers shared the same mistake. `pdfBrowser.js` read
 * `config.PUPPETEER_LAUNCH_ARGS || [defaults]`, but the config layer always hands
 * back a non-empty array (its .env default is the two sandbox flags), so the
 * right-hand side never ran and `--disable-dev-shm-usage` was never passed. That
 * flag is the one that matters off a laptop: a container with the stock 64 MB
 * /dev/shm cannot lay out an A4 sheet in that budget, and Chrome dies partway
 * through rather than refusing to start. Windows has no /dev/shm, which is why
 * every sheet rendered locally and none rendered from the server.
 */

/**
 * Flags Chrome needs on a server, whatever the deployment asked for. Merged under
 * the configured list so `PUPPETEER_LAUNCH_ARGS` can still add to them.
 */
export const REQUIRED_LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--font-render-hinting=none',
];

/**
 * Where a host may already keep Chrome: the paths the common server images
 * install it to, plus a developer's own browser. The canonical list lives in
 * `config/chromeCache.js`, which the postinstall installer also reads, so the two
 * can never drift apart.
 */
export const SYSTEM_CHROME_PATHS = EXISTING_CHROME_PATHS;

/*
 * Adopt the browser the deploy carried with it, before anything asks where Chrome
 * is. This only does something when that cache is actually populated — a machine
 * whose browser is in the default `~/.cache/puppeteer` is left alone.
 * `chromeCache.js` explains why the location matters.
 */
adoptLocalCacheIfPresent();

/**
 * Resolved once per process: the browser does not move while the server is up,
 * and this is called on every launch — logging the choice each time would bury
 * the log in repetitions.
 *
 * Note that `puppeteer.executablePath()` is asynchronous in Puppeteer 23 and
 * later. Treating it as a string made it always look absent, so the download it
 * reports was never found and every launch silently fell through to Puppeteer's
 * own lookup.
 *
 * @type {Promise<String|undefined>|null}
 */
let resolvedPathPromise = null;

/**
 * The browser binary to launch, or undefined to let Puppeteer decide.
 *
 * Order: an explicit `PUPPETEER_EXECUTABLE_PATH` that actually exists, then
 * Puppeteer's own download, then the distro locations above. A configured path
 * that is not on disk is skipped rather than fatal, so a value left over from
 * another host cannot take the renderer down on this one — and the choice is
 * logged once, because on a host with no shell access the service log is the
 * only place a failed deploy can be diagnosed from.
 *
 * @returns {Promise<String|undefined>}
 */
export const resolveExecutablePath = async () => {
  if (resolvedPathPromise) return resolvedPathPromise;

  resolvedPathPromise = (async () => {
    const configured = config.PUPPETEER_EXECUTABLE_PATH;
    if (configured && fs.existsSync(configured)) {
      logger.info({ executablePath: configured }, 'PDF: using the configured Chrome');
      return configured;
    }
    if (configured) {
      logger.warn(
        { executablePath: configured },
        'PDF: PUPPETEER_EXECUTABLE_PATH is set but not on disk; falling back'
      );
    }

    try {
      const bundled = await puppeteer.executablePath();
      if (bundled && fs.existsSync(bundled)) {
        logger.info({ executablePath: bundled }, 'PDF: using the Chrome Puppeteer downloaded');
        return bundled;
      }
    } catch (error) {
      // Thrown when no browser has been downloaded; the distro paths may still work.
      logger.warn({ err: error.message }, 'PDF: Puppeteer has no browser of its own');
    }

    /*
     * The build id moves whenever Puppeteer is upgraded, so a browser left in the
     * cache by an earlier version is not the path Puppeteer computes above — yet it
     * is still a browser that can print an A4 sheet. Rendering is worth more than
     * version purity, so it is used and the mismatch is logged.
     */
    const cached = findCachedChrome();
    if (cached) {
      logger.warn(
        { executablePath: cached, cacheDir: cacheDir() },
        'PDF: using a browser from the cache — Puppeteer’s pinned build is missing'
      );
      return cached;
    }

    for (const candidate of SYSTEM_CHROME_PATHS) {
      if (fs.existsSync(candidate)) {
        logger.info({ executablePath: candidate }, 'PDF: using the system Chrome');
        return candidate;
      }
    }

    logger.warn(
      { platform: process.platform, cwd: process.cwd() },
      'PDF: no Chrome found; falling back to Puppeteer’s own lookup'
    );
    return undefined;
  })();

  // A failed resolution must not be cached as permanent: a later attempt after a
  // fresh install should be able to find the browser.
  resolvedPathPromise = resolvedPathPromise.catch((error) => {
    resolvedPathPromise = null;
    throw error;
  });

  return resolvedPathPromise;
};

/** Drops the memoised resolution, so the next call looks again. */
export const forgetResolvedExecutablePath = () => {
  resolvedPathPromise = null;
};

/** The configured flags plus the ones a server cannot do without. */
export const launchArgs = (extra = []) => [
  ...new Set([
    ...(Array.isArray(config.PUPPETEER_LAUNCH_ARGS) ? config.PUPPETEER_LAUNCH_ARGS : []),
    ...REQUIRED_LAUNCH_ARGS,
    ...extra,
  ]),
];

/** Launch options shared by every document renderer. */
export const buildLaunchOptions = async ({ extraArgs = [], headless = true } = {}) => ({
  headless,
  executablePath: await resolveExecutablePath(),
  ignoreHTTPSErrors: true,
  args: launchArgs(extraArgs),
});

/**
 * What the renderer found, for a health check or a support request. Read-only and
 * cheap: it resolves paths and reads the filesystem but never launches anything.
 */
export const describeChrome = async () => ({
  platform: process.platform,
  nodeVersion: process.version,
  configuredPath: config.PUPPETEER_EXECUTABLE_PATH || null,
  configuredPathExists: Boolean(
    config.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(config.PUPPETEER_EXECUTABLE_PATH)
  ),
  resolvedPath: (await resolveExecutablePath()) || null,
  launchArgs: launchArgs(),
  systemChrome: SYSTEM_CHROME_PATHS.filter((candidate) => fs.existsSync(candidate)),
  /**
   * The project's own cache — the one the deploy carries with it, and the one
   * that is empty when a host builds and runs in different filesystems. Reported
   * beside `resolvedPath` so a missing browser can be told apart from a mispointed
   * one. Named for the project rather than "cacheDir" because Puppeteer falls back
   * to `~/.cache/puppeteer` when nothing has been adopted, and that is not this.
   */
  projectCacheDir: cacheDir(),
  projectCacheBinary: findCachedChrome(LOCAL_CHROME_CACHE),
});

export default {
  buildLaunchOptions,
  resolveExecutablePath,
  forgetResolvedExecutablePath,
  launchArgs,
  describeChrome,
};
