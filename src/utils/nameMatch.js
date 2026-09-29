// src/utils/nameMatch.js
/**
 * Name agreement check across the Aadhaar, the bank passbook and the
 * electricity bill.
 *
 * The paper checklist makes this mandatory: "আধার, ব্যাংক পাসবুক এবং
 * ইলেকট্রিক বিলে নাম যেমন একই থাকতে হবে (capital/small letter সমস্যা নয়, কিন্তু
 * নাম mismatch করা যাবে না)" — i.e. case differences are fine, real mismatches
 * are not. The agent reads the name off each document and types it in; this
 * module decides whether the three agree, so the decision is consistent and the
 * office does not have to re-derive it.
 *
 * Deliberately offline and deterministic: no OCR, no fuzzy magic. Where it is
 * unsure it says `near_match` and hands the judgement to the admin rather than
 * silently passing a document that PM Surya Ghar will reject.
 */

/**
 * Fold a name for comparison: drop punctuation, collapse whitespace, lowercase.
 * Indic honorifics and the common "S/o", "D/o", "W/o" markers are removed
 * because documents disagree on whether to print them.
 */
const HONORIFICS = new Set([
  'sri', 'srimati', 'sm', 'smt', 'shri', 'shrimati', 'mr', 'mrs', 'ms', 'dr',
  'so', 'do', 'wo', 's', 'd', 'w', 'o', 'son', 'daughter', 'wife', 'of',
]);

export const normalizeName = (value) =>
  String(value || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !HONORIFICS.has(token))
    .join(' ');

export const nameTokens = (value) =>
  normalizeName(value).split(' ').filter(Boolean);

/** Exact agreement once case, punctuation and honorifics are folded away. */
export const isExactMatch = (a, b) => {
  const left = normalizeName(a);
  const right = normalizeName(b);
  return Boolean(left) && left === right;
};

/**
 * True when one name's tokens are a subset of the other's — the everyday case
 * where a document prints only "Raj Kumar Dawn" and another adds a middle name
 * or an initial. Treated as a near match, never as a clean pass.
 */
export const isTokenSubset = (a, b) => {
  const left = nameTokens(a);
  const right = nameTokens(b);
  if (left.length === 0 || right.length === 0) return false;

  const [small, large] = left.length <= right.length ? [left, right] : [right, left];
  return small.every((token) => large.includes(token));
};

/** Token overlap as a Jaccard ratio, 0-1. */
export const tokenSimilarity = (a, b) => {
  const left = new Set(nameTokens(a));
  const right = new Set(nameTokens(b));
  if (left.size === 0 || right.size === 0) return 0;

  let shared = 0;
  left.forEach((token) => {
    if (right.has(token)) shared += 1;
  });

  const union = new Set([...left, ...right]).size;
  return union === 0 ? 0 : shared / union;
};

/** Similarity at or above this is reported as `near_match` rather than a mismatch. */
export const NEAR_MATCH_SIMILARITY = 0.6;

/**
 * Compare the name printed on each document against the applicant's name.
 *
 * @param {object} input
 * @param {string} input.consumerName       name as entered on the application
 * @param {string} [input.aadhaarName]
 * @param {string} [input.passbookName]
 * @param {string} [input.electricBillName]
 * @returns {{
 *   verdict: 'match'|'near_match'|'mismatch'|'incomplete',
 *   passed: boolean|null,
 *   compared: string[],
 *   entries: object,
 *   pairwise: object,
 *   mismatched: string[],
 *   message: string
 * }}
 */
export const checkNameMatch = ({
  consumerName,
  aadhaarName,
  passbookName,
  electricBillName,
} = {}) => {
  const entries = {
    consumerName: consumerName || null,
    aadhaarName: aadhaarName || null,
    passbookName: passbookName || null,
    electricBillName: electricBillName || null,
  };

  const present = Object.entries(entries).filter(([, value]) => normalizeName(value));

  // Every document name is required before the comparison means anything.
  if (present.length < 4) {
    const missing = Object.entries(entries)
      .filter(([, value]) => !normalizeName(value))
      .map(([key]) => key);

    return {
      verdict: 'incomplete',
      passed: null,
      compared: [],
      entries,
      pairwise: {},
      mismatched: missing,
      message: `Name is missing from: ${missing.join(', ')}. Read the name off each document and enter it.`,
    };
  }

  const pairs = [
    ['consumerName', 'aadhaarName'],
    ['consumerName', 'passbookName'],
    ['consumerName', 'electricBillName'],
    ['aadhaarName', 'passbookName'],
    ['aadhaarName', 'electricBillName'],
    ['passbookName', 'electricBillName'],
  ];

  const pairwise = {};
  let exactCount = 0;
  let nearCount = 0;

  pairs.forEach(([left, right]) => {
    const exact = isExactMatch(entries[left], entries[right]);
    const subset = !exact && isTokenSubset(entries[left], entries[right]);
    const similarity = Number(tokenSimilarity(entries[left], entries[right]).toFixed(2));

    let verdict = 'mismatch';
    if (exact) {
      verdict = 'match';
      exactCount += 1;
    } else if (subset || similarity >= NEAR_MATCH_SIMILARITY) {
      verdict = 'near_match';
      nearCount += 1;
    }

    pairwise[`${left}__${right}`] = { verdict, similarity };
  });

  if (exactCount === pairs.length) {
    return {
      verdict: 'match',
      passed: true,
      compared: Object.keys(entries),
      entries,
      pairwise,
      mismatched: [],
      message: 'The name matches on all three documents.',
    };
  }

  if (nearCount + exactCount === pairs.length) {
    return {
      verdict: 'near_match',
      passed: false,
      compared: Object.keys(entries),
      entries,
      pairwise,
      mismatched: [],
      message:
        'Names are close but not identical (a middle name or an initial differs). The office will confirm before processing.',
    };
  }

  // Object.keys() would hand back strings here, so destructuring it as [key,
  // value] yields characters — use entries.
  const mismatched = Object.entries(pairwise)
    .filter(([, value]) => value.verdict === 'mismatch')
    .map(([key]) => key);

  return {
    verdict: 'mismatch',
    passed: false,
    compared: Object.keys(entries),
    entries,
    pairwise,
    mismatched,
    message:
      'Name mismatch between the documents. The names on the Aadhaar, the bank passbook and the electricity bill must be the same — fix this before submitting.',
  };
};

export default checkNameMatch;
