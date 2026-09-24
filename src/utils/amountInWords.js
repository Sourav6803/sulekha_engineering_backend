// src/utils/amountInWords.js
/**
 * Indian-system amount to words, used for the "amount in words" line on the
 * quotation. Pure functions only, so every branch is unit-testable.
 *
 *   195000     -> "One Lakh Ninety Five Thousand Rupees Only"
 *   1234.50    -> "One Thousand Two Hundred Thirty Four Rupees and Fifty Paise Only"
 *   0          -> "Zero Rupees Only"
 */

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen',
];

const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

/** 0-99 in words. */
const twoDigits = (n) => {
  if (n < 20) return ONES[n];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return ones === 0 ? TENS[tens] : `${TENS[tens]} ${ONES[ones]}`;
};

/** 0-999 in words (Indian grouping: hundred + remainder). */
const threeDigits = (n) => {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts = [];
  if (hundreds > 0) parts.push(`${ONES[hundreds]} Hundred`);
  if (rest > 0) parts.push(twoDigits(rest));
  return parts.join(' ');
};

/**
 * Whole number (0 .. 999999999999) in words using lakh / crore grouping.
 * Returns an empty string for 0 so callers can decide the wording.
 */
export const integerToIndianWords = (value) => {
  let n = Math.floor(Math.abs(Number(value) || 0));
  if (n === 0) return '';
  if (n > 999999999999) return null; // out of supported range

  const parts = [];

  const crore = Math.floor(n / 10000000);
  n %= 10000000;
  const lakh = Math.floor(n / 100000);
  n %= 100000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;

  if (crore > 0) parts.push(`${integerToIndianWords(crore)} Crore`);
  if (lakh > 0) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand > 0) parts.push(`${twoDigits(thousand)} Thousand`);
  if (n > 0) parts.push(threeDigits(n));

  return parts.join(' ');
};

/**
 * Full amount in words, Indian style, sentence form.
 * @param {Number|String} value
 * @param {Object} [options]
 * @param {String} [options.currency='Rupees']
 * @param {Boolean} [options.includeOnly=true]
 * @returns {String}
 */
export const amountInWords = (value, options = {}) => {
  const { currency = 'Rupees', includeOnly = true } = options;

  const numeric = typeof value === 'number' ? value : Number.parseFloat(value);
  if (!Number.isFinite(numeric) || numeric < 0) return '';

  const rounded = Math.round(numeric * 100) / 100;
  const whole = Math.floor(rounded);
  const paise = Math.round((rounded - whole) * 100);

  const words = [];
  const wholeWords = integerToIndianWords(whole);
  words.push(wholeWords ? `${wholeWords} ${currency}` : `Zero ${currency}`);

  if (paise > 0) {
    words.push(`and ${twoDigits(paise)} Paise`);
  }

  const sentence = words.join(' ');
  return includeOnly ? `${sentence} Only` : sentence;
};

export default amountInWords;
