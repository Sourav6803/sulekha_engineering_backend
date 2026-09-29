// src/services/imageQuality.service.js
/**
 * Offline document-clarity check.
 *
 * Agents photograph Aadhaar cards, passbooks and rooftops on their phones. A
 * blurry, dark, glare-hit or thumbnail-sized picture has to be caught before the
 * application reaches the office, otherwise the office ends up chasing the agent
 * for a re-shoot.
 *
 * Two layers, both offline (no network, no paid API):
 *
 *   1. Structural — always runs. File type, size, pixel dimensions and aspect
 *      ratio, read straight out of the JPEG / PNG header.
 *   2. Pixel — runs only when an image decoder is installed. Measures blur
 *      (variance of the Laplacian), mean brightness and how much of the frame is
 *      blown out to white.
 *
 * Layer 2 is optional on purpose. `sharp` is a native module and `jimp` is a
 * large pure-JS one; neither is needed for the app to boot, so the decoder is
 * imported lazily and its absence degrades the verdict to `skipped` rather than
 * failing the upload. Install either one to switch it on:
 *
 *     npm install sharp
 *
 * The browser also runs the same maths on a canvas before upload, so the agent
 * gets "picture clear nahi hai, try again" instantly instead of after a round
 * trip. This service is the server-side authority.
 */

/** Tuned for phone photos of documents. Documented so they can be argued with. */
export const QUALITY_THRESHOLDS = {
  /**
   * Deliberately low. An earlier 900 × 600 floor rejected real agent photos —
   * 712 × 489 off a phone in the field is perfectly readable on screen — and
   * blocked the office's work over a number nobody had asked for. This now only
   * catches a genuine thumbnail.
   */
  minWidth: 480,
  minHeight: 360,
  /** A re-compressed or heavily blurred shot usually lands under this. */
  minBytes: 60 * 1024,
  maxBytes: 5 * 1024 * 1024,
  /** Variance of the Laplacian. Sharp text edges push this well past 120. */
  minSharpness: 120,
  /** Mean grey level, 0-255. */
  minBrightness: 55,
  maxBrightness: 235,
  /** Standard deviation of grey levels — a flat frame carries no information. */
  minContrast: 25,
  /**
   * There is intentionally no glare rule.
   *
   * "Fraction of near-white pixels" was intended to catch a flash bouncing off a
   * laminated card, but a document photographed on white paper IS mostly
   * near-white — real scans measured 76% against a 12% limit, so almost every
   * legitimate Aadhaar or passbook photo was flagged. Judging glare needs the
   * spatial pattern (a localised hotspot), not a whole-frame average.
   */
  /** Documents are landscape-ish or portrait; a 4:1 strip is a crop gone wrong. */
  maxAspectRatio: 4,
};

export const QUALITY_MESSAGES = {
  tooSmall:
    'Picture is too small to read. Take it again closer to the document, or scan it.',
  tooFewBytes:
    'Picture looks over-compressed. Take it again with the camera app, not a forwarded copy.',
  tooLarge: 'File is too large. Keep it under 5 MB.',
  lowSharpness:
    'Picture clear nahi hai (blurry). Hold the phone steady, tap to focus, and take it again.',
  tooDark: 'Picture is too dark. Take it again in better light.',
  tooBright: 'Picture is too bright / washed out. Move away from direct light and take it again.',
  lowContrast:
    'Picture has almost no detail. Take it again with the document filling the frame.',
  glare:
    'Glare is covering part of the document. Tilt the phone slightly and take it again.',
  oddShape:
    'Picture looks cropped. Fit the whole document in the frame and take it again.',
  notAnImage: 'File is not a readable image.',
};

const IMAGE_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png'];

export const isImageMimeType = (mimeType) =>
  IMAGE_MIME_TYPES.includes(String(mimeType || '').toLowerCase());

/**
 * Read pixel dimensions out of a JPEG or PNG header. Dependency-free: PNG keeps
 * its size in the IHDR chunk, JPEG in a SOFn frame header.
 *
 * Returns null when the format is not recognised — callers treat that as
 * "cannot check", never as a pass.
 */
export const readDimensions = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) return null;

  // --- PNG: 8-byte signature, then IHDR with width/height as big-endian u32.
  if (
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer.toString('ascii', 12, 16) === 'IHDR'
  ) {
    return {
      format: 'png',
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
    };
  }

  // --- JPEG: SOI, then a chain of markers until a start-of-frame.
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }

      const marker = buffer[offset + 1];

      // SOF0..SOF15, excluding the non-frame markers DHT (c4), JPG (c8) and DAC (cc).
      const isStartOfFrame =
        marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

      if (isStartOfFrame) {
        return {
          format: 'jpeg',
          height: buffer.readUInt16BE(offset + 5),
          width: buffer.readUInt16BE(offset + 7),
        };
      }

      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }

      const segmentLength = buffer.readUInt16BE(offset + 2);
      if (segmentLength < 2) return null;
      offset += 2 + segmentLength;
    }
  }

  return null;
};

/**
 * Load an optional pixel decoder. Returns null when neither is installed, which
 * is the normal case until someone runs `npm install sharp`.
 */
const loadDecoder = async () => {
  for (const moduleName of ['sharp', 'jimp']) {
    try {
      const mod = await import(moduleName);
      return { name: moduleName, mod };
    } catch {
      // Not installed — try the next one.
    }
  }
  return null;
};

/**
 * Greyscale raw pixels as a flat Uint8ClampedArray plus dimensions.
 * Kept separate so the maths below stays decoder-agnostic.
 */
const toGreyscale = async (buffer, decoder) => {
  if (!decoder) return null;

  try {
    if (decoder.name === 'sharp') {
      const sharp = decoder.mod.default || decoder.mod;
      // Cap the working size: sharpness is scale-invariant enough for this
      // purpose and a 12 MP decode would be needlessly slow.
      const { data, info } = await sharp(buffer)
        .greyscale()
        .resize({ width: 1200, withoutEnlargement: true })
        .raw()
        .toBuffer({ resolveWithObject: true });

      return { pixels: data, width: info.width, height: info.height };
    }

    if (decoder.name === 'jimp') {
      const Jimp = decoder.mod.default || decoder.mod;
      const image = await Jimp.read(buffer);
      if (image.width > 1200) image.resize({ w: 1200 });
      image.greyscale();

      const { width, height, data } = image.bitmap;
      const pixels = new Uint8ClampedArray(width * height);
      for (let i = 0; i < width * height; i += 1) {
        pixels[i] = data[i * 4];
      }

      return { pixels, width, height };
    }
  } catch {
    return null;
  }

  return null;
};

/** Variance of the Laplacian — the standard blur proxy. Higher means sharper. */
export const laplacianVariance = (pixels, width, height) => {
  if (!pixels || width < 3 || height < 3) return null;

  const values = [];
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const laplacian =
        Number(pixels[i - width]) +
        Number(pixels[i + width]) +
        Number(pixels[i - 1]) +
        Number(pixels[i + 1]) -
        4 * Number(pixels[i]);
      values.push(laplacian);
    }
  }

  if (values.length === 0) return null;

  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;

  return variance;
};

/** Mean, standard deviation and the fraction of blown-out pixels. */
export const brightnessStats = (pixels) => {
  if (!pixels || pixels.length === 0) return null;

  let sum = 0;
  let sumSquares = 0;
  let glare = 0;

  for (let i = 0; i < pixels.length; i += 1) {
    const value = pixels[i];
    sum += value;
    sumSquares += value * value;
    if (value >= 250) glare += 1;
  }

  const mean = sum / pixels.length;
  const variance = Math.max(0, sumSquares / pixels.length - mean * mean);

  return {
    mean,
    standardDeviation: Math.sqrt(variance),
    glareFraction: glare / pixels.length,
  };
};

/**
 * Run the full check.
 *
 * @param {object}  input
 * @param {Buffer}  input.buffer    file contents
 * @param {string}  input.mimeType
 * @param {number} [input.size]     byte length, defaults to buffer.length
 * @returns {Promise<{verdict:'pass'|'fail'|'skipped', score:number, message:string|null,
 *                    reasons:string[], metrics:object, checkedAt:string}>}
 */
export const checkImageQuality = async ({ buffer, mimeType, size } = {}) => {
  const bytes = typeof size === 'number' ? size : buffer?.length || 0;
  const reasons = [];
  const metrics = { bytes, mimeType: mimeType || null, decoder: null };
  const checkedAt = new Date().toISOString();

  // PDFs (scans, downloaded bills) are not image-checked — a PDF is already a
  // deliberate export from a scanner or portal.
  if (!isImageMimeType(mimeType)) {
    return {
      verdict: 'skipped',
      score: 100,
      message: null,
      reasons: [],
      metrics,
      checkedAt,
    };
  }

  if (!Buffer.isBuffer(buffer)) {
    return {
      verdict: 'fail',
      score: 0,
      message: QUALITY_MESSAGES.notAnImage,
      reasons: ['unreadable'],
      metrics,
      checkedAt,
    };
  }

  const thresholds = QUALITY_THRESHOLDS;

  // ---------------------------------------------------------------- structure
  const dimensions = readDimensions(buffer);
  if (dimensions) {
    metrics.width = dimensions.width;
    metrics.height = dimensions.height;
    metrics.format = dimensions.format;
    metrics.aspectRatio = Number((dimensions.width / dimensions.height).toFixed(2));

    if (dimensions.width < thresholds.minWidth || dimensions.height < thresholds.minHeight) {
      reasons.push('tooSmall');
    }

    const aspect = Math.max(
      dimensions.width / dimensions.height,
      dimensions.height / dimensions.width
    );
    if (aspect > thresholds.maxAspectRatio) reasons.push('oddShape');
  } else {
    metrics.format = 'unknown';
  }

  if (bytes < thresholds.minBytes) reasons.push('tooFewBytes');
  if (bytes > thresholds.maxBytes) reasons.push('tooLarge');

  // -------------------------------------------------------------------- pixels
  const decoder = await loadDecoder();
  if (decoder) {
    metrics.decoder = decoder.name;

    const grey = await toGreyscale(buffer, decoder);
    if (grey) {
      const sharpness = laplacianVariance(grey.pixels, grey.width, grey.height);
      const stats = brightnessStats(grey.pixels);

      if (sharpness !== null) metrics.sharpness = Number(sharpness.toFixed(2));
      if (stats) {
        metrics.meanBrightness = Number(stats.mean.toFixed(2));
        metrics.contrast = Number(stats.standardDeviation.toFixed(2));
        // Recorded for the office's benefit, but it never fails a document —
        // see the note on maxGlareFraction above.
        metrics.glareFraction = Number(stats.glareFraction.toFixed(4));
      }

      if (sharpness !== null && sharpness < thresholds.minSharpness) reasons.push('lowSharpness');
      if (stats) {
        if (stats.mean < thresholds.minBrightness) reasons.push('tooDark');
        if (stats.mean > thresholds.maxBrightness) reasons.push('tooBright');
        if (stats.standardDeviation < thresholds.minContrast) reasons.push('lowContrast');
        if (stats.glareFraction > thresholds.maxGlareFraction) reasons.push('glare');
      }
    } else {
      metrics.decoder = `${decoder.name}:decode-failed`;
    }
  }

  // --------------------------------------------------------------------- score
  // Start from 100 and dock per failure, weighted by how much each one matters
  // for a readable document photo.
  const weights = {
    tooSmall: 30,
    tooFewBytes: 15,
    tooLarge: 5,
    lowSharpness: 35,
    tooDark: 20,
    tooBright: 15,
    lowContrast: 15,
    glare: 20,
    oddShape: 10,
  };

  const score = Math.max(
    0,
    100 - reasons.reduce((total, reason) => total + (weights[reason] || 10), 0)
  );

  const verdict = reasons.length > 0 ? 'fail' : 'pass';

  return {
    verdict,
    score,
    message: verdict === 'fail' ? QUALITY_MESSAGES[reasons[0]] || 'Picture clear nahi hai. Try again.' : null,
    reasons,
    metrics,
    checkedAt,
  };
};

export default checkImageQuality;
