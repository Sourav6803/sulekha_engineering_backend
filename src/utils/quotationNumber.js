// src/utils/quotationNumber.js
/**
 * Quotation number helpers.
 *
 * Canonical format:  <PREFIX>/<SCHEME>/<FINANCIAL_YEAR>/<SEQ>
 * Example:           SE/PMSGY/2026-27/39
 *
 * Everything in this file is PURE (no database, no config, no side effects) so
 * the numbering rules can be unit-tested in isolation. The database-facing
 * allocation logic lives in services/quotation.service.js.
 *
 * Rules encoded here (agreed with the business):
 *  - The sequence is global across schemes (SE/GP/10 then SE/SOLAR/11 share the
 *    same counter) and scoped per financial year.
 *  - The sequence is NOT zero-padded (…/9, …/10, …/39).
 *  - The financial year runs 1 April – 31 March and is rendered "YYYY-YY".
 */

export const DEFAULT_NUMBER_PREFIX = 'SE';

/** Scheme codes are short alphanumerics, e.g. PMSGY, GP, SOLAR, MBECL */
export const SCHEME_CODE_PATTERN = /^[A-Z0-9]{2,12}$/;

/** Financial year like 2026-27 (also tolerates 2026-2027 on input). */
export const FINANCIAL_YEAR_PATTERN = /^\d{4}-\d{2}(\d{2})?$/;

/**
 * Convert anything date-like into a valid Date.
 * Returns null for unparseable input instead of throwing or silently using "now".
 */
export const toValidDate = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * Indian financial year (1 Apr – 31 Mar) as "YYYY-YY".
 * @param {Date|String} [date]
 * @returns {String|null} e.g. "2026-27", or null when the date is invalid
 */
export const financialYearOf = (date = new Date()) => {
  const d = toValidDate(date);
  if (!d) return null;

  const year = d.getFullYear();
  const startYear = d.getMonth() >= 3 ? year : year - 1; // month index 3 = April
  const endYear = startYear + 1;

  return `${startYear}-${String(endYear).padStart(4, '0').slice(2)}`;
};

/**
 * First and last instant of a financial year — used for date-range filters.
 * @param {String} financialYear e.g. "2026-27"
 * @returns {{start: Date, end: Date}|null}
 */
export const financialYearRange = (financialYear) => {
  const parsed = parseFinancialYear(financialYear);
  if (!parsed) return null;

  const { startYear } = parsed;
  return {
    // 1 April <startYear> 00:00:00 local
    start: new Date(startYear, 3, 1, 0, 0, 0, 0),
    // 31 March <startYear+1> 23:59:59.999 local
    end: new Date(startYear + 1, 2, 31, 23, 59, 59, 999),
  };
};

/**
 * Normalise a financial year string to "YYYY-YY".
 * Accepts "2026-27", "2026-2027", "2026 - 27".
 * @returns {{financialYear: String, startYear: Number}|null}
 */
export const parseFinancialYear = (value) => {
  if (typeof value !== 'string') return null;

  const cleaned = value.trim().replace(/\s+/g, '');
  if (!FINANCIAL_YEAR_PATTERN.test(cleaned)) return null;

  const [rawStart, rawEnd] = cleaned.split('-');
  const startYear = Number.parseInt(rawStart, 10);
  if (!Number.isInteger(startYear) || startYear < 1900 || startYear > 2999) return null;

  const endDigits = rawEnd.length === 4 ? rawEnd.slice(-2) : rawEnd;
  return { financialYear: `${startYear}-${endDigits}`, startYear };
};

/** Normalise a scheme code ("pmsgy " -> "PMSGY"). */
export const normaliseSchemeCode = (value) =>
  typeof value === 'string' ? value.trim().toUpperCase() : '';

/** True when a scheme code is acceptable for a quotation number. */
export const isValidSchemeCode = (value) => SCHEME_CODE_PATTERN.test(normaliseSchemeCode(value));

/**
 * Build a quotation number. Throws on invalid parts — these are programmer
 * errors, never user input (user input is validated by Joi first).
 */
export const buildQuotationNo = ({ prefix = DEFAULT_NUMBER_PREFIX, schemeCode, financialYear, seq }) => {
  const cleanPrefix = String(prefix || DEFAULT_NUMBER_PREFIX).trim().toUpperCase();
  const cleanScheme = normaliseSchemeCode(schemeCode);
  const cleanSeq = Number.parseInt(seq, 10);

  if (!/^[A-Z0-9]{1,10}$/.test(cleanPrefix)) {
    throw new Error(`Invalid quotation number prefix: "${prefix}"`);
  }
  if (!isValidSchemeCode(cleanScheme)) {
    throw new Error(`Invalid scheme code: "${schemeCode}"`);
  }
  if (!parseFinancialYear(financialYear)) {
    throw new Error(`Invalid financial year: "${financialYear}"`);
  }
  if (!Number.isInteger(cleanSeq) || cleanSeq < 1) {
    throw new Error(`Invalid quotation sequence: "${seq}"`);
  }

  return `${cleanPrefix}/${cleanScheme}/${parseFinancialYear(financialYear).financialYear}/${cleanSeq}`;
};

/**
 * Strict parse of a full quotation number.
 * Tolerant of surrounding whitespace, lower case and extra spaces around the
 * separators (the legacy sheet contains entries like " SE/PMSGY/2026-27/17").
 *
 * @returns {{prefix: String, schemeCode: String, financialYear: String, seq: Number, quotationNo: String}|null}
 */
export const parseQuotationNo = (value) => {
  if (typeof value !== 'string') return null;

  const cleaned = value.trim().replace(/\s*\/\s*/g, '/');
  if (!cleaned) return null;

  const match = cleaned.match(
    /^([A-Z0-9]{1,10})\/([A-Z0-9]{2,12})\/(\d{4})\s*[-–—]\s*(\d{2,4})\/(\d{1,6})$/i
  );
  if (!match) return null;

  const [, rawPrefix, rawScheme, rawFyStart, rawFyEnd, rawSeq] = match;
  const fy = parseFinancialYear(`${rawFyStart}-${rawFyEnd}`);
  if (!fy) return null;

  const seq = Number.parseInt(rawSeq, 10);
  if (!Number.isInteger(seq) || seq < 1) return null;

  return {
    prefix: rawPrefix.toUpperCase(),
    schemeCode: normaliseSchemeCode(rawScheme),
    financialYear: fy.financialYear,
    seq,
    quotationNo: buildQuotationNo({
      prefix: rawPrefix,
      schemeCode: rawScheme,
      financialYear: fy.financialYear,
      seq,
    }),
  };
};

/**
 * Loose search for a quotation number inside free text (typically a file name
 * such as "SE-PMSGY-2026-27-38_Souvik Ghosh.pdf").
 *
 * Tries, in order:
 *  1. a full prefix/scheme/fy/seq pattern with any separator
 *  2. a scheme/fy/seq pattern (no prefix)
 *  3. a bare fy/seq pattern, which is enough to identify a record inside a
 *     financial year (used to match an uploaded PDF to its register row)
 *
 * @returns {{prefix: String|null, schemeCode: String|null, financialYear: String, seq: Number}|null}
 */
export const findQuotationNumberInText = (text) => {
  if (typeof text !== 'string' || !text.trim()) return null;

  // "SE-PMSGY-2026-27-38" / "SE/PMSGY/2026-27/38" / "SE_PMSGY_2026-27_38"
  const withPrefix = text.match(
    /([A-Z0-9]{1,10})[\/\-_\s]+([A-Z0-9]{2,12})[\/\-_\s]+(\d{4})\s*[-–—]\s*(\d{2,4})[\/\-_\s]+(\d{1,6})(?=\D|$)/i
  );
  if (withPrefix) {
    const [, prefix, scheme, fyStart, fyEnd, seq] = withPrefix;
    return {
      prefix: prefix.toUpperCase(),
      schemeCode: normaliseSchemeCode(scheme),
      financialYear: parseFinancialYear(`${fyStart}-${fyEnd}`)?.financialYear || null,
      seq: Number.parseInt(seq, 10),
    };
  }

  // "PMSGY-2026-27-38"
  const withScheme = text.match(/([A-Z]{2,12})[\/\-_\s]+(\d{4})\s*[-–—]\s*(\d{2,4})[\/\-_\s]+(\d{1,6})(?=\D|$)/i);
  if (withScheme) {
    const [, scheme, fyStart, fyEnd, seq] = withScheme;
    return {
      prefix: null,
      schemeCode: normaliseSchemeCode(scheme),
      financialYear: parseFinancialYear(`${fyStart}-${fyEnd}`)?.financialYear || null,
      seq: Number.parseInt(seq, 10),
    };
  }

  // "2026-27-38"
  const fyAndSeq = text.match(/(\d{4})\s*[-–—]\s*(\d{2,4})[\/\-_\s]+(\d{1,6})(?=\D|$)/);
  if (fyAndSeq) {
    const [, fyStart, fyEnd, seq] = fyAndSeq;
    return {
      prefix: null,
      schemeCode: null,
      financialYear: parseFinancialYear(`${fyStart}-${fyEnd}`)?.financialYear || null,
      seq: Number.parseInt(seq, 10),
    };
  }

  return null;
};

/**
 * Normalise a customer / file name for the import matcher.
 * "  Souvik   Ghosh_Quotation.PDF" -> "souvik ghosh"
 */
export const normaliseName = (value) => {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\.(pdf|jpe?g|png|docx?|xlsx?)$/i, '')
    .replace(/[_-]?\s*(quotation|quatation|quote|quotation\s*copy|copy)\s*$/i, '')
    .replace(/[^a-z0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
};

/**
 * Normalise a full name into comparable tokens, dropping common noise words so
 * "Md. Souvik Ghosh" and "Souvik Ghosh" still look alike.
 */
export const nameTokens = (value) =>
  normaliseName(value)
    .split(' ')
    .filter((token) => token.length > 1 && !['md', 'mohd', 'mohammad', 'muhammad', 'sri', 'smt', 'shri', 'mr', 'mrs', 'the'].includes(token));

/**
 * Similarity score in [0,1] between two person/organisation names.
 * Token-overlap based with a bonus for exact equality of the normalised form.
 */
export const nameSimilarity = (a, b) => {
  const na = normaliseName(a);
  const nb = normaliseName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  const ta = nameTokens(na);
  const tb = nameTokens(nb);
  if (ta.length === 0 || tb.length === 0) return 0;

  const setB = new Set(tb);
  const shared = ta.filter((token) => setB.has(token)).length;
  return shared / Math.max(ta.length, tb.length);
};

/** Amount as printed on the quotation document: 195000.00 (no symbol, no separators). */
export const formatQuotationAmount = (value) => {
  const n = typeof value === 'number' ? value : Number.parseFloat(value);
  if (!Number.isFinite(n)) return '0.00';
  return n.toFixed(2);
};

/**
 * Panel count for a system size.
 *
 * `sizingFactor` is DC oversizing. The existing manual quotations size a 3 kW
 * system with 6 × 610 Wp modules (= 3.66 kW DC), which is a factor of 1.2:
 *   ceil(3 * 1000 * 1.2 / 610) = 6
 * With a factor of 1 the same system would need 5 panels. The factor is a
 * company setting (CompanyProfile.panelSizingFactor, default 1.2) so the
 * suggestion matches the way the business already quotes; the quantity stays
 * editable on the form.
 */
export const calculatePanelQty = (systemSizeKW, panelWp, sizingFactor = 1) => {
  const kw = Number.parseFloat(systemSizeKW);
  const wp = Number.parseFloat(panelWp);
  const factor = Number.parseFloat(sizingFactor);

  if (!Number.isFinite(kw) || kw <= 0) return null;
  if (!Number.isFinite(wp) || wp <= 0) return null;
  const effectiveFactor = Number.isFinite(factor) && factor > 0 ? factor : 1;

  return Math.max(1, Math.ceil((kw * 1000 * effectiveFactor) / wp));
};

export default {
  DEFAULT_NUMBER_PREFIX,
  SCHEME_CODE_PATTERN,
  FINANCIAL_YEAR_PATTERN,
  toValidDate,
  financialYearOf,
  financialYearRange,
  parseFinancialYear,
  normaliseSchemeCode,
  isValidSchemeCode,
  buildQuotationNo,
  parseQuotationNo,
  findQuotationNumberInText,
  normaliseName,
  nameTokens,
  nameSimilarity,
  formatQuotationAmount,
  calculatePanelQty,
};
