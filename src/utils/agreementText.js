// src/utils/agreementText.js
import { PAYMENT_STAGES } from '../data/agreementContent.js';

/** Indian-style money with two decimals and no thousands separator: 88000.00 */
export const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

export const formatRupeeSplit = (value) => round2(value).toFixed(2);

/**
 * The total is printed inline in a sentence and keeps the original document's
 * shape: no decimals when the amount is whole, no thousands separator.
 *   176000    -> "176000"
 *   176000.5  -> "176000.50"
 */
export const formatRupeeTotal = (value) => {
  const amount = round2(value);
  if (!Number.isFinite(amount)) return '';
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
};

/**
 * Date as the document prints it: 23(Day) 09 (Month) 2026 (Year)
 */
export const formatAgreementDateParts = (date = new Date()) => {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return null;

  return {
    day: String(value.getDate()).padStart(2, '0'),
    month: String(value.getMonth() + 1).padStart(2, '0'),
    year: String(value.getFullYear()),
  };
};

/**
 * The 50 / 40 / 10 split of the agreed amount.
 *
 * The last stage is the remainder rather than a fresh multiplication, so the
 * three amounts always add up to the total exactly - a rounding paisa can
 * otherwise make the agreement contradict itself.
 */
export const buildPaymentSchedule = (amount, stages = PAYMENT_STAGES) => {
  const total = round2(amount);
  if (!Number.isFinite(total) || total < 0) return [];
  if (!Array.isArray(stages) || stages.length === 0) return [];

  const sumOfPercents = stages.reduce((sum, stage) => sum + Number(stage.percent || 0), 0);
  if (sumOfPercents !== 100) {
    throw new Error(`Agreement payment stages must add up to 100%, got ${sumOfPercents}%`);
  }

  let allocated = 0;

  return stages.map((stage, index) => {
    const isLast = index === stages.length - 1;
    const percent = Number(stage.percent || 0);
    const value = isLast ? round2(total - allocated) : round2((total * percent) / 100);
    allocated = round2(allocated + value);

    return {
      label: stage.label || `${index + 1})`,
      percent,
      amount: value,
      amountText: formatRupeeSplit(value),
      note: String(stage.note || '')
        .replace(/\{\{percent\}\}/g, String(percent))
        .replace(/\{\{amount\}\}/g, formatRupeeSplit(value)),
    };
  });
};

/**
 * "W/o-dharanidhar Pramanick, Madaribar,gutinagori,shyampur,howrah, Pin- 711315"
 * The relation line is optional and is simply dropped when empty.
 */
export const composeConsumerLine = ({ relationLine, address } = {}) => {
  const relation = String(relationLine || '').trim();
  const place = String(address || '').trim();

  if (relation && place) return `${relation}, ${place}`;
  return relation || place;
};

/** "{{token}}" substitution used by the template. */
export const fillTemplate = (template, values = {}) =>
  String(template || '').replace(/\{\{(\w+)\}\}/g, (_match, key) =>
    values[key] === undefined || values[key] === null ? '' : String(values[key])
  );
