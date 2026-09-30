// src/config/chromeCache.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Where the browser lives.
 *
 * Puppeteer downloads Chrome into `~/.cache/puppeteer` by default. On a laptop
 * that is fine — the process that downloads the browser and the process that
 * uses it are the same filesystem. On a host that builds and then runs in
 * *different* filesystems it is not: Render's native Node runtime carries only the
 * project directory across, so the browser is present while the build runs and
 * gone when the service starts. Every PDF route then answers
 * 503 `PDF_RENDERER_UNAVAILABLE` with Chrome's own "Could not find Chrome …" in
 * `details.reason`, while the HTML routes (which the user's own browser prints)
 * keep working.
 *
 * So the browser is kept inside the project instead: `<project>/.cache/puppeteer`.
 * `src/tools/ensure-chrome.mjs` installs it there from `postinstall`, and this
 * module is how the running server finds it again.
 *
 * Deliberately free of app imports (`config/env.js`, `utils/logger.js`): the
 * postinstall script has to use it during a build, before the application
 * environment has been validated.
 */

/** `<backend>/` — this file sits at `<backend>/src/config/chromeCache.js`. */
export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The cache that survives a build, because it lives inside the project. */
export const LOCAL_CHROME_CACHE = path.join(PROJECT_ROOT, '.cache', 'puppeteer');

/**
 * Browsers a host may already carry, so there is nothing to download. The Linux
 * entries are the ones a container image installs for itself; the Windows and
 * macOS entries are a developer's own Chrome, which is what keeps `npm install`
 * on a laptop from fetching a second copy of the browser.
 */
export const EXISTING_CHROME_PATHS = [
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

/** The cache Puppeteer is currently pointed at. */
export const cacheDir = () => process.env.PUPPETEER_CACHE_DIR || LOCAL_CHROME_CACHE;

const readdir = (dir) => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
};

/**
 * The first browser binary inside a cache directory, or null.
 *
 * Puppeteer lays a download out as `<cache>/chrome/<buildId>/<inner>/chrome`,
 * e.g. `chrome/linux-151.0.7922.71/chrome-linux64/chrome` or
 * `chrome/win64-151.0.7922.71/chrome-win64/chrome.exe`. The build id is the part
 * that moves when Puppeteer is upgraded, so the scan is deliberately
 * version-agnostic: a cache populated by an older Puppeteer is still a browser
 * that can print a sheet.
 *
 * @param {String} [dir] cache directory (defaults to the configured one)
 * @returns {String|null} absolute path to the browser, or null
 */
export const findCachedChrome = (dir = cacheDir()) => {
  const root = path.join(dir, 'chrome');

  for (const build of readdir(root)) {
    if (!build.isDirectory()) continue;

    const buildDir = path.join(root, build.name);
    for (const inner of readdir(buildDir)) {
      if (!inner.isDirectory()) continue;

      for (const binary of ['chrome', 'chrome.exe']) {
        const candidate = path.join(buildDir, inner.name, binary);
        try {
          if (fs.existsSync(candidate)) return candidate;
        } catch {
          /* unreadable entry — try the next one */
        }
      }
    }
  }

  return null;
};

/**
 * Point Puppeteer at the project's own cache, but only when that cache really
 * holds a browser.
 *
 * Unconditional overriding would be worse than doing nothing: a developer whose
 * browser is already in `~/.cache/puppeteer` would start looking somewhere empty.
 * An explicit `PUPPETEER_CACHE_DIR` always wins — that is how a host that manages
 * the browser itself keeps control.
 *
 * `puppeteer.executablePath()` reads this variable when it is called rather than
 * when the module is imported, so setting it here — after the imports have run —
 * is in time.
 *
 * @returns {Boolean} true when the variable was adopted
 */
export const adoptLocalCacheIfPresent = () => {
  if (process.env.PUPPETEER_CACHE_DIR) return false;
  if (!findCachedChrome(LOCAL_CHROME_CACHE)) return false;

  process.env.PUPPETEER_CACHE_DIR = LOCAL_CHROME_CACHE;
  return true;
};

export default {
  PROJECT_ROOT,
  LOCAL_CHROME_CACHE,
  EXISTING_CHROME_PATHS,
  cacheDir,
  findCachedChrome,
  adoptLocalCacheIfPresent,
};
