// src/services/pdfBrowser.js
import fs from 'node:fs';
import puppeteer from 'puppeteer';
import config from '../config/env.js';
import logger from '../utils/logger.js';

/**
 * Shared headless-Chrome plumbing for the document renderers.
 *
 * One browser instance is reused across requests and closed after an idle
 * period, because launching Chrome per request costs a second or more.
 */

/** A4 content height in CSS pixels at 96dpi, for a given vertical margin. */
export const pageContentHeightPx = (marginMm) => Math.floor(((297 - marginMm * 2) / 25.4) * 96);

let browserPromise = null;
let idleTimer = null;

const closeAfterIdle = () => {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    void closeBrowser();
  }, 120_000);
  if (typeof idleTimer.unref === 'function') idleTimer.unref();
};

/** Launch options shared by every document type. */
export const buildLaunchOptions = () => {
  const options = {
    headless: true,
    args: config.PUPPETEER_LAUNCH_ARGS || ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  };

  // Only pass an explicit path when it really exists: a stale value (the old
  // /usr/bin/google-chrome default) makes every launch fail.
  if (config.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(config.PUPPETEER_EXECUTABLE_PATH)) {
    options.executablePath = config.PUPPETEER_EXECUTABLE_PATH;
  }

  return options;
};

export const getBrowser = async () => {
  if (browserPromise) {
    try {
      const existing = await browserPromise;
      if (existing.connected) {
        closeAfterIdle();
        return existing;
      }
    } catch {
      browserPromise = null;
    }
  }

  browserPromise = puppeteer.launch(buildLaunchOptions()).catch((error) => {
    browserPromise = null;
    logger.error('Could not start the PDF renderer:', error);
    throw error;
  });

  closeAfterIdle();
  return browserPromise;
};

export const closeBrowser = async () => {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (!browserPromise) return;

  const pending = browserPromise;
  browserPromise = null;
  try {
    const browser = await pending;
    await browser.close();
  } catch {
    // already gone
  }
};

/**
 * Render HTML to a PDF buffer.
 * Throws a plain Error when Chrome is unavailable; callers turn that into a 503.
 */
export const renderPdf = async (html, { timeoutMs = 30_000, pdfOptions = {} } = {}) => {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    page.setDefaultTimeout(timeoutMs);
    await page.setContent(html, { waitUntil: 'load' });

    const base = { format: 'A4', printBackground: true, preferCSSPageSize: true };
    // Chrome only draws header/footer templates when the margins are passed to
    // pdf() itself, so those callers override preferCSSPageSize.
    const options = pdfOptions.displayHeaderFooter
      ? { format: 'A4', printBackground: true, ...pdfOptions }
      : { ...base, ...pdfOptions };

    // Chrome hands back a Uint8Array; callers (and the page counter) want a Buffer.
    return Buffer.from(await page.pdf(options));
  } finally {
    await page.close().catch(() => {});
  }
};

/**
 * Same as renderPdf but keeps the page open so the caller can measure the layout
 * before the PDF is produced (used by the auto-shrink loops).
 */
export const withPage = async (html, handler, { timeoutMs = 30_000 } = {}) => {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    page.setDefaultTimeout(timeoutMs);
    await page.setContent(html, { waitUntil: 'load' });
    return await handler(page);
  } finally {
    await page.close().catch(() => {});
  }
};

/**
 * Count the pages of a PDF produced by Chrome.
 * The page tree is written uncompressed, so the object count is reliable.
 */
export const countPdfPages = (buffer) => {
  const text = Buffer.isBuffer(buffer) ? buffer.toString('latin1') : String(buffer);
  const matches = text.match(/\/Type\s*\/Page[^s]/g);
  return matches ? matches.length : 0;
};
