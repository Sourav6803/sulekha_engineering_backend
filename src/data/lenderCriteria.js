// src/data/lenderCriteria.js

/**
 * What each lender asks of a credit score under PM Surya Ghar, and what this app
 * makes of a consumer's answer.
 *
 * Two rows carry the figures the bank publishes on its own page and are marked
 * `verified`:
 *
 *   - SBI — no minimum score up to ₹2 lakh, minimum 650 above it, and a customer
 *     with a default or write-off on file is not to be considered at either slab.
 *   - Central Bank of India — minimum 680, new-to-credit applicants eligible.
 *
 * The other public-sector banks are onboarded under the scheme but do not publish
 * a number we could read. Their rows are left empty on purpose rather than filled
 * with a plausible-looking 680: an empty row produces "not recorded — confirm with
 * the branch", which is honest, while an invented figure would be shown to an agent
 * as if it were policy.
 *
 * **Nothing here gates anything.** A vendor cannot pull a bureau score — that needs
 * the consumer's consent and a licensed channel, and the bank does it at sanction.
 * So this records what the agent was told and what it means, and every verdict is a
 * notice. No field here may become required, and no submit check may read it.
 */

/** CIBIL/Experian scores run 300–900; anything outside that is not a score. */
export const SCORE_MAX = 900;

/** Above this project cost the banks apply their credit-scored rules. */
export const LOAN_SLAB_LIMIT = 200000;

/**
 * @typedef {Object} Slab
 * @property {Number|null} minScore  minimum score, or null when not recorded
 * @property {Boolean} verified      true when the bank publishes this itself
 */

export const LENDERS = [
  {
    code: 'SBI',
    name: 'State Bank of India',
    upTo2L: { minScore: null, verified: true, note: 'No minimum score; PAN optional.' },
    above2L: {
      minScore: 650,
      verified: true,
      note: 'PAN mandatory, net annual income ₹3 lakh or more.',
    },
    source: 'https://sbi.bank.in/web/personal-banking/loans/pm-surya-ghar-loan-for-solar-roof-top',
  },
  {
    code: 'CBI',
    name: 'Central Bank of India',
    upTo2L: { minScore: 680, verified: true, note: 'New-to-credit applicants also eligible.' },
    above2L: { minScore: 680, verified: true, note: 'Margin rises to 20% above ₹2 lakh.' },
    source: 'https://centralbank.bank.in/en/Roof-Top-Solar-Loan-Scheme',
  },
  { code: 'PNB', name: 'Punjab National Bank', unknown: true },
  { code: 'BOB', name: 'Bank of Baroda', unknown: true },
  { code: 'CANARA', name: 'Canara Bank', unknown: true },
  { code: 'UNION', name: 'Union Bank of India', unknown: true },
  { code: 'BOI', name: 'Bank of India', unknown: true },
  { code: 'INDIAN', name: 'Indian Bank', unknown: true },
  { code: 'IOB', name: 'Indian Overseas Bank', unknown: true },
  { code: 'UCO', name: 'UCO Bank', unknown: true },
  { code: 'MAHABANK', name: 'Bank of Maharashtra', unknown: true },
  { code: 'PSB', name: 'Punjab & Sind Bank', unknown: true },
];

/**
 * Rules that hold at every lender under this scheme, from the two published
 * sources above. Kept apart from the per-bank rows because they do not vary.
 */
export const SCHEME_WIDE_RULES = [
  'A default or write-off on file makes the applicant ineligible, at every slab.',
  'New to credit — no score at all — is eligible; the bank decides at sanction.',
  'A savings account with the lending bank is required, along with rooftop rights and the latest electricity bill.',
];

/** One lender by code, or null. */
export const findLender = (code) => LENDERS.find((lender) => lender.code === code) || null;

/** Which slab a project cost falls in. */
export const slabFor = (amount) => (Number(amount) > LOAN_SLAB_LIMIT ? 'above2L' : 'upTo2L');

/** A score the app is willing to reason about, or null. */
const usableScore = (value) => {
  const score = Number(value);
  if (!Number.isFinite(score) || score <= 0 || score > SCORE_MAX) return null;
  return Math.round(score);
};

const money = (amount) => `₹${Number(amount).toLocaleString('en-IN')}`;

/**
 * What the app makes of a credit answer. Pure: give it the answer, get a verdict.
 *
 * Every branch returns `{ status, headline, detail }` where status is one of
 * `pass`, `review`, `fail` or `not_checked` — and only `review` and `fail` are
 * meant to be shown as warnings.
 *
 * @param {{ amount?: Number, creditCheck?: Object }} input
 */
export const assessCredit = ({ amount, creditCheck = {} } = {}) => {
  const lender = findLender(creditCheck.bank);
  const lenderName = lender ? lender.name : 'The lender';

  // A recorded default is the one thing a bank states outright as disqualifying,
  // so it outranks the score — at every lender, at every amount.
  if (creditCheck.defaultOrWriteOff === true) {
    return {
      status: 'fail',
      headline: `A default or write-off makes this applicant ineligible at ${lenderName}.`,
      detail:
        'Both SBI and Central Bank of India state this at every loan slab. The application can still be saved and sent — tell the consumer before the site visit.',
    };
  }

  if (creditCheck.newToCredit === true) {
    return {
      status: 'not_checked',
      headline: 'New to credit — no score to compare.',
      detail: 'Both published lenders accept new-to-credit applicants; the bank decides at sanction.',
    };
  }

  const score = usableScore(creditCheck.score);
  if (score === null) {
    return {
      status: 'not_checked',
      headline: 'No score recorded.',
      detail: 'Optional. The application does not wait for it.',
    };
  }

  if (!lender) {
    return {
      status: 'not_checked',
      headline: `${score} recorded, but no lender chosen yet.`,
      detail: 'Pick the bank the loan is expected from and the comparison appears here.',
    };
  }

  if (lender.unknown) {
    return {
      status: 'not_checked',
      headline: `${lender.name}'s minimum is not recorded here.`,
      detail: `A score of ${score} is on file. Confirm the minimum with the branch — we have not read it from the bank.`,
    };
  }

  const slab = slabFor(amount);
  const rule = lender[slab];

  // A published "no minimum" is a pass, and worth saying out loud: it is why an
  // agent should not talk a small consumer out of applying.
  if (rule.minScore === null) {
    return {
      status: 'pass',
      headline: `${lender.name} prescribes no minimum score for a ${money(amount)} loan.`,
      detail: rule.note || '',
    };
  }

  if (score >= rule.minScore) {
    return {
      status: 'pass',
      headline: `${score} meets ${lender.name}'s minimum of ${rule.minScore} for a ${money(amount)} loan.`,
      detail: rule.note || '',
    };
  }

  return {
    status: 'review',
    headline: `${score} is below ${lender.name}'s minimum of ${rule.minScore} for a ${money(amount)} loan.`,
    detail: [
      'The bank may still sanction it, and some consumers can add a co-applicant — confirm before the site visit.',
      'The application is not blocked by this.',
    ].join(' '),
  };
};

export default { LENDERS, SCHEME_WIDE_RULES, assessCredit, findLender, slabFor, SCORE_MAX, LOAN_SLAB_LIMIT };
