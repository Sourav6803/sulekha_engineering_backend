// src/models/Material.js
import mongoose from 'mongoose';

const { Schema } = mongoose;

const MaterialSchema = new Schema({
  // Primary Identifier
  materialCode: {
    type: String,
    required: true,
    trim: true
  },

  // Basic Information
  name: {
    type: String,
    required: [true, 'Material name is required'],
    trim: true,
    minlength: [2, 'Name must be at least 2 characters'],
    maxlength: [100, 'Name cannot exceed 100 characters']
  },

  description: {
    type: String,
    trim: true,
    maxlength: [200, 'Description cannot exceed 200 characters']
  },

  // Measurement
  unit: {
    type: String,
    required: [true, 'Unit is required'],
    enum: ['nos', 'mtr', 'kg', 'packet', 'pair', 'bag', 'roll', 'box', 'mm'],
    default: 'nos'
  },

  unitCost: {
    type: Number,
    min: [0, 'Cost cannot be negative'],
    default: 0
  },

  // Stock Management
  currentStock: {
    type: Number,
    default: 0,
    min: [0, 'Stock cannot be negative'],
    index: true
  },

  reservedStock: {
    type: Number,
    default: 0,
    min: [0, 'Reserved stock cannot be negative'],
    description: 'Stock reserved for assigned but not yet installed items'
  },

  minimumStockLevel: {
    type: Number,
    default: 0,
    min: [0, 'Minimum stock level cannot be negative'],
    description: 'Re-order level'
  },

  maximumStockLevel: {
    type: Number,
    default: 0,
    min: [0, 'Maximum stock level cannot be negative'],
    description: 'Storage capacity limit'
  },

  // Supplier Information
  preferredSupplier: {
    type: Schema.Types.ObjectId,
    ref: 'Supplier'
  },

  alternateSuppliers: [{
    type: Schema.Types.ObjectId,
    ref: 'Supplier'
  }],

  // Images
  images: [{
    url: String,
    caption: String,
    isPrimary: {
      type: Boolean,
      default: false
    }
  }],

  // Status
  status: {
    type: String,
    enum: ['active', 'inactive', 'discontinued'],
    default: 'active'
  },

  // Metadata
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },

  isConsumable: {
    type: Boolean,
    default: false,
    description: 'True if item gets consumed during installation'
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
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// ==================== VIRTUAL FIELDS ====================

// Available stock = currentStock - reservedStock
MaterialSchema.virtual('availableStock').get(function() {
  return this.currentStock - this.reservedStock;
});

// Check if stock is below minimum
MaterialSchema.virtual('isLowStock').get(function() {
  return this.currentStock <= this.minimumStockLevel;
});

// Check if stock is above maximum
MaterialSchema.virtual('isOverStocked').get(function() {
  return this.maximumStockLevel > 0 && this.currentStock >= this.maximumStockLevel;
});

// ==================== METHODS ====================

MaterialSchema.methods = {
  /**
   * Check if material is active
   */
  isCurrentlyActive: function() {
    return this.status === 'active' && this.isActive;
  },

  /**
   * Check if stock is available
   */
  hasAvailableStock: function(qty) {
    return this.availableStock >= qty;
  },

  /**
   * Reserve stock
   */
  reserveStock: function(qty) {
    if (!this.hasAvailableStock(qty)) {
      throw new Error(`Insufficient stock. Available: ${this.availableStock}, Requested: ${qty}`);
    }
    this.reservedStock += qty;
    return this.save();
  },

  /**
   * Release reserved stock
   */
  releaseReservedStock: function(qty) {
    if (this.reservedStock < qty) {
      throw new Error(`Cannot release ${qty}. Reserved: ${this.reservedStock}`);
    }
    this.reservedStock -= qty;
    return this.save();
  },

  /**
   * Update stock
   */
  updateStock: function(qty, operation = 'add') {
    if (operation === 'add') {
      this.currentStock += qty;
    } else if (operation === 'subtract') {
      if (this.currentStock < qty) {
        throw new Error(`Insufficient stock. Available: ${this.currentStock}, Requested: ${qty}`);
      }
      this.currentStock -= qty;
    }
    return this.save();
  }
};

// ==================== STATIC METHODS ====================

MaterialSchema.statics = {
  /**
   * Generate material code
   */
  async generateMaterialCode() {
    const Counter = mongoose.model('Counter');
    const counter = await Counter.findByIdAndUpdate(
      'materialCode',
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );
    return `MAT-${String(counter.seq).padStart(4, '0')}`;
  },

  /**
   * Get low stock materials
   */
  getLowStock() {
    return this.find({
      $expr: {
        $lte: ['$currentStock', '$minimumStockLevel']
      },
      status: 'active',
      isActive: true
    });
  },

  /**
   * Search materials
   */
  search(query) {
    const searchRegex = new RegExp(query, 'i');
    return this.find({
      $or: [
        { name: searchRegex },
        { materialCode: searchRegex }
      ],
      isActive: true
    });
  },

  /**
   * Get total stock value
   */
  async getTotalStockValue() {
    const result = await this.aggregate([
      { $match: { isActive: true } },
      {
        $group: {
          _id: null,
          totalValue: {
            $sum: { $multiply: ['$currentStock', '$unitCost'] }
          }
        }
      }
    ]);
    return result[0]?.totalValue || 0;
  },

  /**
   * Get overall stock summary
   */
  async getStockSummary() {
    const result = await this.aggregate([
      { $match: { isActive: true } },
      {
        $group: {
          _id: null,
          totalStock: { $sum: '$currentStock' },
          totalValue: {
            $sum: { $multiply: ['$currentStock', '$unitCost'] }
          },
          lowStockCount: {
            $sum: {
              $cond: [
                { $lte: ['$currentStock', '$minimumStockLevel'] },
                1,
                0
              ]
            }
          }
        }
      }
    ]);
    return result[0] || { totalStock: 0, totalValue: 0, lowStockCount: 0 };
  }
};

// ==================== HOOKS ====================

// Validate stock levels on save
MaterialSchema.pre('save', function(next) {
  // Check if stock exceeds maximum
  if (this.maximumStockLevel > 0 && this.currentStock > this.maximumStockLevel) {
    // Warn but don't prevent save
    console.warn(`Material ${this.materialCode} exceeds maximum stock level`);
  }
  // next();
});

// ==================== INDEXES ====================

MaterialSchema.index({ materialCode: 1 }, { unique: true });
MaterialSchema.index({ name: 1 });
MaterialSchema.index({ currentStock: 1, minimumStockLevel: 1 });
MaterialSchema.index({ status: 1, isActive: 1 });
MaterialSchema.index({ currentStock: -1, minimumStockLevel: 1 });

// Text search index
MaterialSchema.index({
  name: 'text',
  materialCode: 'text'
}, {
  weights: {
    name: 10,
    materialCode: 5
  },
  name: 'material_search_index'
});

// ==================== EXPORT ====================

const Material = mongoose.model('Material', MaterialSchema);
export default Material;
