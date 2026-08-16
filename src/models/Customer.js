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
    max: [100, 'System size cannot exceed 100 kW']
  },

  roofType: {
    type: String,
    required: [true, 'Roof type is required'],
    enum: {
      values: ['rcc_rooftop', 'tin_shed', 'ground_mount'],
      message: 'Roof type must be either rcc_rooftop, tin_shed, or ground_mount'
    }
  },

  roofArea: {
    type: Number,
    min: [0, 'Roof area cannot be negative'],
    max: [10000, 'Roof area cannot exceed 10000 sq ft'],
    description: 'Available roof area in square feet'
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
        'panelSerialNumber'
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
    return `${this.address}, ${this.city}, ${this.state} - ${this.pincode}`;
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
  const fieldsToTrim = ['name', 'phone', 'alternatePhone', 'email', 'address', 'city', 'state', 'pincode'];
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

// Update timestamp on status change
CustomerSchema.pre('findOneAndUpdate', function(next) {
  const update = this.getUpdate();
  if (update.status) {
    update.updatedAt = new Date();
  }
  next();
});

// ==================== EXPORT ====================

const Customer = mongoose.model('Customer', CustomerSchema);
export default Customer;
