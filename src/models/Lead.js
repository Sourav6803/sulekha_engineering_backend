// src/models/Lead.js
import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * An enquiry from the public website.
 *
 * This is the other end of the marketing work: a visitor reads the site, or
 * scans a printed banner's QR code, and leaves a phone number. The row is
 * deliberately separate from `Customer` — an enquiry is not a customer until
 * someone has spoken to them, and mixing the two would pollute the customer list
 * with people who never answered.
 *
 * Written only through the public endpoint, which accepts nothing but the fields
 * below; read and updated by the office.
 */

export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'converted', 'closed'];

/** Where an enquiry came from, coarse enough to be useful in a report. */
export const LEAD_SOURCES = ['website', 'banner_qr', 'whatsapp', 'phone', 'referral', 'other'];

const LeadSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters'],
      maxlength: [80, 'Name cannot exceed 80 characters'],
    },

    phone: {
      type: String,
      required: [true, 'Phone number is required'],
      trim: true,
      match: [/^[0-9]{10}$/, 'Please enter a valid 10-digit phone number'],
      index: true,
    },

    /** Optional: plenty of people leave only a number. */
    email: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: [120, 'Email cannot exceed 120 characters'],
    },

    district: {
      type: String,
      trim: true,
      maxlength: [60, 'District cannot exceed 60 characters'],
      index: true,
    },

    state: {
      type: String,
      trim: true,
      default: 'West Bengal',
    },

    /** What the visitor is interested in, in kW. A guess is fine. */
    systemSizeKW: {
      type: Number,
      min: [0, 'System size cannot be negative'],
      max: [1000, 'System size looks wrong'],
    },

    message: {
      type: String,
      trim: true,
      maxlength: [1000, 'Message cannot exceed 1000 characters'],
    },

    // ------------------------------------------------------------- attribution
    source: {
      type: String,
      enum: LEAD_SOURCES,
      default: 'website',
      index: true,
    },

    /** Copied from the landing URL so a printed banner can be measured. */
    utm: {
      source: { type: String, trim: true, maxlength: 80 },
      medium: { type: String, trim: true, maxlength: 80 },
      campaign: { type: String, trim: true, maxlength: 80 },
      content: { type: String, trim: true, maxlength: 80 },
      term: { type: String, trim: true, maxlength: 80 },
    },

    /** The page the form was submitted from, without its query string. */
    pagePath: {
      type: String,
      trim: true,
      maxlength: 200,
    },

    userAgent: {
      type: String,
      trim: true,
      maxlength: 300,
    },

    // ------------------------------------------------------------------office
    status: {
      type: String,
      enum: LEAD_STATUSES,
      default: 'new',
      index: true,
    },

    assignedTo: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },

    /** Short internal trail: "called, not reachable", "survey booked Friday". */
    notes: [
      {
        text: { type: String, trim: true, maxlength: 500 },
        by: { type: Schema.Types.ObjectId, ref: 'User' },
        byName: { type: String, trim: true },
        at: { type: Date, default: Date.now },
      },
    ],

    /** Set when the office links this enquiry to a real customer record. */
    customerId: {
      type: Schema.Types.ObjectId,
      ref: 'Customer',
    },

    contactedAt: Date,
    convertedAt: Date,

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  { timestamps: true }
);

// ==================== METHODS ====================

/** What the office sees in a list. */
LeadSchema.methods.toAdminJSON = function () {
  return {
    id: this._id,
    name: this.name,
    phone: this.phone,
    email: this.email || null,
    district: this.district || null,
    state: this.state || null,
    systemSizeKW: this.systemSizeKW ?? null,
    message: this.message || null,
    source: this.source,
    utm: this.utm || {},
    pagePath: this.pagePath || null,
    status: this.status,
    assignedTo: this.assignedTo || null,
    notes: this.notes || [],
    customerId: this.customerId || null,
    contactedAt: this.contactedAt || null,
    convertedAt: this.convertedAt || null,
    createdAt: this.createdAt,
  };
};

// ==================== INDEXES ====================

// "Newest first, optionally by status or district" is the only list view.
LeadSchema.index({ isActive: 1, createdAt: -1 });
LeadSchema.index({ isActive: 1, status: 1, createdAt: -1 });
LeadSchema.index({ isActive: 1, district: 1, createdAt: -1 });
// One number enquiring twice in a day is usually a double submit, not a new lead.
LeadSchema.index({ phone: 1, createdAt: -1 });

const Lead = mongoose.model('Lead', LeadSchema);
export default Lead;
