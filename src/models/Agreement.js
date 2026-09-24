// src/models/Agreement.js
import mongoose from 'mongoose';
import { formatAgreementDateParts, buildPaymentSchedule } from '../utils/agreementText.js';
import { DEFAULT_DISCOM } from '../data/agreementContent.js';

const { Schema } = mongoose;

/** One milestone of the 50 / 40 / 10 payment schedule, frozen at save time. */
const paymentStageSchema = new Schema(
  {
    label: { type: String, trim: true, maxlength: 10 },
    percent: { type: Number, min: 0, max: 100 },
    amount: { type: Number, min: 0 },
    amountText: { type: String, trim: true, maxlength: 30 },
    note: { type: String, trim: true, maxlength: 400 },
  },
  { _id: false }
);

/**
 * Snapshot of the company details printed on the agreement. The agreement uses
 * the longer "registered office" wording, which is why it is kept separately
 * from the quotation's address lines.
 */
const companySnapshotSchema = new Schema(
  {
    name: { type: String, trim: true, maxlength: 120, default: '' },
    registeredOffice: { type: String, trim: true, maxlength: 300, default: '' },
    phone: { type: String, trim: true, maxlength: 20, default: '' },
    email: { type: String, trim: true, maxlength: 120, default: '' },
    gstn: { type: String, trim: true, uppercase: true, maxlength: 20, default: '' },
    logoPath: { type: String, trim: true, default: '' },
  },
  { _id: false }
);

const AgreementSchema = new Schema(
  {
    // ---- page 1: the consumer ----
    consumerName: {
      type: String,
      required: [true, 'Consumer name is required'],
      trim: true,
      minlength: [2, 'Consumer name is too short'],
      maxlength: [120, 'Consumer name cannot exceed 120 characters'],
    },
    consumerId: {
      type: String,
      trim: true,
      default: '',
      validate: {
        validator: (value) => !value || /^[0-9]{5,20}$/.test(value),
        message: 'Consumer ID must be 5 to 20 digits',
      },
    },
    /** "W/o-dharanidhar Pramanick", "S/o-...", "D/o-..." - optional. */
    relationLine: { type: String, trim: true, maxlength: 80, default: '' },
    /** Free text as printed, including the PIN. */
    address: {
      type: String,
      required: [true, 'Consumer address is required'],
      trim: true,
      maxlength: [400, 'Address cannot exceed 400 characters'],
    },
    discom: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 40,
      default: DEFAULT_DISCOM,
    },
    agreementDate: { type: Date, required: [true, 'Agreement date is required'], default: Date.now },

    // ---- page 4: money ----
    amount: {
      type: Number,
      required: [true, 'Agreement amount is required'],
      min: [0, 'Amount cannot be negative'],
      max: [100000000, 'Amount looks wrong'],
    },
    /** 50 / 40 / 10 of `amount`, stored so a reprint never recalculates differently. */
    paymentSchedule: { type: [paymentStageSchema], default: [] },

    // ---- links ----
    /** Set when the agreement was created from a quotation. */
    quotation: { type: Schema.Types.ObjectId, ref: 'Quotation', default: null },
    quotationNo: { type: String, trim: true, maxlength: 50, default: '' },

    // ---- meta ----
    notes: { type: String, trim: true, maxlength: 1000, default: '' },
    companySnapshot: { type: companySnapshotSchema, default: () => ({}) },

    isActive: { type: Boolean, default: true },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    deleteReason: { type: String, trim: true, maxlength: 200, default: '' },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ---- indexes ----
AgreementSchema.index({ agreementDate: -1 });
AgreementSchema.index({ createdAt: -1 });
// Search: customer name and consumer id are what the office actually looks up.
AgreementSchema.index({ consumerName: 'text', consumerId: 'text' });

// ---- virtuals ----
AgreementSchema.virtual('dateParts').get(function dateParts() {
  return formatAgreementDateParts(this.agreementDate);
});

AgreementSchema.virtual('amountText').get(function amountText() {
  const last = this.paymentSchedule?.[this.paymentSchedule.length - 1];
  return last ? String(this.amount) : String(this.amount ?? '');
});

// ---- hooks ----
AgreementSchema.pre('validate', function rebuildSchedule() {
  // The schedule is always derived from the amount, so the two can never disagree.
  const amount = Number(this.amount);
  if (Number.isFinite(amount) && amount >= 0) {
    this.paymentSchedule = buildPaymentSchedule(amount);
  }
});

AgreementSchema.pre('save', function trimStrings() {
  if (this.consumerId) this.consumerId = String(this.consumerId).replace(/\s+/g, '');
  if (this.address) this.address = String(this.address).replace(/\s+/g, ' ').trim();
  if (this.relationLine) this.relationLine = String(this.relationLine).trim();
  if (this.consumerName) this.consumerName = String(this.consumerName).trim();
});

const Agreement = mongoose.models.Agreement || mongoose.model('Agreement', AgreementSchema);

export default Agreement;
