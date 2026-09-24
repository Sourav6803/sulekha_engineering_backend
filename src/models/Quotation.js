// src/models/Quotation.js
import mongoose from 'mongoose';
import {
  financialYearOf,
  formatQuotationAmount,
  parseFinancialYear,
  normaliseSchemeCode,
} from '../utils/quotationNumber.js';
import { amountInWords } from '../utils/amountInWords.js';

const { Schema } = mongoose;

/** Units allowed on a BOQ line. `null`/blank is valid — two lines of the
 *  existing template have no unit at all, and the printed sheet must match. */
export const QUOTATION_UNITS = ['nos', 'mtr', 'kg', 'lot', 'pair', 'bag', 'roll', 'box'];

export const QUOTATION_STATUSES = ['draft', 'sent', 'accepted', 'rejected', 'expired', 'converted'];
export const STRUCTURE_TYPES = ['high_rise', 'tin_shed', 'rcc_rooftop', 'ground_mount'];
export const ATTACHMENT_KINDS = ['original_manual', 'signed_copy', 'other'];

/** Hard ceiling for BOQ lines. The configurable, page-fitting limit lives on
 *  CompanyProfile.quotationItemLimit and is enforced in the service. */
export const MAX_ITEM_LINES = 30;

const itemSchema = new Schema(
  {
    description: {
      type: String,
      required: [true, 'BOQ line description is required'],
      trim: true,
      maxlength: [300, 'BOQ line description cannot exceed 300 characters'],
    },
    brandModel: { type: String, trim: true, maxlength: 120, default: '' },
    qty: {
      type: Number,
      required: [true, 'BOQ line quantity is required'],
      min: [0.001, 'BOQ line quantity must be greater than 0'],
    },
    unit: {
      type: String,
      trim: true,
      lowercase: true,
      default: null,
      validate: {
        validator: (v) => v === null || v === undefined || v === '' || QUOTATION_UNITS.includes(v),
        message: `Unit must be one of: ${QUOTATION_UNITS.join(', ')} (or left blank)`,
      },
    },
    amount: { type: Number, min: [0, 'Amount cannot be negative'], default: null },
    isOptional: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
  },
  { _id: true }
);

const termSchema = new Schema(
  {
    label: { type: String, trim: true, maxlength: 60, default: null },
    text: { type: String, required: true, trim: true, maxlength: 300 },
  },
  { _id: false }
);

const paymentTermSchema = new Schema(
  { text: { type: String, required: true, trim: true, maxlength: 200 } },
  { _id: false }
);

const attachmentSchema = new Schema(
  {
    kind: {
      type: String,
      enum: { values: ATTACHMENT_KINDS, message: 'Invalid attachment kind' },
      default: 'original_manual',
    },
    url: { type: String, required: true, trim: true },
    publicId: { type: String, trim: true, default: null },
    fileName: { type: String, trim: true, default: '' },
    fileSize: { type: Number, default: null },
    mimeType: { type: String, trim: true, default: '' },
    uploadedAt: { type: Date, default: Date.now },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { _id: true }
);

/** Frozen copy of the company details, so reprinting an old quotation never
 *  changes because a setting was edited later. */
const companySnapshotSchema = new Schema(
  {
    name: { type: String, trim: true, default: '' },
    addressLines: { type: [String], default: [] },
    phone: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, default: '' },
    gstn: { type: String, trim: true, default: '' },
    stateCode: { type: String, trim: true, default: '' },
    bankName: { type: String, trim: true, default: '' },
    accountName: { type: String, trim: true, default: '' },
    accountNumber: { type: String, trim: true, default: '' },
    ifsc: { type: String, trim: true, default: '' },
    quotationTitle: { type: String, trim: true, default: '' },
    logoPath: { type: String, trim: true, default: '' },
    /**
     * The fixed wording as it stood when the quotation was issued. Kept on the
     * snapshot so a record imported from the old register - which carries no
     * terms of its own - still prints the standard terms instead of a blank block.
     */
    terms: { type: [termSchema], default: [] },
    paymentTerms: { type: [paymentTermSchema], default: [] },
  },
  { _id: false }
);

const shipToSchema = new Schema(
  {
    name: { type: String, trim: true, maxlength: 120, default: '' },
    addressLines: { type: [String], default: [] },
    phone: { type: String, trim: true, maxlength: 20, default: '' },
  },
  { _id: false }
);

const revisionSchema = new Schema(
  {
    at: { type: Date, default: Date.now },
    by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    action: { type: String, trim: true, maxlength: 40, default: 'update' },
    changedFields: { type: [String], default: [] },
    /** Values as they were *before* the change. */
    previousValues: { type: Schema.Types.Mixed, default: {} },
  },
  { _id: true }
);

const QuotationSchema = new Schema(
  {
    // ---------------------------------------------------------------- identity
    quotationNo: {
      type: String,
      required: [true, 'Quotation number is required'],
      trim: true,
      unique: false, // uniqueness is enforced by the partial indexes below
      maxlength: 60,
    },
    quotationSeq: {
      type: Number,
      required: [true, 'Quotation sequence is required'],
      min: [1, 'Quotation sequence must be at least 1'],
    },
    financialYear: {
      type: String,
      required: [true, 'Financial year is required'],
      trim: true,
      validate: {
        validator: (v) => Boolean(parseFinancialYear(v)),
        message: 'Financial year must look like 2026-27',
      },
    },
    schemeCode: {
      type: String,
      required: [true, 'Scheme code is required'],
      trim: true,
      uppercase: true,
      match: [/^[A-Z0-9]{2,12}$/, 'Scheme code must be 2-12 alphanumeric characters'],
      set: (v) => normaliseSchemeCode(v),
    },
    schemeLabel: { type: String, trim: true, maxlength: 160, default: '' },

    // ---------------------------------------------------------------- customer
    customer: { type: Schema.Types.ObjectId, ref: 'Customer', default: null, index: true },
    customerName: {
      type: String,
      required: [true, 'Customer name is required'],
      trim: true,
      maxlength: [120, 'Customer name cannot exceed 120 characters'],
    },
    consumerId: { type: String, trim: true, maxlength: 20, default: '' },
    phoneNo: { type: String, trim: true, maxlength: 20, default: '' },
    addressLine1: { type: String, trim: true, maxlength: 200, default: '' },
    addressLine2: { type: String, trim: true, maxlength: 200, default: '' },
    district: { type: String, trim: true, maxlength: 80, default: '' },
    pincode: { type: String, trim: true, maxlength: 10, default: '' },
    shipTo: { type: shipToSchema, default: () => ({}) },

    // ------------------------------------------------------------------ system
    /**
     * Optional at the storage layer on purpose: records imported from the old
     * manual register only carry a number, a name and (sometimes) a date. The
     * API requires it for quotations created in the app
     * (see validations/quotation.validation.js).
     */
    systemSizeKW: {
      type: Number,
      min: [0.1, 'System size must be at least 0.1 kW'],
      max: [100, 'System size cannot exceed 100 kW'],
      default: null,
    },
    panelWp: { type: Number, min: 100, max: 1000, default: null },
    panelQty: { type: Number, min: 1, default: null },
    panelBrand: { type: String, trim: true, maxlength: 120, default: '' },
    inverterCapacityKW: { type: Number, min: [0.1, 'Inverter capacity must be at least 0.1 kW'], default: null },
    inverterBrand: { type: String, trim: true, maxlength: 120, default: '' },
    structureType: {
      type: String,
      enum: { values: STRUCTURE_TYPES, message: 'Invalid structure type' },
      default: 'high_rise',
    },
    systemOverview: { type: String, trim: true, maxlength: 600, default: '' },

    // --------------------------------------------------------------------- BOQ
    items: {
      type: [itemSchema],
      default: [],
      validate: {
        validator: (items) => Array.isArray(items) && items.length <= MAX_ITEM_LINES,
        message: `A quotation can have at most ${MAX_ITEM_LINES} BOQ lines`,
      },
    },

    // ------------------------------------------------------------------- money
    amount: { type: Number, min: [0, 'Amount cannot be negative'], default: null },
    amountIncludesGST: { type: Boolean, default: true },
    amountInWords: { type: String, trim: true, maxlength: 300, default: '' },

    // -------------------------------------------------------------- text blocks
    terms: {
      type: [termSchema],
      default: [],
      validate: {
        validator: (terms) => Array.isArray(terms) && terms.length <= 12,
        message: 'At most 12 terms lines fit on one page',
      },
    },
    paymentTerms: {
      type: [paymentTermSchema],
      default: [],
      validate: {
        validator: (terms) => Array.isArray(terms) && terms.length <= 3,
        message: 'At most 3 payment term lines fit on one page',
      },
    },

    // ----------------------------------------------------------------- company
    companySnapshot: { type: companySnapshotSchema, default: () => ({}) },

    // ---------------------------------------------------------------- lifecycle
    /**
     * Optional at the storage layer: 10 rows of the legacy register have no
     * date at all. Required for quotations created through the API.
     */
    issueDate: { type: Date, default: null },
    validUntil: { type: Date, default: null },
    /** Validity promised on this quotation, in days (copied from the company
     *  profile at creation time so an old quotation keeps its own validity). */
    validityDays: { type: Number, min: 1, max: 365, default: null },
    status: {
      type: String,
      enum: { values: QUOTATION_STATUSES, message: 'Invalid quotation status' },
      default: 'draft',
      index: true,
    },
    convertedInstallation: { type: Schema.Types.ObjectId, ref: 'Installation', default: null },
    conversionDate: { type: Date, default: null },

    // ------------------------------------------------------- attachments & log
    attachments: { type: [attachmentSchema], default: [] },
    revisions: { type: [revisionSchema], default: [] },
    notes: { type: String, trim: true, maxlength: 1000, default: '' },

    /** True for records imported from the old manual register. */
    isHistorical: { type: Boolean, default: false, index: true },
    importedFrom: { type: String, trim: true, default: null },
    importedAt: { type: Date, default: null },
    importedSlNo: { type: Number, default: null },

    // ------------------------------------------------------------ soft delete
    isActive: { type: Boolean, default: true, index: true },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    deleteReason: { type: String, trim: true, maxlength: 300, default: '' },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ============================================================================
// INDEXES
//
// Both uniqueness constraints are PARTIAL on `isActive: true` on purpose. A
// soft-deleted quotation must not block its number from being issued again
// (deleting the last quotation frees that number for the next one), while two
// live quotations can never share a number or a sequence slot.
// ============================================================================
QuotationSchema.index(
  { quotationNo: 1 },
  { unique: true, partialFilterExpression: { isActive: true }, name: 'uniq_active_quotation_no' }
);
QuotationSchema.index(
  { financialYear: 1, quotationSeq: 1 },
  { unique: true, partialFilterExpression: { isActive: true }, name: 'uniq_active_fy_seq' }
);
QuotationSchema.index({ financialYear: 1, schemeCode: 1, issueDate: -1 }, { name: 'fy_scheme_date' });
QuotationSchema.index({ isActive: 1, financialYear: 1, quotationSeq: 1 }, { name: 'register_order' });
QuotationSchema.index({ customer: 1, issueDate: -1 }, { name: 'customer_date' });
QuotationSchema.index(
  { customerName: 'text', consumerId: 'text', quotationNo: 'text' },
  { name: 'quotation_search_index' }
);

// ============================================================================
// HOOKS  (synchronous — no `next` callback, Kareem only awaits returned promises)
// ============================================================================
QuotationSchema.pre('validate', function () {
  // Financial year always follows the issue date.
  if (this.issueDate) {
    const fy = financialYearOf(this.issueDate);
    if (fy) this.financialYear = fy;
  }

  const validityDays = Number(this.validityDays);
  if (!this.validUntil && this.issueDate && Number.isInteger(validityDays) && validityDays > 0) {
    const until = new Date(this.issueDate);
    until.setDate(until.getDate() + validityDays);
    this.validUntil = until;
  }

  // Amount in words is derived, but only when the caller did not write one.
  if (this.amount !== null && this.amount !== undefined && !this.amountInWords) {
    this.amountInWords = amountInWords(this.amount);
  }

  // Normalise lightly-formatted user input.
  if (typeof this.phoneNo === 'string') this.phoneNo = this.phoneNo.replace(/[\s-]/g, '');
  if (typeof this.consumerId === 'string') this.consumerId = this.consumerId.replace(/[\s-]/g, '');
  if (typeof this.pincode === 'string') this.pincode = this.pincode.trim();
  if (Array.isArray(this.items)) {
    this.items.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }
});

/** Keep the revision log bounded so a long-lived quotation cannot grow forever. */
QuotationSchema.pre('save', function () {
  if (Array.isArray(this.revisions) && this.revisions.length > 30) {
    this.revisions = this.revisions.slice(-30);
  }
});

// ============================================================================
// VIRTUALS
// ============================================================================
QuotationSchema.virtual('formattedAmount').get(function () {
  return this.amount === null || this.amount === undefined ? '' : formatQuotationAmount(this.amount);
});

QuotationSchema.virtual('isDeleted').get(function () {
  return this.isActive === false;
});

/** A register-only record has no BOQ/amount yet and can be completed later. */
QuotationSchema.virtual('isComplete').get(function () {
  return Array.isArray(this.items) && this.items.length > 0 && this.amount !== null && this.amount !== undefined;
});

QuotationSchema.virtual('customerAddress').get(function () {
  return [this.addressLine1, this.addressLine2, this.district, this.pincode]
    .map((part) => (part || '').trim())
    .filter(Boolean)
    .join(', ');
});

// ============================================================================
// STATICS
// ============================================================================
/**
 * Highest active sequence used in a financial year. Drives the "max + 1"
 * allocation rule that reuses the number of a deleted tail quotation.
 * @returns {Promise<Number>} 0 when the year has no quotations yet
 */
QuotationSchema.statics.getMaxSequence = async function getMaxSequence(financialYear) {
  const doc = await this.findOne({ financialYear, isActive: true })
    .sort({ quotationSeq: -1 })
    .select('quotationSeq')
    .lean();

  return doc?.quotationSeq ?? 0;
};

const Quotation = mongoose.model('Quotation', QuotationSchema);

export default Quotation;
