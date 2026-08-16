// src/models/Purchase.js
import mongoose from 'mongoose';

const { Schema } = mongoose;

const PurchaseSchema = new Schema({
  // Primary Identifier
  purchaseId: {
    type: String,
    required: true,
    trim: true
  },

  // Supplier Reference
  supplier: {
    type: Schema.Types.ObjectId,
    ref: 'Supplier',
    required: [true, 'Supplier is required']
  },

  supplierNameSnapshot: {
    type: String,
    required: true,
    description: 'Denormalized supplier name for history'
  },

  // Purchase Details
  purchaseDate: {
    type: Date,
    required: [true, 'Purchase date is required'],
    default: Date.now
  },

  invoiceNumber: {
    type: String,
    trim: true
  },

  purchaseOrderNumber: {
    type: String,
    trim: true
  },

  // Financials
  totalAmount: {
    type: Number,
    required: true,
    min: [0, 'Total amount cannot be negative']
  },

  discount: {
    type: Number,
    default: 0,
    min: [0, 'Discount cannot be negative']
  },

  tax: {
    type: Number,
    default: 0,
    min: [0, 'Tax cannot be negative']
  },

  grandTotal: {
    type: Number,
    required: true,
    min: [0, 'Grand total cannot be negative']
  },

  // Payment
  paymentStatus: {
    type: String,
    enum: ['pending', 'partial', 'completed'],
    default: 'pending'
  },

  paymentMethod: {
    type: String,
    enum: ['cash', 'bank_transfer', 'cheque', 'upi', 'online'],
    default: 'bank_transfer'
  },

  // Delivery
  deliveryMethod: {
    type: String,
    enum: ['pickup', 'courier', 'delivery', 'self_delivery'],
    required: [true, 'Delivery method is required']
  },

  courierDetails: {
    courierName: {
      type: String,
      trim: true
    },
    trackingId: {
      type: String,
      trim: true
    },
    expectedDate: {
      type: Date
    },
    deliveredDate: {
      type: Date
    }
  },

  // Items
  items: [{
    material: {
      type: Schema.Types.ObjectId,
      ref: 'Material',
      required: true
    },
    materialCodeSnapshot: {
      type: String,
      required: true
    },
    materialNameSnapshot: {
      type: String,
      required: true
    },
    unitSnapshot: {
      type: String,
      required: true
    },
    qty: {
      type: Number,
      required: true,
      min: [0.001, 'Quantity must be greater than 0']
    },
    unitCost: {
      type: Number,
      required: true,
      min: [0, 'Unit cost cannot be negative']
    },
    totalCost: {
      type: Number,
      required: true,
      min: [0, 'Total cost cannot be negative']
    },
    discount: {
      type: Number,
      default: 0
    }
  }],

  // Invoice File
  invoiceFileUrl: {
    type: String,
    trim: true
  },

  // Additional Information
  notes: {
    type: String,
    trim: true,
    maxlength: [500, 'Notes cannot exceed 500 characters']
  },

  // Idempotency
  idempotencyKey: {
    type: String,
    // sparse: true
  },

  // Status
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'cancelled'],
    default: 'pending'
  },

  // Metadata
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },

  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  updatedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  }

}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// ==================== VIRTUAL FIELDS ====================

PurchaseSchema.virtual('totalItems').get(function() {
  return this.items.reduce((sum, item) => sum + item.qty, 0);
});

PurchaseSchema.virtual('isFullyPaid').get(function() {
  return this.paymentStatus === 'completed';
});

// ==================== METHODS ====================

PurchaseSchema.methods = {
  /**
   * Check if purchase is completed
   */
  isCompleted: function() {
    return this.status === 'completed';
  },

  /**
   * Check if purchase is cancelled
   */
  isCancelled: function() {
    return this.status === 'cancelled';
  },

  /**
   * Calculate total quantity of items
   */
  calculateTotalItems: function() {
    return this.items.reduce((sum, item) => sum + item.qty, 0);
  },

  /**
   * Get item count
   */
  getItemCount: function() {
    return this.items.length;
  }
};

// ==================== STATIC METHODS ====================

PurchaseSchema.statics = {
  /**
   * Generate purchase ID
   */
  async generatePurchaseId() {
    const Counter = mongoose.model('Counter');
    const counter = await Counter.findByIdAndUpdate(
      'purchaseId',
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );
    const year = new Date().getFullYear();
    return `PUR-${year}-${String(counter.seq).padStart(4, '0')}`;
  },

  /**
   * Get purchases by date range
   */
  getByDateRange(startDate, endDate) {
    return this.find({
      purchaseDate: {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      },
      isActive: true
    }).populate('supplier', 'name phone');
  },

  /**
   * Get purchase summary
   */
  async getSummary(startDate, endDate) {
    return this.aggregate([
      {
        $match: {
          purchaseDate: {
            $gte: new Date(startDate),
            $lte: new Date(endDate)
          },
          status: 'completed'
        }
      },
      {
        $group: {
          _id: null,
          totalPurchases: { $sum: 1 },
          totalAmount: { $sum: '$grandTotal' },
          totalItems: { $sum: { $sum: '$items.qty' } }
        }
      }
    ]);
  },

  /**
   * Get supplier purchase history
   */
  getSupplierHistory(supplierId) {
    return this.find({
      supplier: supplierId,
      isActive: true
    })
    .sort({ purchaseDate: -1 })
    .populate('items.material', 'name materialCode');
  }
};

// ==================== HOOKS ====================

PurchaseSchema.pre('save', function(next) {
  // Calculate grand total
  if (this.items && this.items.length > 0) {
    const subtotal = this.items.reduce((sum, item) => sum + item.totalCost, 0);
    this.totalAmount = subtotal;
    this.grandTotal = subtotal - this.discount + this.tax;
  }
  next();
});

// ==================== INDEXES ====================

PurchaseSchema.index({ purchaseId: 1 }, { unique: true });
PurchaseSchema.index({ supplier: 1, purchaseDate: -1 });
PurchaseSchema.index({ purchaseDate: -1 });
PurchaseSchema.index({ status: 1, isActive: 1 });
PurchaseSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });
PurchaseSchema.index({ 'items.material': 1 });

// ==================== EXPORT ====================

const Purchase = mongoose.model('Purchase', PurchaseSchema);
export default Purchase;
