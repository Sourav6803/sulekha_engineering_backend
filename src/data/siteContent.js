// src/data/siteContent.js
/**
 * The public site's copy and the arithmetic behind its savings table.
 *
 * These are *content*, not records: they describe what the company installs and
 * how a domestic system is worked out, and they change when the business decides
 * to change them rather than when a job is completed. Keeping them here means one
 * file to edit instead of numbers scattered through a page — and one place for the
 * office to correct a figure.
 *
 * Anything that is a *record* — a completed project, a banner, an enquiry — lives
 * in MongoDB (ProjectShowcase, SiteBanner, Lead) and is managed by the admin API.
 *
 * ⚠️  The subsidy and generation figures are indicative. Confirm them against the
 *     current PM Surya Ghar guidelines before a campaign goes out; only the slab
 *     below is what the site will quote, and it is shown with a disclaimer.
 */

// ---------------------------------------------------------------------------
// Panels the company fits
// ---------------------------------------------------------------------------

/**
 * Order matters: it is the order the site prints the brands in.
 * `slug` is what a project's `panelBrand` is matched against, so keep it stable.
 */
export const SOLAR_BRANDS = [
  {
    slug: 'tata',
    name: 'Tata Power Solar',
    blurb: 'One of the oldest module makers in the country, with mono PERC and TOPCon options.',
    panelTypes: ['Mono PERC', 'TOPCon'],
    badge: 'Tier 1',
  },
  {
    slug: 'waaree',
    name: 'Waaree',
    blurb: 'High-volume Indian manufacturing, with a wide Watt-peak range to fit most roofs.',
    panelTypes: ['Mono PERC', 'TOPCon', 'Bifacial'],
    badge: 'Tier 1',
  },
  {
    slug: 'adani',
    name: 'Adani Solar',
    blurb: 'In-house cell and module lines, so supply is steady through the season.',
    panelTypes: ['Mono PERC', 'TOPCon'],
    badge: 'Tier 1',
  },
  {
    slug: 'vikram',
    name: 'Vikram Solar',
    blurb: 'Kolkata-based manufacturing, which keeps replacement and service close at hand.',
    panelTypes: ['Mono PERC', 'TOPCon'],
    badge: 'Tier 1',
  },
];

/** Which brand a project names, matched loosely ("Waaree" → "waaree"). */
export const brandSlugOf = (name) => {
  const value = String(name || '').trim().toLowerCase();
  if (!value) return null;
  const match = SOLAR_BRANDS.find(
    (brand) => value.includes(brand.slug) || brand.name.toLowerCase().includes(value)
  );
  return match?.slug || null;
};

// ---------------------------------------------------------------------------
// What goes into a system
// ---------------------------------------------------------------------------

/**
 * Grouped the way a customer asks about it: "what will you put on my roof?"
 * `role` explains the part in one sentence a non-engineer can follow.
 */
export const SOLAR_MATERIALS = [
  {
    group: 'Generation',
    items: [
      {
        name: 'Solar modules',
        role: 'Turn sunlight into DC power.',
        note: 'DCR or non-DCR, mono PERC or TOPCon, chosen for the roof and the subsidy route.',
      },
      {
        name: 'Grid-tied inverter',
        role: 'Converts DC to the AC your appliances use.',
        note: 'String inverter sized to the array, with monitoring.',
      },
    ],
  },
  {
    group: 'Mounting',
    items: [
      {
        name: 'GI mounting structure',
        role: 'Holds the panels at the right tilt through wind and rain.',
        note: 'Galvanised iron; elevated or tin-shed variants depending on the roof.',
      },
      {
        name: 'Fasteners and clamps',
        role: 'Keeps the array fixed to the structure.',
        note: 'Stainless fasteners at the roof penetrations.',
      },
    ],
  },
  {
    group: 'Protection',
    items: [
      {
        name: 'ACDB and DCDB',
        role: 'Isolates and protects each side of the system.',
        note: 'With MCBs and surge protection.',
      },
      {
        name: 'Earthing kit',
        role: 'Gives fault current a safe path to earth.',
        note: 'Three pits: body, DC and lightning arrester.',
      },
      {
        name: 'Lightning arrester',
        role: 'Diverts a strike away from the array.',
        note: 'Recommended on open and elevated roofs.',
      },
    ],
  },
  {
    group: 'Wiring',
    items: [
      {
        name: 'DC and AC cable',
        role: 'Carries power from the roof to the meter.',
        note: 'UV-rated DC cable, sized for voltage drop.',
      },
      {
        name: 'MC4 connectors',
        role: 'Joins panel strings without exposing conductors.',
        note: 'Matched pairs, crimped rather than taped.',
      },
      {
        name: 'Cable tray and conduit',
        role: 'Keeps the run neat and out of the sun.',
        note: 'Especially where the roof is shared.',
      },
    ],
  },
  {
    group: 'Metering',
    items: [
      {
        name: 'Net meter',
        role: 'Credits the units you export to the grid.',
        note: 'Installed by the discom after inspection; the subsidy is released after this.',
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// How an installation actually runs
// ---------------------------------------------------------------------------

/**
 * Written as the customer experiences it, not as an internal checklist — this is
 * the "how do you actually do it" section on the home page.
 */
export const INSTALLATION_STEPS = [
  {
    step: 1,
    title: 'Site survey',
    duration: '1 visit',
    detail:
      'We measure the roof, check shading through the day, look at the meter and the wiring route, and photograph everything.',
  },
  {
    step: 2,
    title: 'Design and quotation',
    duration: '1–2 days',
    detail:
      'Panel count and layout, inverter sizing, structure type, and a written quotation with the subsidy worked out for your slab.',
  },
  {
    step: 3,
    title: 'Application and approvals',
    duration: '7–15 days',
    detail:
      'We file the PM Surya Ghar application and the discom feasibility approval, and keep you updated at each stage.',
  },
  {
    step: 4,
    title: 'Installation',
    duration: '2–4 days',
    detail:
      'Structure, modules, inverter, protection and cabling. The roof is left watertight, and the work is photographed at each stage.',
  },
  {
    step: 5,
    title: 'Inspection and net meter',
    duration: '7–21 days',
    detail:
      'The discom inspects the system and installs the net meter. Only then does the export start earning units.',
  },
  {
    step: 6,
    title: 'Subsidy and handover',
    duration: 'after net metering',
    detail:
      'The subsidy is credited to your bank account, and we hand over the documents, monitoring access and service contact.',
  },
];

// ---------------------------------------------------------------------------
// Savings arithmetic
// ---------------------------------------------------------------------------

/**
 * The assumptions behind the savings table.
 *
 * `unitsPerKWPerDay` of 4 is the conservative planning figure for this region: a
 * well-oriented 1 kW array makes roughly 4 units a day averaged over the year.
 * `tariffPerUnit` is only used to turn units into rupees — set it to your own
 * domestic slab if the site should quote a different rate.
 */
export const SAVINGS_CONFIG = {
  /*
   * Generation is a band, not a number. Across a year a clean, south-facing
   * rooftop here makes about 4 units per kW a day and 5 in the brighter months,
   * so the site prints "4–5" rather than pretending to know which month the
   * visitor is reading in. `unitsPerKWPerDay` stays the floor, so anything that
   * asks for one figure quotes the cautious end.
   */
  unitsPerKWPerDay: 4,
  unitsPerKWPerDayMax: 5,
  billableDaysPerMonth: 30,
  tariffPerUnit: 8,
  /** One module of this size is quoted per-panel on the site. */
  panelWp: 545,
  sizesKW: [1, 2, 3, 5, 10],

  /**
   * PM Surya Ghar central subsidy for a residential rooftop system:
   * ₹30,000 per kW for the first two kW, ₹18,000 for the third, capped at
   * ₹78,000. Some special-category states add a top-up on top of this.
   */
  subsidy: {
    perKwFirstTwo: 30000,
    perKwThird: 18000,
    cap: 78000,

    /*
     * West Bengal's own top-up for SC/ST households: ₹5,000 per kW up to 3 kW,
     * so ₹15,000 at most. It sits on top of the central amount and has its own
     * cap — a 5 kW SC/ST system still gets ₹15,000 here, not ₹25,000.
     */
    scStPerKw: 5000,
    scStMaxKW: 3,
    scStCap: 15000,

    note: 'Central subsidy under PM Surya Ghar, plus the West Bengal SC/ST top-up where it applies.',
  },

  disclaimer:
    'Indicative only. Generation depends on the roof, shading and weather; the subsidy is released after installation and net metering, as per the current PM Surya Ghar guidelines.',
};

const round2 = (value) => Math.round(value * 100) / 100;

/** Central subsidy for a given size, using the slab above and never exceeding the cap. */
export const subsidyFor = (sizeKW) => {
  const size = Number(sizeKW) || 0;
  if (size <= 0) return 0;
  const firstTwo = Math.min(size, 2) * SAVINGS_CONFIG.subsidy.perKwFirstTwo;
  const third = size > 2 ? Math.min(size - 2, 1) * SAVINGS_CONFIG.subsidy.perKwThird : 0;
  return Math.min(firstTwo + third, SAVINGS_CONFIG.subsidy.cap);
};

/**
 * The West Bengal SC/ST top-up on its own, for a given size.
 *
 * ₹5,000 per kW counted only up to 3 kW, so the most it can ever be is ₹15,000.
 */
export const scStTopUpFor = (sizeKW) => {
  const size = Number(sizeKW) || 0;
  if (size <= 0) return 0;
  const { scStPerKw, scStMaxKW, scStCap } = SAVINGS_CONFIG.subsidy;
  return Math.min(Math.min(size, scStMaxKW) * scStPerKw, scStCap);
};

/** Central subsidy, plus the SC/ST top-up when the household is eligible. */
export const totalSubsidyFor = (sizeKW, { scSt = false } = {}) =>
  subsidyFor(sizeKW) + (scSt ? scStTopUpFor(sizeKW) : 0);

/**
 * The table the home page prints, one row per size.
 *
 * Deliberately no payback figure: it needs the quoted price, and a price that
 * lives on a marketing page goes stale the moment the market moves.
 */
export const buildSavingsTable = () => {
  const { unitsPerKWPerDay, unitsPerKWPerDayMax, billableDaysPerMonth, tariffPerUnit, sizesKW } =
    SAVINGS_CONFIG;

  return sizesKW.map((sizeKW) => {
    const unitsPerDay = round2(sizeKW * unitsPerKWPerDay);
    const unitsPerDayMax = round2(sizeKW * unitsPerKWPerDayMax);
    const unitsPerMonth = round2(unitsPerDay * billableDaysPerMonth);
    const unitsPerMonthMax = round2(unitsPerDayMax * billableDaysPerMonth);
    const monthlySaving = Math.round(unitsPerMonth * tariffPerUnit);
    const monthlySavingMax = Math.round(unitsPerMonthMax * tariffPerUnit);
    return {
      sizeKW,
      unitsPerDay,
      unitsPerDayMax,
      unitsPerMonth,
      unitsPerMonthMax,
      monthlySaving,
      monthlySavingMax,
      yearlySaving: monthlySaving * 12,
      yearlySavingMax: monthlySavingMax * 12,
      subsidy: subsidyFor(sizeKW),
      subsidyScSt: totalSubsidyFor(sizeKW, { scSt: true }),
    };
  });
};

/** What one module contributes — the "benefit of a single panel" line. */
export const panelBenefit = () => ({
  wp: SAVINGS_CONFIG.panelWp,
  unitsPerDay: round2((SAVINGS_CONFIG.panelWp / 1000) * SAVINGS_CONFIG.unitsPerKWPerDay),
  unitsPerMonth: round2(
    (SAVINGS_CONFIG.panelWp / 1000) * SAVINGS_CONFIG.unitsPerKWPerDay * SAVINGS_CONFIG.billableDaysPerMonth
  ),
});

// ---------------------------------------------------------------------------
// Questions the office is asked on the phone every week
// ---------------------------------------------------------------------------

export const SITE_FAQS = [
  {
    question: 'How much subsidy do I get under PM Surya Ghar?',
    answer:
      'For a residential rooftop system the central subsidy is ₹30,000 per kW for the first two kW and ₹18,000 for the third, capped at ₹78,000. West Bengal adds a top-up for SC/ST households — ₹5,000 per kW up to 3 kW, so ₹15,000 at most. It is credited to your bank account after the system is installed and the net meter is in place.',
  },
  {
    question: 'What is the difference between DCR and non-DCR modules?',
    answer:
      'DCR (domestic content requirement) modules are made with Indian cells and are required for the government subsidy. Non-DCR modules use imported cells: they usually cost less, but they do not qualify for the subsidy. We fit either, and say plainly which one a quotation uses.',
  },
  {
    question: 'How long does the whole process take?',
    answer:
      'The physical installation takes two to four days. The application, discom approval and net metering add roughly three to six weeks in total, depending on the discom.',
  },
  {
    question: 'How many units will a 3 kW system generate?',
    answer:
      'About 12–15 units a day (4–5 units per kW), which is roughly 360–450 units a month. Summer months run higher and the monsoon lower.',
  },
  {
    question: 'Do I need a battery?',
    answer:
      'Not for a grid-connected home. A net meter credits the units you export, so a battery is only worth it where outages are long or the grid is unreliable.',
  },
  {
    question: 'What maintenance does it need?',
    answer:
      'Washing the modules every few weeks and an annual check of the connections and earthing. There are no moving parts.',
  },
  {
    question: 'My roof is small — can I still apply?',
    answer:
      'Yes. A 1 kW system needs roughly 8–10 square metres of shade-free roof. We will tell you the largest system your roof can carry during the survey.',
  },
];

export default {
  SOLAR_BRANDS,
  SOLAR_MATERIALS,
  INSTALLATION_STEPS,
  SAVINGS_CONFIG,
  SITE_FAQS,
  buildSavingsTable,
  panelBenefit,
  subsidyFor,
  brandSlugOf,
};
