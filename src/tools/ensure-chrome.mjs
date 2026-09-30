#!/usr/bin/env node
// src/tools/ensure-chrome.mjs
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT, LOCAL_CHROME_CACHE, EXISTING_CHROME_PATHS, findCachedChrome } from '../config/chromeCache.js';

/**
 * Put the browser where the running server can still find it.
 *
 * Runs from `postinstall`. Puppeteer downloads Chrome into `~/.cache/puppeteer`
 * on its own, and on a host that builds and runs in different filesystems (Render's
 * native Node runtime) that download is gone by the time the service starts — the
 * PDF routes then answer 503 `PDF_RENDERER_UNAVAILABLE` ("Could not find Chrome")
 * while the HTML routes keep working. Installing into `<project>/.cache/puppeteer`
 * instead puts the browser somewhere that travels with the deploy;
 * `config/chromeCache.js` is what the server uses to find it again.
 *
 * It is a no-op when there is nothing to do: when the download is disabled by
 * configuration, when a browser is already in the cache, or when the host ships
 * one of its own.
 *
 * It never fails the install. A build that cannot reach the download endpoint
 * should still deploy — the renderer reports the problem precisely (503 with
 * Chrome's own message, and `GET /health/renderer` says what it can see) rather
 * than the deploy dying here.
 */

const log = (message) => console.log(`[chrome] ${message}`);

/** Nothing to do — exit successfully so `npm install` continues. */
const stop = (reason) => {
  log(`nothing to do — ${reason}`);
  process.exit(0);
};

if (process.env.PUPPETEER_SKIP_DOWNLOAD || process.env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD) {
  stop('PUPPETEER_SKIP_DOWNLOAD is set');
}

if (process.env.PUPPETEER_EXECUTABLE_PATH) {
  stop('PUPPETEER_EXECUTABLE_PATH is set, so that browser is used instead');
}

// Respect a cache the host configured for itself; otherwise use the project's own.
const cacheDir = process.env.PUPPETEER_CACHE_DIR || LOCAL_CHROME_CACHE;
process.env.PUPPETEER_CACHE_DIR = cacheDir;

let puppeteer;
try {
  ({ default: puppeteer } = await import('puppeteer'));
} catch (error) {
  stop(`puppeteer is not installed yet (${error.message})`);
}

// `executablePath()` reports the build this Puppeteer pins and where it expects
// it, so the check below is exact rather than "something browser-shaped exists".
let wanted = null;
try {
  wanted = await puppeteer.executablePath();
} catch {
  /* nothing pinned yet — the install below is what provides it */
}

if (wanted && fs.existsSync(wanted)) {
  stop(`the pinned browser is already at ${wanted}`);
}

const onHost = EXISTING_CHROME_PATHS.find((candidate) => fs.existsSync(candidate));
if (onHost) {
  stop(`the host already has ${onHost}`);
}

const cli = path.join(PROJECT_ROOT, 'node_modules', 'puppeteer', 'lib', 'puppeteer', 'node', 'cli.js');
if (!fs.existsSync(cli)) {
  stop('the puppeteer CLI is not on disk');
}

log(`installing Chrome into ${cacheDir}`);
log(cacheDir === LOCAL_CHROME_CACHE ? 'this directory travels with the deploy' : 'PUPPETEER_CACHE_DIR was set by the host');

const result = spawnSync(process.execPath, [cli, 'browsers', 'install', 'chrome'], {
  cwd: PROJECT_ROOT,
  stdio: 'inherit',
  env: process.env,
});

if (result.error) {
  console.warn(`[chrome] could not run the installer: ${result.error.message}`);
  console.warn('[chrome] the PDF routes will answer 503 until a browser is available');
  process.exit(0);
}

if (result.status !== 0) {
  console.warn(`[chrome] installation failed with exit code ${result.status}`);
  console.warn('[chrome] the PDF routes will answer 503 until a browser is available');
  process.exit(0);
}

const installed = findCachedChrome(cacheDir);
log(installed ? `ready — ${installed}` : 'the installer reported success but no browser was found');
