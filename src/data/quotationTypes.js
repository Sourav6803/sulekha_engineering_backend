// src/data/quotationTypes.js
/**
 * The two kinds of quotation this company issues.
 *
 * `consumer` — the domestic PM Surya Ghar sheet. A flat BOQ of eight lines with
 * no serial column and no specification column, a GST-inclusive total, and the
 * consumer signs the acceptance block. This is the original template and stays
 * exactly as it was.
 *
 * `partner` — the project sheet raised for a solar partner, an institutional
 * client or a material supply order. The Bank of Baroda quote (SE/BOB/2026-27/45)
 * is one of these: a numbered BOQ with its own specification column, one or more
 * named plant sections each carrying its own sub-total, a GST-exclusive total,
 * and the vendor signs instead of the consumer.
 *
 * Everything below is the wording taken from that printed sheet. The terms are a
 * code-level fallback in the same way DEFAULT_TERMS is: the company profile may
 * override them, but a quotation must never print bare.
 */

export const QUOTATION_TYPES = ['consumer', 'partner'];

export const DEFAULT_QUOTATION_TYPE = 'consumer';

/** Title used when the profile has no partner title of its own. */
export const DEFAULT_PARTNER_TITLE = 'QUOTATION FOR GRID CONNECTED SOLAR POWER PLANT ON-GRID & OFF-GRID';

/** The line under the company name on the partner sheet. The consumer sheet has none. */
export const DEFAULT_PARTNER_TAGLINE = 'PM Surya Ghar Muft Bijli Yojana Empanelled Vendor';

/** How the reader accepts the document. `client` prints a signature line to fill in. */
export const ACCEPTANCE_CLIENT = 'client';
export const ACCEPTANCE_VENDOR = 'vendor';

/**
 * The partner sheet's System Overview sentence. Same {{token}} grammar as the
 * consumer template so buildSystemOverview can fill either one.
 *
 * It deliberately names only the plant size. An earlier version also printed the
 * off-grid size by reusing {{inverterCapacityKW}} — which is the inverter rating,
 * not the off-grid array — and on the first real project sheet that produced
 * "7 KW on-grid ... & 5 KW off-grid" where the manual sheet says 5 and 2. A
 * project overview is job-specific anyway, so the office edits this field.
 */
export const DEFAULT_PARTNER_OVERVIEW_TEMPLATE =
  'We are pleased to submit the proposal for Supply, Installation and Commissioning of {{systemSizeKW}} KW Rooftop Solar Power Plant with Net-metering Arrangement, together with the off-grid plant, as detailed in the enclosed BOQ. Assumptions include south-facing tilt and typical cable runs for solar roof top mounting structures.';

/**
 * Terms of the partner sheet, in the order the printed sheet states them.
 * `termSchema` caps a term at 300 characters, so the two long scope clauses that
 * the sheet runs together are split where the sheet itself breaks them with a
 * colon ("Civil Work:", "Warranty:-").
 */
export const DEFAULT_PARTNER_TERMS = [
  {
    label: 'Taxes',
    text: 'GST will be charged excluded for Solar System @8.9% [70% of project cost @5% & 30% of project cost @18%].',
  },
  {
    label: 'Site Survey',
    text: 'The job includes a detailed site survey for determination of the feasibility of the system.',
  },
  {
    label: 'Design / Installation',
    text: 'Detailed Design Report after pre-visit of site for final approval. Installation of system as per guidelines and design document.',
  },
  {
    label: 'Civil Work',
    text: 'Suitable boring at the selected locations with cable laying, construction of base foundation for module mounting structure, construction of earthing system for pit cover.',
  },
  {
    label: 'Installation, Testing & Commissioning',
    text: 'Installation of Solar PV Module, Solar Inverter, Array junction Box (AJB) & ACDB, cables & wires for system, pipe line fittings and arrangement for cleaning, signage & danger notice board, lightning arrestor & earthing system.',
  },
  {
    label: 'Supply & Transportation',
    text: 'Supply and transportation of materials at site as per BOM.',
  },
  {
    label: 'Warranty',
    text: 'Solar PV Module 10 years against manufacturer warranty and 25 years against performance warranty. Solar Module Mounting Structure 5 years warranty against rust & corrosion.',
  },
  {
    label: 'Warranty',
    text: 'Solar Inverter 5 years against manufacturing warranty. Earthing System & BOS Material 1 year against manufacturing warranty.',
  },
  {
    label: 'AMC',
    text: 'Operation & Maintenance of the system for 5 years for Solar power plant System.',
  },
  {
    label: 'Damage',
    text: 'No warranty on physical damage.',
  },
];

/** The partner sheet's payment terms — 50 / 50, not the domestic 50 / 40 / 10. */
export const DEFAULT_PARTNER_PAYMENT_TERMS = [
  {
    text: '50% along with supply, installation, testing & commissioning of the solar power plant.',
  },
  {
    text: 'Balance 50% within 7-10 days of net-metering.',
  },
];

/**
 * Presentation rules per type. The PDF builder and the form both read this, so
 * the two can never disagree about what a partner sheet carries.
 */
export const QUOTATION_TYPE_RULES = {
  consumer: {
    label: 'Consumer (PM Surya Ghar)',
    showSerialColumn: false,
    showSpecificationColumn: false,
    showSections: false,
    amountIncludesGST: true,
    acceptance: ACCEPTANCE_CLIENT,
  },
  partner: {
    label: 'Solar partner / material',
    showSerialColumn: true,
    showSpecificationColumn: true,
    showSections: true,
    amountIncludesGST: false,
    acceptance: ACCEPTANCE_VENDOR,
  },
};

/** Rules for a type, falling back to the domestic sheet for anything unknown. */
export const rulesForType = (type) =>
  QUOTATION_TYPE_RULES[type] || QUOTATION_TYPE_RULES[DEFAULT_QUOTATION_TYPE];

export const isQuotationType = (type) => QUOTATION_TYPES.includes(type);

export default {
  QUOTATION_TYPES,
  DEFAULT_QUOTATION_TYPE,
  DEFAULT_PARTNER_TITLE,
  DEFAULT_PARTNER_TAGLINE,
  DEFAULT_PARTNER_OVERVIEW_TEMPLATE,
  DEFAULT_PARTNER_TERMS,
  DEFAULT_PARTNER_PAYMENT_TERMS,
  QUOTATION_TYPE_RULES,
  rulesForType,
  isQuotationType,
  ACCEPTANCE_CLIENT,
  ACCEPTANCE_VENDOR,
};
