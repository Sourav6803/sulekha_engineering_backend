// tests/helpers/quotationFixture.js
import { DEFAULT_PROFILE } from '../../src/models/CompanyProfile.js';
import {
  buildCompanySnapshot,
  buildDefaultItems,
  buildDefaultTerms,
  buildDefaultPaymentTerms,
  buildSystemOverview,
} from '../../src/utils/quotationDefaults.js';

/**
 * A quotation shaped exactly like the real one on the sample document
 * (SE/PMSGY/2026-27/38, Souvik Ghosh, 3 kW, 6 x 610 Wp, 195000).
 *
 * Built from the company profile defaults, so it needs no database.
 */
export const buildFixtureQuotation = (overrides = {}) => {
  const profile = { ...DEFAULT_PROFILE };

  const merged = {
    _id: '60d5ec49f1b2c8a1e4f1a111',
    quotationNo: 'SE/PMSGY/2026-27/38',
    quotationSeq: 38,
    financialYear: '2026-27',
    schemeCode: 'PMSGY',
    schemeLabel: 'PM Surya Ghar Muft Bijli Yojana',
    customerName: 'Souvik Ghosh',
    consumerId: '502178060',
    phoneNo: '9432665126',
    addressLine1: 'Birpur, Gurap',
    district: 'Hooghly',
    pincode: '712303',
    shipTo: {},
    systemSizeKW: 3,
    panelWp: 610,
    panelQty: 6,
    panelBrand: 'Waaree/Adani',
    inverterCapacityKW: 3,
    inverterBrand: 'Deye/any',
    structureType: 'high_rise',
    issueDate: new Date(2026, 8, 21), // 21 Sep 2026, as printed on the sample
    validUntil: new Date(2026, 8, 28),
    validityDays: 7,
    amount: 195000,
    amountIncludesGST: true,
    amountInWords: 'One Lakh Ninety Five Thousand Rupees Only',
    status: 'draft',
    companySnapshot: buildCompanySnapshot(profile),
    ...overrides,
  };

  merged.items =
    overrides.items ||
    buildDefaultItems(profile, {
      systemSizeKW: merged.systemSizeKW,
      panelWp: merged.panelWp,
      panelQty: merged.panelQty,
      inverterCapacityKW: merged.inverterCapacityKW,
      panelBrand: merged.panelBrand,
      inverterBrand: merged.inverterBrand,
      structureType: merged.structureType,
    });

  merged.terms = overrides.terms || buildDefaultTerms(profile);
  merged.paymentTerms = overrides.paymentTerms || buildDefaultPaymentTerms(profile);
  merged.systemOverview =
    overrides.systemOverview ||
    buildSystemOverview(profile, {
      systemSizeKW: merged.systemSizeKW,
      inverterCapacityKW: merged.inverterCapacityKW,
      structureType: merged.structureType,
    });

  return merged;
};

export default buildFixtureQuotation;
