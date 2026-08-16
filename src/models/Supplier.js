// src/models/Supplier.js
import mongoose from 'mongoose';

const { Schema } = mongoose;

const SupplierSchema = new Schema({
  // Primary Identifier
  supplierId: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },

  // Basic Information
  name: {
    type: String,
    required: [true, 'Supplier name is required'],
    trim: true,
    minlength: [2, 'Name must be at least 2 characters'],
    maxlength: [100, 'Name cannot exceed 100 characters']
  },

  // Contact Information
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

  website: {
    type: String,
    trim: true
  },

  // Address Information
  address: {
    type: String,
    required: [true, 'Address is required'],
    trim: true
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

  // Business Details
  gstNumber: {
    type: String,
    trim: true,
    uppercase: true,
    match: [
      /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/,
      'Please enter a valid GST number'
    ]
  },

  panNumber: {
    type: String,
    trim: true,
    uppercase: true,
    match: [
      /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/,
      'Please enter a valid PAN number'
    ]
  },

  businessType: {
    type: String,
    enum: ['manufacturer', 'distributor', 'wholesaler', 'retailer', 'importer'],
    default: 'wholesaler'
  },

  // Supplier Categories
  categories: [{
    type: String,
    enum: ['SPV Module', 'RCC Structure', 'Tin Shed Structure', 'AC Part', 'DC Cable', 
           'AC Cable', 'Earthing', 'Junction Box', 'Mounting Structure', 'Fasteners', 'Other']
  }],

  // Bank Details
  bankDetails: {
    accountHolderName: String,
    bankName: String,
    accountNumber: String,
    ifscCode: String,
    upiId: String
  },

  // Payment Terms
  paymentTerms: {
    type: String,
    enum: ['advance', 'credit_7_days', 'credit_15_days', 'credit_30_days', 'credit_45_days'],
    default: 'credit_15_days'
  },

  creditLimit: {
    type: Number,
    min: 0,
    default: 0
  },

  // Performance Metrics
  averageDeliveryDays: {
    type: Number,
    default: 0
  },

  qualityRating: {
    type: Number,
    min: 0,
    max: 5,
    default: 0
  },

  // Status
  status: {
    type: String,
    enum: ['active', 'inactive', 'suspended', 'blacklisted'],
    default: 'active'
  },

  // Additional Information
  notes: {
    type: String,
    trim: true,
    maxlength: [1000, 'Notes cannot exceed 1000 characters']
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

  updatedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  }

}, {
  timestamps: true
});

// ==================== METHODS ====================

SupplierSchema.methods = {
  /**
   * Check if supplier is active
   */
  isCurrentlyActive: function() {
    return this.status === 'active' && this.isActive;
  },

  /**
   * Get full address
   */
  getFullAddress: function() {
    return `${this.address}, ${this.city}, ${this.state} - ${this.pincode}`;
  },

  /**
   * Check if supplier supplies a category
   */
  suppliesCategory: function(category) {
    return this.categories.includes(category);
  }
};

// ==================== STATIC METHODS ====================

SupplierSchema.statics = {
  /**
   * Generate supplier ID
   */
  async generateSupplierId() {
    const Counter = mongoose.model('Counter');
    const counter = await Counter.findByIdAndUpdate(
      'supplierId',
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );
    return `SUP-${String(counter.seq).padStart(4, '0')}`;
  },

  /**
   * Get active suppliers by category
   */
  getByCategory(category) {
    return this.find({ categories: category, status: 'active', isActive: true });
  }
};

// ==================== INDEXES ====================

SupplierSchema.index({ name: 1, isActive: 1 });
SupplierSchema.index({ phone: 1 }, { unique: true });
SupplierSchema.index({ categories: 1 });
SupplierSchema.index({ status: 1, isActive: 1 });

// ==================== EXPORT ====================

const Supplier = mongoose.model('Supplier', SupplierSchema);
export default Supplier;
