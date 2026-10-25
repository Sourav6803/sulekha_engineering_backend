// src/models/Customer.js
import mongoose from 'mongoose';

const { Schema } = mongoose;

const CustomerSchema = new Schema({
  // Primary Identifier
  customerId: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },

  // Personal Information
  name: {
    type: String,
    required: [true, 'Customer name is required'],
    trim: true,
    minlength: [2, 'Name must be at least 2 characters'],
    maxlength: [100, 'Name cannot exceed 100 characters']
  },

  phone: {
    type: String,
    required: [true, 'Phone number is required'],
    trim: true,
    match: [/^[0-9]{10}$/, 'Please enter a valid 10-digit phone number']
  },

  alternatePhone: {
    type: String,
    trim: true,
    match: [/^[0-9]{10}$/, 'Please enter a valid 10-digit phone number']
  },

  email: {
    type: String,
    trim: true,
    lowercase: true,
    match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email address']
  },

  // Address Information
  address: {
    type: String,
    required: [true, 'Address is required'],
    trim: true,
    maxlength: [500, 'Address cannot exceed 500 characters']
  },

  street: {
    type: String,
    trim: true,
    maxlength: [200, 'Street cannot exceed 200 characters'],
    description: 'Road / street name (document checklist: রাস্তার নাম)'
  },

  village: {
    type: String,
    trim: true,
    maxlength: [100, 'Village cannot exceed 100 characters']
  },

  block: {
    type: String,
    trim: true,
    maxlength: [100, 'Block cannot exceed 100 characters']
  },

  panchayat: {
    type: String,
    trim: true,
    maxlength: [100, 'Panchayat cannot exceed 100 characters']
  },

  district: {
    type: String,
    trim: true,
    maxlength: [100, 'District cannot exceed 100 characters'],
    description: 'Revenue district (document checklist: জেলা)'
  },

  landmark: {
    type: String,
    trim: true,
    maxlength: [200, 'Landmark cannot exceed 200 characters']
  },

  city: {
    type: String,
    required: [true, 'City is required'],
    trim: true
  },

  state: {
    type: String,
    required: [true, 'State is required'],
    trim: true
  },

  pincode: {
    type: String,
    required: [true, 'Pincode is required'],
    trim: true,
    match: [/^[0-9]{6}$/, 'Please enter a valid 6-digit pincode']
  },

  // System Specifications
  systemSizeKW: {
    type: Number,
    required: [true, 'System size in kW is required'],
    min: [0.1, 'System size must be at least 0.1 kW'],
    /* A PM Surya Ghar residential rooftop is capped at 10 kW: the subsidy table
       stops there and the vendor does not quote above it. */
    max: [10, 'System size cannot exceed 10 kW']
  },

  /*
   * The category the subsidy is calculated on. SC/ST households get the higher
   * rate, and the application cannot be filed without the caste certificate on
   * file — the documents checklist reads this field.
   */
  category: {
    type: String,
    enum: {
      values: ['general', 'obc', 'sc', 'st', null],
      message: 'Category must be one of: general, obc, sc, st'
    },
    default: null
  },

  roofType: {
    type: String,
    required: [true, 'Roof type is required'],
    // Mirrors SITE_TYPES in src/data/applicationChecklist.js: the agent picks
    // this on the application, and it is carried across to the customer and the
    // installation once the application is approved.
    enum: {
      values: ['rcc_rooftop', 'tin_shed', 'high_rise_structure', 'ground_mount'],
      message: 'Roof type must be one of: rcc_rooftop, tin_shed, high_rise_structure, ground_mount'
    }
  },

  roofArea: {
    type: Number,
    min: [0, 'Roof area cannot be negative'],
    max: [10000, 'Roof area cannot exceed 10000 sq ft'],
    description: 'Available roof area in square feet'
  },

  /*
   * The site-visit record.
   *
   * Everything from `siteType` to `creditCheck` used to be typed into the
   * application wizard at the consumer's house. The visit is what produces a
   * customer now, so it is recorded here; an application copies it once when the
   * office files, and never asks for it again.
   */
  siteType: {
    type: String,
    enum: {
      values: ['rcc_rooftop', 'tin_shed', 'high_rise_structure', 'ground_mount', null],
      message: 'Site type must be one of: rcc_rooftop, tin_shed, high_rise_structure, ground_mount'
    },
    default: null
  },

  siteNotes: {
    type: String,
    trim: true,
    maxlength: [1000, 'Site notes cannot exceed 1000 characters']
  },

  deal: {
    proposalAmount: { type: Number, min: 0 },
    quotedAmount: { type: Number, min: 0 },
    intentionToProceed: {
      type: String,
      enum: ['yes', 'no', 'undecided', null],
      default: null
    }
  },

  loan: {
    asked: { type: Boolean, default: false },
    hasExistingLoan: { type: Boolean, default: null },
    lenderName: { type: String, trim: true, maxlength: 200 },
    loanAmount: { type: Number, min: 0 },
    outstandingAmount: { type: Number, min: 0 },
    monthlyEmi: { type: Number, min: 0 },
    consumerInformed: { type: Boolean, default: false },
    remark: { type: String, trim: true, maxlength: 1000 }
  },

  creditCheck: {
    bank: { type: String, trim: true, uppercase: true, maxlength: 40 },
    method: {
      type: String,
      enum: ['consumer_self_check', 'bank_portal', 'agent_estimate', 'other'],
      default: 'consumer_self_check'
    },
    score: { type: Number, min: 0, max: 900, default: null },
    defaultOrWriteOff: { type: Boolean, default: false },
    newToCredit: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ['pass', 'review', 'fail', 'not_checked'],
      default: 'not_checked'
    },
    note: { type: String, trim: true, maxlength: 500 }
  },

  // Additional Details
  gstNumber: {
    type: String,
    trim: true,
    uppercase: true,
    match: [
      /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/,
      'Please enter a valid GST number'
    ],
    description: 'Optional - only for business customers'
  },

  /*
   * The KYC identifiers live on the customer now.
   *
   * They used to be typed into the application form, which meant the same
   * Aadhaar could be stored twice, differently, for the same person. The
   * application snapshots these at creation; this record stays the truth.
   */
  aadhaarNumber: {
    type: String,
    trim: true,
    match: [/^[0-9]{12}$/, 'Aadhaar number must be 12 digits'],
    description: 'Collected from the Aadhaar card; required before an application can be filed'
  },

  panNumber: {
    type: String,
    trim: true,
    uppercase: true,
    match: [
      /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/,
      'Please enter a valid PAN number'
    ],
    description: 'Optional - only for business customers'
  },

  // Installation Preferences
  preferredInstallationDate: {
    type: Date
  },

  preferredTimeSlot: {
    type: String,
    enum: ['morning', 'afternoon', 'evening', 'anytime'],
    default: 'anytime'
  },

  // Customer Status
  status: {
    type: String,
    enum: ['active', 'inactive', 'blocked', 'pending_verification'],
    default: 'active'
  },

  // Additional Information
  notes: {
    type: String,
    trim: true,
    maxlength: [1000, 'Notes cannot exceed 1000 characters']
  },

  // References
  referredBy: {
    type: String,
    trim: true
  },

  // Documents
  documents: [{
    type: {
      type: String,
      required: true,
      enum: [
        'aadhar',
        'voterId',
        'panCard',
        'passbookOrCheque',
        'electricBill',
        'landRecord',
        'sitePhotoBefore',
        'sitePhotoAfter',
        'loanApprovalLetter',
        'rtsFeasibilityReport',
        'feasibilityApproval',
        'agreement',
        'quotation',
        'dcrCertificate',
        'panelSerialNumber',
        // The paperwork that comes back from the government side of the process,
        // filed against the customer once it arrives.
        'eToken',
        'acknowledgement',
        'netMetering',
        // Required when the household is SC/ST and claims the higher subsidy.
        'casteCertificate'
      ]
    },
    url: {
      type: String,
      required: true
    },
    fileName: {
      type: String,
      required: true
    },
    fileSize: {
      type: Number
    },
    fileType: {
      type: String
    },
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }],

  /**
   * The serial number of every panel installed, in the order it was recorded.
   *
   * Text rather than another document: the numbers are read off the panel labels
   * during installation and typed in, and are read back later when the DCR and
   * net-metering paperwork is filed — where a list that can be copied and searched
   * is worth more than a photograph. There is one entry per panel, so how long the
   * list is follows the system size: a 3 kW roof takes six 550 Wp panels, a 1 kW
   * roof two. Free length for that reason, not a fixed slot per size.
   *
   * Trimmed and length-checked by the request schema; a plain string array here so
   * queries over the serials stay simple.
   */
  /*
   * The two ids printed on the consumer's electricity bill. The bill file itself
   * sits in `documents` (type `electricBill`); the admin confirms that the pair
   * agrees when filing the application, so `verified` is only a hint here.
   */
  electricBill: {
    consumerId: { type: String, trim: true, uppercase: true },
    installationNo: { type: String, trim: true, uppercase: true },
    verified: { type: Boolean, default: false }
  },

  /*
   * The bank account the subsidy is routed to, read off the passbook at the
   * house. Typed here rather than on the document record so the office can see
   * it without opening a photo; the passbook scan sits in `documents`.
   */
  bank: {
    accountHolderName: { type: String, trim: true, maxlength: 150 },
    accountNumber: { type: String, trim: true, maxlength: 30 },
    ifsc: { type: String, trim: true, uppercase: true, maxlength: 11 },
    bankName: { type: String, trim: true, maxlength: 120 },
    branch: { type: String, trim: true, maxlength: 120 },
  },

  /*
   * The name read off each paper at the house. The verdict is computed later —
   * case, punctuation and honorifics are folded, a real mismatch is not.
   */
  nameMatch: {
    consumerName: { type: String, trim: true },
    aadhaarName: { type: String, trim: true },
    passbookName: { type: String, trim: true },
    electricBillName: { type: String, trim: true },
    verdict: {
      type: String,
      enum: ['match', 'near_match', 'mismatch', 'incomplete', null],
      default: null
    }
  },

  /*
   * The office's clearance of the intake.
   *
   * Kept apart from `status` on purpose: a customer can be verified today and
   * blocked next month, and the audit needs to know who cleared the papers and
   * when. Only admin and manager may move this — see POST /customers/:id/verify.
   */
  verification: {
    status: {
      type: String,
      enum: ['pending', 'verified', 'rejected'],
      default: 'pending'
    },
    by: { type: Schema.Types.ObjectId, ref: 'User' },
    at: Date,
    note: { type: String, trim: true, maxlength: 1000 }
  },

  panelSerialNumbers: {
    type: [String],
    default: undefined
  },

  // Metadata
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },

  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },

  /*
   * The field agent who brought this customer in.
   *
   * Agents can now create customers, and a customer record carries Aadhaar and
   * bank papers — so an agent may only ever see the ones they collected. The
   * office (admin, manager) is not scoped. Set on create, never reassigned by
   * an update from below, and copied onto the application so the agent keeps
   * visibility of what happened to their customer.
   */
  ownerAgent: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },

  updatedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },

  // Timestamps (handled by Mongoose timestamps)
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// ==================== VIRTUAL FIELDS ====================

// Get total installations for this customer
CustomerSchema.virtual('totalInstallations', {
  ref: 'Installation',
  localField: '_id',
  foreignField: 'customer',
  count: true
});

// Get total system capacity installed
CustomerSchema.virtual('totalSystemCapacity', {
  ref: 'Installation',
  localField: '_id',
  foreignField: 'customer',
  options: { sort: { createdAt: -1 }, limit: 1 },
  justOne: true
});

// Get latest installation
CustomerSchema.virtual('latestInstallation', {
  ref: 'Installation',
  localField: '_id',
  foreignField: 'customer',
  options: { sort: { createdAt: -1 }, limit: 1 },
  justOne: true
});

// ==================== METHODS ====================

CustomerSchema.methods = {
  /**
   * Check if customer is active
   */
  isCurrentlyActive: function() {
    return this.status === 'active' && this.isActive;
  },

  /**
   * Get full address as string
   */
  getFullAddress: function() {
    const parts = [
      this.address,
      this.street,
      this.village,
      this.block,
      this.panchayat,
      this.district,
      this.city,
      this.state,
      this.pincode,
    ].filter(Boolean);

    return parts.join(', ');
  },

  /**
   * Check if customer is GST registered
   */
  hasGST: function() {
    return !!this.gstNumber;
  },

  /**
   * Update customer status
   */
  updateStatus: function(status, userId) {
    this.status = status;
    this.updatedBy = userId;
    return this.save();
  }
};

// ==================== STATIC METHODS ====================

CustomerSchema.statics = {
  /**
   * Generate next customer ID
   */
  async generateCustomerId() {
    const Counter = mongoose.model('Counter');
    const counter = await Counter.findByIdAndUpdate(
      'customerId',
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );
    return `SE-${String(counter.seq).padStart(4, '0')}`;
  },

  /**
   * Find customer by phone
   */
  findByPhone(phone) {
    return this.findOne({ phone, isActive: true });
  },

  /**
   * Search customers by name or phone
   */
  search(query) {
    const searchRegex = new RegExp(query, 'i');
    return this.find({
      $or: [
        { name: searchRegex },
        { phone: searchRegex },
        { customerId: searchRegex }
      ],
      isActive: true
    });
  },

  /**
   * Get customer with all installations
   */
  async getWithInstallations(customerId) {
    return this.findById(customerId)
      .populate({
        path: 'installations',
        populate: {
          path: 'materialsUsed.material',
          model: 'Material'
        }
      });
  },

  /**
   * Get customers with their latest installation
   */
  async getWithLatestInstallation() {
    return this.aggregate([
      { $match: { isActive: true } },
      {
        $lookup: {
          from: 'installations',
          let: { customerId: '$_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$customer', '$$customerId'] } } },
            { $sort: { createdAt: -1 } },
            { $limit: 1 }
          ],
          as: 'latestInstallation'
        }
      },
      { $unwind: { path: '$latestInstallation', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          customerId: 1,
          name: 1,
          phone: 1,
          address: 1,
          city: 1,
          systemSizeKW: 1,
          roofType: 1,
          status: 1,
          latestInstallation: {
            installationId: 1,
            status: 1,
            installDate: 1,
            systemSizeKW: 1
          }
        }
      }
    ]);
  }
};

// ==================== INDEXES ====================

CustomerSchema.index({ name: 1 });
CustomerSchema.index({ phone: 1 }, { unique: true });
CustomerSchema.index({ city: 1, state: 1 });
CustomerSchema.index({ district: 1 });
CustomerSchema.index({ status: 1, isActive: 1 });
CustomerSchema.index({ createdAt: -1 });

// Compound indexes for common queries
CustomerSchema.index({ phone: 1, isActive: 1 });
CustomerSchema.index({ name: 1, phone: 1 });

// Text search index
CustomerSchema.index({
  name: 'text',
  address: 'text',
  city: 'text',
  phone: 'text'
}, {
  weights: {
    name: 10,
    phone: 8,
    city: 5,
    address: 3
  },
  name: 'customer_search_index'
});

// ==================== HOOKS ====================

CustomerSchema.pre('save', function(next) {
  // Trim all string fields
  const fieldsToTrim = [
    'name', 'phone', 'alternatePhone', 'email', 'address',
    'street', 'village', 'block', 'panchayat', 'district', 'landmark',
    'city', 'state', 'pincode',
  ];
  fieldsToTrim.forEach(field => {
    if (this[field]) {
      this[field] = this[field].trim();
    }
  });

  // Convert phone to string if number
  if (this.phone) {
    this.phone = String(this.phone);
  }

  // next();
});

/*
 * `updatedAt` on an update is Mongoose's job — `timestamps: true` on the schema
 * already stamps every findOneAndUpdate.
 *
 * The hand-rolled hook that used to sit here called `next()`, which current
 * Mongoose does not pass to query middleware, so every findOneAndUpdate on a
 * customer threw "next is not a function". Removing it fixed marking a customer
 * verified, which is now the step that gates filing an application.
 */

// ==================== EXPORT ====================

const Customer = mongoose.model('Customer', CustomerSchema);
export default Customer;
