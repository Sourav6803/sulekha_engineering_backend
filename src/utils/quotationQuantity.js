// src/utils/quotationQuantity.js
/**
 * What a BOQ quantity may be.
 *
 * Normally it is a plain number. The office also records a count it has not
 * fixed yet as a pair — "5/6" — when the number of panels depends on what the
 * site survey turns up, and the figure is agreed with the customer afterwards.
 * Both forms are accepted here so the model and the request validator agree
 * instead of drifting apart; the printed document shows whatever was entered.
 *
 * A BOQ quantity is only ever displayed, never multiplied, so accepting text
 * costs nothing: the line amount is typed (or summed from line amounts), not
 * derived from qty.
 */

/**
 * A count, or a pair of counts separated by a slash: "6", "6.5", "5/6".
 * All-zero forms ("0", "0/0") are rejected — a line with nothing on it is a
 * mistake, and the previous rule refused a bare 0 too.
 */
export const QTY_EXPRESSION_PATTERN = /^(?!0+(?:\.0+)?(?:\s*\/\s*0+(?:\.0+)?)?$)\d{1,5}(?:\.\d{1,3})?(?:\s*\/\s*\d{1,5}(?:\.\d{1,3})?)?$/;

/** Longest accepted entry — "10000/10000" is already absurd. */
export const MAX_QTY_LENGTH = 16;

/**
 * @param {unknown} value
 * @returns {Boolean} true for a positive number, or a pair/quantity expression
 */
export const isValidQty = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > MAX_QTY_LENGTH) return false;
    return QTY_EXPRESSION_PATTERN.test(trimmed);
  }

  return false;
};

/**
 * The value as it should be stored: a number stays a number, an expression is
 * trimmed text. Anything else comes back null for the caller to reject.
 */
export const normaliseQty = (value) => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!isValidQty(trimmed)) return null;
    const numeric = Number(trimmed);
    // A plain "6" is stored as a number so the register and the document keep
    // treating it like every other quantity.
    return Number.isFinite(numeric) && numeric > 0 ? numeric : trimmed;
  }

  return null;
};

export default { QTY_EXPRESSION_PATTERN, MAX_QTY_LENGTH, isValidQty, normaliseQty };
