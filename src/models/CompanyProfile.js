// src/models/CompanyProfile.js
import mongoose from 'mongoose';
import { DEFAULT_DISCOM, DEFAULT_REGISTERED_OFFICE } from '../data/agreementContent.js';

const { Schema } = mongoose;

/**
 * CompanyProfile - singleton settings document that drives every generated
 * document (quotation PDF / print, register export, BOM sheets).
 *
 * Why this exists: the company name, address, phone, GSTN and bank details were
 * previously hardcoded in several services and components, and the phone number
 * had drifted into three different values. Everything printed now comes from
 * here, seeded with the exact values used on the existing manual quotations.
 */

const termSchema = new Schema(
  {
    label: { type: String, trim: true, maxlength: 60, default: null },
    text: { type: String, required: true, trim: true, maxlength: 300 },
  },
  { _id: false }
);

const paymentTermSchema = new Schema(
  {
    text: { type: String, required: true, trim: true, maxlength: 200 },
  },
  { _id: false }
);

const schemeSchema = new Schema(
  {
    code: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      match: [/^[A-Z0-9]{2,12}$/, 'Scheme code must be 2-12 alphanumeric characters'],
    },
    label: { type: String, trim: true, maxlength: 120, default: '' },
    isActive: { type: Boolean, default: true },
  },
  { _id: false }
);

const structureSchema = new Schema(
  {
    value: {
      type: String,
      required: true,
      trim: true,
      enum: ['high_rise', 'tin_shed', 'rcc_rooftop', 'ground_mount'],
    },
    label: { type: String, required: true, trim: true, maxlength: 80 },
    /** Wording used for the structure line inside the BOQ table. */
    defaultLine: { type: String, required: true, trim: true, maxlength: 200 },
    /** Wording used inside the System Overview sentence. */
    overviewPhrase: { type: String, required: true, trim: true, maxlength: 120 },
  },
  { _id: false }
);

/** Default BOQ lines; the structure line is injected by the service so its wording follows the structure type. */
const defaultItemSchema = new Schema(
  {
    /** Empty for the structure line: its wording comes from structures[].defaultLine. */
    description: { type: String, trim: true, maxlength: 300, default: '' },
    brandModel: { type: String, trim: true, maxlength: 120, default: '' },
    /** 'panel' -> follows the panel count, 'inverter' -> follows the inverter capacity, number -> fixed */
    qtyRule: { type: Schema.Types.Mixed, default: 1 },
    unit: { type: String, trim: true, default: null },
    order: { type: Number, default: 0 },
    isStructureLine: { type: Boolean, default: false },
  },
  { _id: false }
);

const bankDetailsSchema = new Schema(
  {
    bankName: { type: String, trim: true, maxlength: 120, default: '' },
    accountName: { type: String, trim: true, maxlength: 120, default: '' },
    accountNumber: { type: String, trim: true, maxlength: 40, default: '' },
    ifsc: { type: String, trim: true, uppercase: true, maxlength: 15, default: '' },
    branch: { type: String, trim: true, maxlength: 120, default: '' },
  },
  { _id: false }
);

/** The exact wording of the existing quotations, kept verbatim. */
export const DEFAULT_TERMS = [
  {
    label: 'Scope of work',
    text: 'Scope of work: The cost includes design, supply, installing and commissioning of the system.',
  },
  {
    label: 'System Includes',
    text: 'System Includes: System consists of Solar Panels, Inverter, Mounting Structure, connection wires, Connectors, DC MCB, Earthing,',
  },
  {
    label: 'Warranty',
    text: 'Warranty: The panels will have a performance warranty of 25/30 years and have TUV & IEC performance certificates. The Inverter 10 Years as per manufacture warranty.',
  },
  {
    label: 'Delivery Period',
    text: 'Delivery Period: within 10 days after receiving Purchase order with advance.',
  },
  {
    label: null,
    text: 'A drawing along with panel placement and BOM will be shared once this proposal is passed.',
  },
  {
    label: null,
    text: 'Transport, and installation are all included above. No other hidden charges.',
  },
  {
    label: null,
    text: 'Quotation valid for one weeks from the above date.',
  },
  {
    label: null,
    text: 'No warranty on physical damage.',
  },
];

export const DEFAULT_PAYMENT_TERMS = [
  { text: '50% advance with order • 40% on material delivery • 10% on commissioning & handover' },
];

export const DEFAULT_SCHEMES = [
  { code: 'PMSGY', label: 'PM Surya Ghar Muft Bijli Yojana', isActive: true },
  { code: 'GP', label: 'Gram Panchayat', isActive: true },
  { code: 'SOLAR', label: 'Solar', isActive: true },
  { code: 'MBECL', label: 'MBECL', isActive: true },
];

export const DEFAULT_STRUCTURES = [
  {
    value: 'high_rise',
    label: 'High-rise rooftop',
    defaultLine: 'solar roof top high-rise GI structures, SS nut bolt',
    overviewPhrase: 'solar roof top high rise structures',
  },
  {
    value: 'tin_shed',
    label: 'Tin shed',
    defaultLine: 'solar roof top tin shed GI structures, SS nut bolt',
    overviewPhrase: 'solar roof top tin shed structures',
  },
  {
    value: 'rcc_rooftop',
    label: 'RCC rooftop',
    defaultLine: 'solar roof top RCC structures, SS nut bolt',
    overviewPhrase: 'solar roof top RCC structures',
  },
  {
    value: 'ground_mount',
    label: 'Ground mount',
    defaultLine: 'ground mounted GI structures, SS nut bolt',
    overviewPhrase: 'ground mounted structures',
  },
];

/** The 8 BOQ lines from the existing quotation template, in order. */
export const DEFAULT_ITEMS = [
  { description: 'Solar Modules Bifacial TOPcon Panel({{panelWp}} wp).', brandModel: 'Waaree/Adani', qtyRule: 'panel', unit: 'nos', order: 1 },
  { description: 'On grid Solar String Inverter (Capacity: {{inverterCapacityKW}}KW)', brandModel: 'Deye/any', qtyRule: 1, unit: 'nos', order: 2 },
  { description: '', brandModel: '', qtyRule: 1, unit: 'lot', order: 3, isStructureLine: true },
  { description: 'DCDB with SPD 1IN-1OUT', brandModel: '', qtyRule: 1, unit: null, order: 4 },
  { description: 'ACDB Box', brandModel: '', qtyRule: 1, unit: null, order: 5 },
  { description: 'Lighting Arrester copper bonded, Earthing copper bonded 3nos, Chemical bags', brandModel: '', qtyRule: 1, unit: 'lot', order: 6 },
  { description: 'AC/DC cable, Earthing cable, Busbar lug, mc4 connector etc.', brandModel: '', qtyRule: 1, unit: 'lot', order: 7 },
  { description: 'Transportation, Installation, Testing & commissioning', brandModel: '', qtyRule: 1, unit: 'lot', order: 8 },
];

export const DEFAULT_OVERVIEW_TEMPLATE =
  'We are pleased to submit the domestic proposal for Supply, Installation and Commissioning of {{systemSizeKW}} kw solar panel system with {{inverterCapacityKW}} kw ongrid inverter Assumptions include south-facing tilt and typical cable runs for {{structurePhrase}}.';

export const DEFAULT_PROFILE = {
  singletonKey: 'default',
  name: 'SULEKHA ENGINEERING',
  addressLines: ['Uttarsura, Surekalna, Purba Bardhaman', 'West Bengal, 713408'],
  phone: '9832117393',
  altPhone: '',
  email: 'sulekhaengineering@gmail.com',
  gstn: '19ADXFS9993G1ZW',
  stateCode: '19',
  panNumber: '',
  logoPath: '',
  bankDetails: {
    bankName: 'HDFC BANK',
    accountName: 'SULEKHA ENGINEERING',
    accountNumber: '50200041701622',
    ifsc: 'HDFC0009057',
    branch: '',
  },
  quotationTitle: 'Quotation for PM Surya Ghar Muft Bijli Yojana',
  /** Printed on the consumer agreement. Note it includes Jamalpur, unlike the quotation. */
  registeredOffice: DEFAULT_REGISTERED_OFFICE,
  discom: DEFAULT_DISCOM,
  quotationNumberPrefix: 'SE',
  quotationItemLimit: 14,
  validityDays: 7,
  defaultSchemeCode: 'PMSGY',
  defaultPanelWp: 610,
  panelSizingFactor: 1.2,
  defaultStructure: 'high_rise',
  overviewTemplate: DEFAULT_OVERVIEW_TEMPLATE,
  defaultTerms: DEFAULT_TERMS,
  defaultPaymentTerms: DEFAULT_PAYMENT_TERMS,
  schemes: DEFAULT_SCHEMES,
  structures: DEFAULT_STRUCTURES,
  defaultItems: DEFAULT_ITEMS,
};

const CompanyProfileSchema = new Schema(
  {
    singletonKey: {
      type: String,
      default: 'default',
      unique: true,
      immutable: true,
    },
    name: { type: String, required: [true, 'Company name is required'], trim: true, maxlength: 120 },
    addressLines: {
      type: [String],
      default: [],
      validate: {
        validator: (lines) => Array.isArray(lines) && lines.length <= 4,
        message: 'At most 4 address lines are supported on the quotation layout',
      },
    },
    phone: { type: String, trim: true, maxlength: 20, default: '' },
    altPhone: { type: String, trim: true, maxlength: 20, default: '' },
    email: { type: String, trim: true, lowercase: true, maxlength: 120, default: '' },
    gstn: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 15,
      default: '',
      validate: {
        validator: (v) => !v || /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(v),
        message: 'GSTN must be a valid 15-character GSTIN (e.g. 19ADXFS9993G1ZW)',
      },
    },
    stateCode: { type: String, trim: true, maxlength: 2, default: '' },
    panNumber: { type: String, trim: true, uppercase: true, maxlength: 10, default: '' },
    logoPath: { type: String, trim: true, default: '' },

    /** Agreement-only wording: the registered office as printed on page 1. */
    registeredOffice: { type: String, trim: true, maxlength: 300, default: DEFAULT_REGISTERED_OFFICE },
    /** DISCOM named on both documents, e.g. WBSEDCL. */
    discom: { type: String, trim: true, uppercase: true, maxlength: 40, default: DEFAULT_DISCOM },

    bankDetails: { type: bankDetailsSchema, default: () => ({}) },

    quotationTitle: {
      type: String,
      trim: true,
      maxlength: 160,
      default: 'Quotation for PM Surya Ghar Muft Bijli Yojana',
    },
    quotationNumberPrefix: {
      type: String,
      trim: true,
      uppercase: true,
      default: 'SE',
      match: [/^[A-Z0-9]{1,10}$/, 'Quotation number prefix must be 1-10 alphanumeric characters'],
    },
    quotationItemLimit: {
      type: Number,
      default: 14,
      min: [1, 'At least 1 BOQ line must be allowed'],
      max: [30, 'At most 30 BOQ lines are supported'],
    },
    validityDays: { type: Number, default: 7, min: 1, max: 365 },
    defaultSchemeCode: { type: String, trim: true, uppercase: true, default: 'PMSGY' },
    defaultPanelWp: { type: Number, default: 610, min: 100, max: 1000 },
    /** DC oversizing used to suggest the panel count (1.2 reproduces the
     *  existing quotations: 3 kW -> 6 x 610 Wp panels). */
    panelSizingFactor: { type: Number, default: 1.2, min: 1, max: 2 },
    defaultStructure: {
      type: String,
      enum: ['high_rise', 'tin_shed', 'rcc_rooftop', 'ground_mount'],
      default: 'high_rise',
    },
    overviewTemplate: { type: String, trim: true, maxlength: 600, default: DEFAULT_OVERVIEW_TEMPLATE },

    defaultTerms: {
      type: [termSchema],
      default: () => DEFAULT_TERMS.map((t) => ({ ...t })),
      validate: {
        validator: (terms) => Array.isArray(terms) && terms.length <= 12,
        message: 'At most 12 terms lines fit on one page',
      },
    },
    defaultPaymentTerms: {
      type: [paymentTermSchema],
      default: () => DEFAULT_PAYMENT_TERMS.map((t) => ({ ...t })),
      validate: {
        validator: (terms) => Array.isArray(terms) && terms.length <= 3,
        message: 'At most 3 payment term lines fit on one page',
      },
    },
    schemes: { type: [schemeSchema], default: () => DEFAULT_SCHEMES.map((s) => ({ ...s })) },
    structures: { type: [structureSchema], default: () => DEFAULT_STRUCTURES.map((s) => ({ ...s })) },
    defaultItems: { type: [defaultItemSchema], default: () => DEFAULT_ITEMS.map((i) => ({ ...i })) },

    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

CompanyProfileSchema.virtual('gstStateCode').get(function () {
  if (this.stateCode) return this.stateCode;
  return this.gstn ? this.gstn.slice(0, 2) : '';
});

/** Keep stateCode in sync with the GSTIN prefix (19 = West Bengal). */
CompanyProfileSchema.pre('validate', function () {
  if (!this.stateCode && this.gstn) {
    this.stateCode = this.gstn.slice(0, 2);
  }
  if (Array.isArray(this.addressLines)) {
    this.addressLines = this.addressLines.map((line) => String(line || '').trim()).filter(Boolean);
  }
  if (typeof this.phone === 'string') this.phone = this.phone.trim();
});

/**
 * Fetch the singleton profile, creating it from the defaults on first use.
 * @returns {Promise<Document>}
 */
CompanyProfileSchema.statics.getProfile = async function getProfile() {
  const existing = await this.findOne({ singletonKey: 'default' });
  if (existing) return existing;

  try {
    return await this.create({ ...DEFAULT_PROFILE });
  } catch (error) {
    // Race on first ever call (two requests bootstrapping at once): re-read.
    if (error && error.code === 11000) {
      return this.findOne({ singletonKey: 'default' });
    }
    throw error;
  }
};

/**
 * Apply a partial update to the singleton profile. Never allows the
 * singletonKey to change.
 */
CompanyProfileSchema.statics.updateProfile = async function updateProfile(patch = {}, userId = null) {
  const profile = await this.getProfile();

  const mutable = [
    'name', 'addressLines', 'phone', 'altPhone', 'email', 'gstn', 'stateCode', 'panNumber',
    'logoPath', 'bankDetails', 'quotationTitle', 'registeredOffice', 'discom',
    'quotationNumberPrefix', 'quotationItemLimit',
    'validityDays', 'defaultSchemeCode', 'defaultPanelWp', 'panelSizingFactor', 'defaultStructure', 'overviewTemplate',
    'defaultTerms', 'defaultPaymentTerms', 'schemes', 'structures', 'defaultItems',
  ];

  for (const key of mutable) {
    if (patch[key] !== undefined) {
      profile[key] = patch[key];
    }
  }
  if (userId) profile.updatedBy = userId;

  await profile.save();
  return profile;
};

/** Scheme code lookup used to validate the scheme on a new quotation. */
CompanyProfileSchema.statics.isKnownScheme = async function isKnownScheme(code) {
  const profile = await this.getProfile();
  const normalised = String(code || '').trim().toUpperCase();
  return (profile.schemes || []).some((s) => s.code === normalised && s.isActive !== false);
};

const CompanyProfile = mongoose.model('CompanyProfile', CompanyProfileSchema);

export default CompanyProfile;
