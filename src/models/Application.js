// src/models/Application.js
import mongoose from 'mongoose';
import {
  DOCUMENT_KINDS,
  SITE_TYPE_VALUES,
  APPLICATION_STATUS_VALUES,
  BILL_PORTAL_URL,
  isTrustedBillPortalUrl,
} from '../data/applicationChecklist.js';

const { Schema } = mongoose;

/**
 * A document attached to an application.
 *
 * `qualityCheck` holds the offline clarity verdict computed when the file was
 * uploaded (resolution, blur, brightness, glare). `review` is the human verdict
 * the admin gives later — the two are deliberately separate, because a photo can
 * pass the automatic check and still be the wrong document.
 */
const ApplicationDocumentSchema = new Schema(
  {
    kind: {
      type: String,
      required: true,
      enum: DOCUMENT_KINDS,
    },

    url: {
      type: String,
      required: true,
      trim: true,
    },

    publicId: {
      type: String,
      trim: true,
      description: 'Cloudinary public_id, kept so the asset can be deleted later',
    },

    fileName: {
      type: String,
      required: true,
      trim: true,
    },

    fileSize: Number,
    mimeType: {
      type: String,
      trim: true,
    },

    /**
     * Extra typed fields for documents that carry structured data — currently
     * only the bank passbook / cheque (account number, IFSC, branch, type).
     */
    extras: {
      accountNumber: { type: String, trim: true },
      ifsc: { type: String, trim: true, uppercase: true },
      branchName: { type: String, trim: true },
      accountType: {
        type: String,
        enum: ['savings', 'current', 'cash_credit', 'other', null],
        default: null,
      },
    },

    qualityCheck: {
      verdict: {
        type: String,
        enum: ['pass', 'fail', 'skipped'],
        default: 'skipped',
      },
      score: { type: Number, min: 0, max: 100 },
      reasons: [{ type: String, trim: true }],
      metrics: { type: Schema.Types.Mixed },
      checkedAt: Date,
    },

    review: {
      status: {
        type: String,
        enum: ['pending', 'accepted', 'rejected'],
        default: 'pending',
      },
      reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
      reviewedAt: Date,
      reason: { type: String, trim: true },
    },

    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

/** One line of the application's status trail. Never edited after the fact. */
const StatusHistorySchema = new Schema(
  {
    status: { type: String, enum: APPLICATION_STATUS_VALUES, required: true },
    at: { type: Date, default: Date.now },
    by: { type: Schema.Types.ObjectId, ref: 'User' },
    byNameSnapshot: { type: String, trim: true },
    note: { type: String, trim: true, maxlength: 1000 },
  },
  { _id: false }
);

const ApplicationSchema = new Schema(
  {
    // ---------------------------------------------------------------- identity
    applicationNo: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    // ------------------------------------------------------------------- agent
    agent: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Agent is required'],
      index: true,
    },

    /** Frozen at creation so history survives a rename or a deleted agent. */
    agentNameSnapshot: { type: String, trim: true },

    // ------------------------------------------------- consumer (the applicant)
    consumerName: {
      type: String,
      required: [true, 'Consumer name is required'],
      trim: true,
      minlength: [2, 'Consumer name must be at least 2 characters'],
      maxlength: [100, 'Consumer name cannot exceed 100 characters'],
    },

    /**
     * Aadhaar is stored as digits only. It is the key the duplicate check uses,
     * because one consumer may raise only one PM Surya Ghar application.
     */
    aadhaarNumber: {
      type: String,
      trim: true,
      match: [/^[0-9]{12}$/, 'Aadhaar number must be 12 digits'],
    },

    panNumber: {
      type: String,
      trim: true,
      uppercase: true,
      match: [/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, 'Please enter a valid PAN number'],
    },

    phone: {
      type: String,
      required: [true, 'Mobile number is required'],
      trim: true,
      match: [/^[0-9]{10}$/, 'Please enter a valid 10-digit mobile number'],
    },

    alternatePhone: {
      type: String,
      trim: true,
      match: [/^[0-9]{10}$/, 'Please enter a valid 10-digit mobile number'],
    },

    email: { type: String, trim: true, lowercase: true },

    // -------------------------------------------------------- site (address)
    address: {
      street: { type: String, trim: true, maxlength: 200 },
      village: { type: String, trim: true, maxlength: 100 },
      block: { type: String, trim: true, maxlength: 100 },
      panchayat: { type: String, trim: true, maxlength: 100 },
      district: { type: String, trim: true, maxlength: 100 },
      city: { type: String, trim: true, maxlength: 100 },
      state: { type: String, trim: true, maxlength: 100 },
      pincode: { type: String, trim: true, match: [/^[0-9]{6}$/, 'Please enter a valid 6-digit pincode'] },
      landmark: { type: String, trim: true, maxlength: 200 },
      /** Free text kept for the full postal line when it does not fit the fields. */
      fullAddress: { type: String, trim: true, maxlength: 500 },
    },

    /**
     * Where the panels will actually go. Drives the mounting design, so it is
     * asked at the site visit rather than inferred later.
     */
    siteType: {
      type: String,
      enum: {
        values: [...SITE_TYPE_VALUES, null],
        message: `Site type must be one of: ${SITE_TYPE_VALUES.join(', ')}`,
      },
      default: null,
    },

    /** Anything the agent noticed about the roof: shadow, height, access. */
    siteNotes: { type: String, trim: true, maxlength: 1000 },

    // -------------------------------------------------------------- the deal
    deal: {
      systemSizeKW: { type: Number, min: 0.1, max: 1000 },
      proposalAmount: { type: Number, min: 0, max: 100000000 },
      /** Quoted to the consumer; kept separately from the invoice total. */
      quotedAmount: { type: Number, min: 0, max: 100000000 },
      intentionToProceed: {
        type: String,
        enum: ['yes', 'no', 'undecided', null],
        default: null,
      },
    },

    // ------------------------------------------------------------ loan status
    /**
     * The agent has to ask the consumer whether a loan is already running, and
     * tell the office if it is — a live loan changes how the subsidy is routed.
     */
    loan: {
      asked: { type: Boolean, default: false },
      hasExistingLoan: { type: Boolean, default: null },
      lenderName: { type: String, trim: true, maxlength: 200 },
      loanAmount: { type: Number, min: 0 },
      outstandingAmount: { type: Number, min: 0 },
      monthlyEmi: { type: Number, min: 0 },
      /** True once the agent has told the consumer about the subsidy impact. */
      consumerInformed: { type: Boolean, default: false },
      remark: { type: String, trim: true, maxlength: 1000 },
    },

    /**
     * The consumer's credit position, as the agent was able to confirm it.
     *
     * Not a gate anywhere: a vendor cannot pull a bureau score, so this records
     * what was asked, how it was answered, and what `assessCredit()` made of it.
     * Every field is optional and no submit check reads this block — a doubtful
     * score is a warning shown to the agent, never a reason to hold a record.
     */
    creditCheck: {
      /** Lender the loan is expected from; matches a code in data/lenderCriteria.js. */
      bank: { type: String, trim: true, uppercase: true, maxlength: 40 },
      method: {
        type: String,
        enum: ['consumer_self_check', 'bank_portal', 'agent_estimate', 'other'],
        default: 'consumer_self_check',
      },
      score: { type: Number, min: 0, max: 900, default: null },
      defaultOrWriteOff: { type: Boolean, default: false },
      newToCredit: { type: Boolean, default: false },
      /** Recomputed by the server; the client's opinion is never trusted. */
      status: {
        type: String,
        enum: ['pass', 'review', 'fail', 'not_checked'],
        default: 'not_checked',
      },
      headline: { type: String, trim: true, maxlength: 300 },
      detail: { type: String, trim: true, maxlength: 600 },
      checkedAt: Date,
      checkedBy: { type: Schema.Types.ObjectId, ref: 'User' },
      note: { type: String, trim: true, maxlength: 500 },
    },

    // ------------------------------------------------------------- documents
    documents: [ApplicationDocumentSchema],

    // ---------------------------------------------------- electricity bill
    electricBill: {
      consumerId: { type: String, trim: true, uppercase: true },
      installationNo: { type: String, trim: true, uppercase: true },
      portalUrl: {
        type: String,
        trim: true,
        default: BILL_PORTAL_URL,
        validate: {
          validator: (value) => !value || isTrustedBillPortalUrl(value),
          message: 'Bill portal URL must point at the electricity board site',
        },
      },
      /** Bill file downloaded from the portal and stored by the agent. */
      fileUrl: { type: String, trim: true },
      fileName: { type: String, trim: true },
      /** True once the two ids and the uploaded bill were confirmed to agree. */
      verified: { type: Boolean, default: false },
      verifiedAt: Date,
      verifiedBy: { type: Schema.Types.ObjectId, ref: 'User' },
      verificationNote: { type: String, trim: true, maxlength: 1000 },
    },

    /**
     * The name on the Aadhaar, the bank passbook and the electricity bill must
     * agree — case differences are fine, a real mismatch is not. The agent reads
     * the name off each document and types it here; `checkNameMatch` (see
     * src/utils/nameMatch.js) folds case, punctuation and honorifics and decides
     * the verdict, so the office does not have to re-derive it.
     */
    nameMatch: {
      consumerName: { type: String, trim: true },
      aadhaarName: { type: String, trim: true },
      passbookName: { type: String, trim: true },
      electricBillName: { type: String, trim: true },
      verdict: {
        type: String,
        enum: ['match', 'near_match', 'mismatch', 'incomplete', null],
        default: null,
      },
      passed: { type: Boolean, default: null },
      mismatched: [{ type: String, trim: true }],
      message: { type: String, trim: true, maxlength: 1000 },
      checkedAt: Date,
      checkedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    },

    // -------------------------------------------------------------- workflow
    status: {
      type: String,
      enum: APPLICATION_STATUS_VALUES,
      default: 'draft',
      index: true,
    },

    statusHistory: [StatusHistorySchema],

    submittedAt: Date,

    review: {
      reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
      reviewedBySnapshot: { type: String, trim: true },
      reviewedAt: Date,
      remark: { type: String, trim: true, maxlength: 2000 },
      /** Plain-language reason shown to the agent when a correction is needed. */
      rejectionReason: { type: String, trim: true, maxlength: 2000 },
      /** Per-document verdicts keyed by document _id, for the checklist UI. */
    },

    // ------------------------------------------------------------------ links
    customer: { type: Schema.Types.ObjectId, ref: 'Customer' },
    quotation: { type: Schema.Types.ObjectId, ref: 'Quotation' },
    agreement: { type: Schema.Types.ObjectId, ref: 'Agreement' },
    installation: { type: Schema.Types.ObjectId, ref: 'Installation' },

    // --------------------------------------------------------------- metadata
    isActive: { type: Boolean, default: true, index: true },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ==================== VIRTUALS ====================

ApplicationSchema.virtual('documentsByKind').get(function () {
  return (this.documents || []).reduce((acc, doc) => {
    if (!acc[doc.kind]) acc[doc.kind] = [];
    acc[doc.kind].push(doc);
    return acc;
  }, {});
});

ApplicationSchema.virtual('fullSiteAddress').get(function () {
  const a = this.address || {};
  return [a.fullAddress, a.street, a.village, a.block, a.panchayat, a.district, a.city, a.state, a.pincode]
    .filter(Boolean)
    .join(', ');
});

// ==================== METHODS ====================

ApplicationSchema.methods = {
  /** Statuses an agent may still edit (draft / sent back for correction). */
  isAgentEditable: function () {
    return ['draft', 'correction_required'].includes(this.status);
  },

  /** Documents can still be added or removed. */
  isDocumentEditable: function () {
    return ['draft', 'correction_required', 'submitted', 'under_review'].includes(this.status);
  },

  hasDocument: function (kind) {
    return (this.documents || []).some((doc) => doc.kind === kind);
  },

  /**
   * Push a status change onto the trail. Callers are responsible for checking
   * `canTransition` first — this only records what happened.
   */
  pushStatus: function (status, user, note) {
    this.status = status;
    this.statusHistory.push({
      status,
      at: new Date(),
      by: user?._id,
      byNameSnapshot: user?.name,
      note,
    });

    if (status === 'submitted' && !this.submittedAt) {
      this.submittedAt = new Date();
    }

    return this;
  },
};

// ==================== STATICS ====================

ApplicationSchema.statics = {
  /**
   * Next application number, e.g. SE/APP/2026-27/14.
   *
   * Uses the shared Counter so two agents saving at the same moment cannot be
   * handed the same number.
   */
  async generateApplicationNo() {
    const Counter = mongoose.model('Counter');
    const counter = await Counter.findByIdAndUpdate(
      'applicationId',
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );
    const year = new Date().getFullYear();
    return `SE/APP/${year}/${String(counter.seq).padStart(4, '0')}`;
  },

  /** Applications raised by one agent, newest first. */
  getByAgent(agentId, filter = {}) {
    return this.find({ agent: agentId, isActive: true, ...filter })
      .sort({ createdAt: -1 })
      .populate('customer', 'name customerId phone');
  },
};

// ==================== HOOKS ====================

ApplicationSchema.pre('save', function (next) {
  // Aadhaar is compared as digits, so normalise it once here rather than in
  // every query. Spaces and dashes are how people actually type it.
  if (this.isModified('aadhaarNumber') && this.aadhaarNumber) {
    this.aadhaarNumber = String(this.aadhaarNumber).replace(/[^0-9]/g, '');
  }

  if (!this.statusHistory || this.statusHistory.length === 0) {
    this.statusHistory = [
      {
        status: this.status || 'draft',
        at: new Date(),
        by: this.createdBy,
      },
    ];
  }
});

// ==================== INDEXES ====================

// Unique among live rows only: a soft-deleted application must not hold the
// number, and a rejected consumer has to be able to file again.
ApplicationSchema.index(
  { applicationNo: 1 },
  { unique: true, partialFilterExpression: { isActive: true } }
);

ApplicationSchema.index({ agent: 1, status: 1, createdAt: -1 });
ApplicationSchema.index({ status: 1, createdAt: -1 });
ApplicationSchema.index({ phone: 1, isActive: 1 });
ApplicationSchema.index({ aadhaarNumber: 1, isActive: 1 });
ApplicationSchema.index({ createdAt: -1 });

const Application = mongoose.model('Application', ApplicationSchema);

export default Application;
