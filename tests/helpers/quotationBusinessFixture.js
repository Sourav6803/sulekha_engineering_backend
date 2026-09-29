// tests/helpers/quotationBusinessFixture.js
import { DEFAULT_PROFILE } from '../../src/models/CompanyProfile.js';
import {
  buildCompanySnapshot,
  buildDefaultTerms,
  buildDefaultPaymentTerms,
  buildSystemOverview,
} from '../../src/utils/quotationDefaults.js';

/**
 * A business quotation shaped like the real project sheet on file
 * (SE/BOB/2026-27/45, Bank of Baroda, 24 Sep 2026): two named plant sections,
 * 5 kWp on-grid (₹2,98,246) and 2 kWp off-grid (₹1,87,050), goods and services
 * tax quoted separately, and 29 BOQ lines in total.
 *
 * The figures sit on the first line of each section, which is how the manual
 * sheet carries them — one price per section, not per line. That is also what
 * exercises the section sub-total logic.
 */
const ON_GRID = [
  ['Solar PV Module', 'Mono crystalline/CIGS, 550 Wp-600 Wp (MNRE listed)', 'EMVEE/Goldi Green/HR', 'kwp', 5],
  ['Module Mounting Structure with accessories', 'Hot dip galvanized, 80 microns thick, design wind speed 150 kmph', 'Reputed make', 'kwp', 5],
  ['PV Array junction box', 'Fuse for each string, DC SPD 600V, blocking diode, DC MCB', 'Reputed make', 'nos', 1],
  ['Inverter Data Logger', '3 phase 415V 50Hz AC, 5 KVA grid-tied with data logger', 'Powerone/Growatt/THEA', 'nos', 1],
  ['ACDB', 'IP-42/43 PVC door enclosure, dust and vermin proof, MCB, AC SPD', 'ABB/L&T MCCB', 'set', 1],
  ['Net Meter Liasoning with DISCOM', 'WBSEDCL - application fees, import-export meter, generation meter', '-', 'job', 1],
  ['Cables', 'DC cable 4 sqmm 1C, tinned annealed stranded flexible copper', 'Polycab/KEI/Havells', '', 50],
  ['Cables', 'AC cable 4 sq.mm 4C XLPE copper, IS 7098-1, 1.1 kV', 'Polycab/MESCAB', 'mtr', 20],
  ['Cables', 'Earth cable 6 sqmm 1C copper', 'Polycab/MESCAB', 'mtr', 75],
  ['Lightning Arrestor', '1 mtr copper bonded LA with 50mm dia 3mtr GI pipe spike', 'TRUE POWER/SG POWER', 'nos', 1],
  ['Earthing System', '17.2mm dia 1 mtr copper bonded rod, BFC compound, pit cover', 'TRUE POWER/SG POWER', 'nos', 3],
  ['Installation & Wiring Materials', 'For completion of work', 'Reputed make', 'set', 1],
  ['Safety Signage (Danger Notice) DC & AC', '200 x 150 mm each, as per approved drawing', 'Reputed make', 'nos', 2],
  ['Signage', 'Project signage & schematic diagram', 'Reputed make', 'nos', 1],
  ['Cleaning arrangement & fire extinguisher', '-', 'Reputed make', 'set', 1],
];

const OFF_GRID = [
  ['Solar PV Module', 'Mono crystalline/CIGS, 550 Wp-600 Wp (MNRE listed)', 'EMVEE/Goldi Green/HR', 'kwp', 2],
  ['Module Mounting Structure with accessories', 'Hot dip galvanized, 80 microns thick, design wind speed 150 kmph', 'Reputed make', 'kwp', 2],
  ['PV Array junction box', 'Fuse for each string, DC SPD 600V, blocking diode, DC MCB', 'Reputed make', 'nos', 1],
  ['Off-Grid Inverter with grid charging', '1 phase 220V 50Hz, 2 KVA, 24V off-grid', 'LUMINOUS/UTL/EAPRO', 'nos', 1],
  ['Solar Battery with Battery Rack', '12V 200Ah solar tubular low maintenance lead acid', 'LUMINOUS/UTL/EAPRO', 'nos', 2],
  ['ACDB', 'For 2 KW', 'ABB/L&T MCB', 'set', 1],
  ['Cables', 'DC cable 4 sqmm 1C', 'Polycab/KEI/Havells', 'mtr', 30],
  ['Cables', 'Battery DC cable 16 sqmm 1C', 'Polycab/KEI/Havells', 'mtr', 10],
  ['Cables', 'AC cable 6 sqmm 2C copper, IS 7098-1', 'Polycab/MESCAB', 'mtr', 30],
  ['Cables', 'Earth cable 6 sqmm 1C copper', 'Polycab/MESCAB', 'mtr', 50],
  ['Earthing System', '17.2mm dia 1 mtr copper bonded rod, BFC compound, pit cover', 'TRUE POWER/SG POWER', 'nos', 2],
  ['Installation & Wiring Materials', 'For completion of work', 'Reputed make', 'set', 1],
  ['Safety Signage (Danger Notice) DC & AC', '200 x 150 mm each, as per approved drawing', 'Reputed make', 'nos', 2],
  ['Signage', 'Project signage & schematic diagram', 'Reputed make', 'nos', 1],
];

/** The printed sheet's own headings, used verbatim on the section rows. */
export const ON_GRID_SECTION = '5KWP SOLAR POWER PLANT (ON-GRID)';
export const OFF_GRID_SECTION = '2KWP SOLAR POWER PLANT (OFF-GRID)';
export const ON_GRID_TOTAL = 298246;
export const OFF_GRID_TOTAL = 187050;

const toItems = (lines, section, sectionTotal) =>
  lines.map(([description, specification, brandModel, unit, qty], index) => ({
    description,
    specification,
    brandModel,
    // One figure per section, on the section's first line, as on the sheet.
    amount: index === 0 ? sectionTotal : null,
    qty,
    unit: unit || null,
    isOptional: false,
    order: index + 1,
    section,
  }));

export const buildBusinessFixtureQuotation = (overrides = {}) => {
  const profile = { ...DEFAULT_PROFILE };

  const items =
    overrides.items ||
    [
      ...toItems(ON_GRID, ON_GRID_SECTION, ON_GRID_TOTAL),
      ...toItems(OFF_GRID, OFF_GRID_SECTION, OFF_GRID_TOTAL),
    ].map((item, index) => ({ ...item, order: index + 1 }));

  const merged = {
    _id: '60d5ec49f1b2c8a1e4f1a222',
    quotationNo: 'SE/BOB/2026-27/45',
    quotationSeq: 45,
    financialYear: '2026-27',
    schemeCode: 'BOB',
    schemeLabel: 'Bank of Baroda',
    quotationType: 'partner',
    customerName: 'BRANCH MANAGER',
    consumerId: '',
    phoneNo: '',
    addressLine1: 'BANK OF BARODA',
    addressLine2: 'AMDANGRA, TALDANGRA,',
    district: 'BANKURA',
    pincode: '722149',
    shipTo: {},
    systemSizeKW: 7,
    inverterCapacityKW: 5,
    structureType: 'rcc_rooftop',
    issueDate: new Date(2026, 8, 24), // 24 Sep 2026, as printed on the sheet
    validityDays: 7,
    amount: ON_GRID_TOTAL + OFF_GRID_TOTAL,
    amountIncludesGST: false,
    status: 'draft',
    companySnapshot: buildCompanySnapshot(profile, 'partner'),
    ...overrides,
  };

  merged.items = items;
  merged.terms = overrides.terms || buildDefaultTerms(profile, 'partner');
  merged.paymentTerms = overrides.paymentTerms || buildDefaultPaymentTerms(profile, 'partner');
  merged.systemOverview =
    overrides.systemOverview ||
    buildSystemOverview(profile, {
      quotationType: 'partner',
      systemSizeKW: merged.systemSizeKW,
      inverterCapacityKW: merged.inverterCapacityKW,
      structureType: merged.structureType,
    });

  return merged;
};

export default buildBusinessFixtureQuotation;
