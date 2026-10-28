// src/models/Installation.js
import mongoose from 'mongoose';

const { Schema } = mongoose;

const InstallationSchema = new Schema({
  // Primary Identifier
  installationId: {
    type: String,
    required: true,
    trim: true
  },

  // Customer Reference
  customer: {
    type: Schema.Types.ObjectId,
    ref: 'Customer',
    required: [true, 'Customer is required']
  },

  /**
   * The application this installation comes from.
   *
   * An installation is never typed in from scratch: the quotation number, the
   * system size and the roof type are already on the application, and the office
   * should not be able to disagree with the paperwork by retyping them. The ref
   * also answers "is this application already installed?" without guessing from
   * the customer.
   */
  application: {
    type: Schema.Types.ObjectId,
    ref: 'Application'
  },

  customerNameSnapshot: {
    type: String,
    required: true
  },

  customerPhoneSnapshot: {
    type: String,
    required: true
  },

  // Project Details
  projectNo: {
    type: String,
    trim: true
  },

  quotationNo: {
    type: String,
    trim: true
  },

  // System Specifications
  systemSizeKW: {
    type: Number,
    required: [true, 'System size in kW is required'],
    min: [0.1, 'System size must be at least 0.1 kW']
  },

  roofType: {
    type: String,
    required: [true, 'Roof type is required'],
    // Mirrors SITE_TYPES in src/data/applicationChecklist.js — the application
    // carries the site type across when it is approved.
    enum: ['rcc_rooftop', 'tin_shed', 'high_rise_structure', 'ground_mount']
  },

  // Load Analysis
  totalLoad: {
    type: Number,
    default: 0,
    description: 'Total load in kW'
  },

  inverterCapacity: {
    type: Number,
    default: 0,
    description: 'Recommended inverter capacity in kW'
  },

  loadCapacityUtilized: {
    type: Number,
    default: 0,
    description: 'Percentage of load capacity utilized'
  },

  canRunSubmersible: {
    type: Boolean,
    default: false,
    description: 'Whether system can run 1HP submersible pump'
  },

  loadAnalysisDetails: {
    averageConsumption: Number,
    dailyGenerationKWh: Number,
    recommendedInverterKW: Number,
    submersiblePowerKW: Number,
    startingPowerKW: Number,
    loadSuitability: {
      type: String,
      enum: ['SUFFICIENT', 'INSUFFICIENT', 'MARGINAL']
    },
    recommendations: [String]
  },

  // Financials
  totalCost: {
    type: Number,
    default: 0,
    min: [0, 'Total cost cannot be negative']
  },

  materialsCost: {
    type: Number,
    default: 0
  },

  laborCost: {
    type: Number,
    default: 0
  },

  margin: {
    type: Number,
    default: 0
  },

  // Timeline
  orderDate: {
    type: Date
  },

  installDate: {
    type: Date,
    required: [true, 'Installation date is required']
  },

  completionDate: {
    type: Date
  },

  // ---------------------------------------------------------------------------
  // Evidence — what the crew records while standing on the roof
  // ---------------------------------------------------------------------------

  /**
   * One row per panel, with its own serial and its own photograph.
   *
   * A rooftop system is six or eight panels, and the warranty claim for a failed
   * module is made against one serial, not against "the array". Rows are seeded
   * from the system size on the form and can be added or removed, because the
   * survey count and the delivered pallet do not always agree.
   */
  panelUnits: [
    {
      serial: { type: String, trim: true, maxlength: [60, 'Panel serial is too long'] },
      photoUrl: String,
      photoPublicId: String,
      photoFileName: String,
      addedAt: { type: Date, default: Date.now }
    }
  ],

  /** The two site photographs: the array in place, and the new meter. */
  sitePhotos: {
    panels: {
      url: String,
      publicId: String,
      fileName: String,
      uploadedAt: Date
    },
    meter: {
      url: String,
      publicId: String,
      fileName: String,
      uploadedAt: Date
    }
  },

  /** The inverter that was actually fitted — make, serial, and a photo of it. */
  inverter: {
    brand: { type: String, trim: true, maxlength: [80, 'Inverter brand is too long'] },
    serial: { type: String, trim: true, maxlength: [60, 'Inverter serial is too long'] },
    photoUrl: String,
    photoPublicId: String,
    photoFileName: String
  },

  /** The photo with the customer, for the shop's own use. Never required. */
  marketingPhoto: {
    url: String,
    publicId: String,
    fileName: String,
    uploadedAt: Date
  },

  // Status
  status: {
    type: String,
    enum: ['pending_quotation', 'quoted', 'scheduled', 'in_progress', 'completed', 'cancelled'],
    default: 'pending_quotation',
    index: true
  },

  // Materials Used
  materialsUsed: [{
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
    descriptionSnapshot: {
      type: String,
      trim: true
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
    unitCostSnapshot: {
      type: Number,
      required: true
    },
    totalCostSnapshot: {
      type: Number,
      required: true
    },
    remark: {
      type: String,
      trim: true
    },
    status: {
      type: String,
      enum: ['reserved', 'installed', 'reversed'],
      default: 'installed'
    },
    installedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    installedAt: {
      type: Date,
      default: Date.now
    },
    reversedAt: {
      type: Date
    },
    reversedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    reversalReason: {
      type: String,
      trim: true
    }
  }],

  // Suggested Materials (from BOM template)
  suggestedMaterials: {
    type: Schema.Types.Mixed,
    description: 'Snapshot of suggested BOM at creation time'
  },

  // Team Assignment
  teamAssigned: [{
    member: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    role: {
      type: String,
      enum: ['lead', 'technician', 'helper', 'supervisor']
    },
    assignedAt: {
      type: Date,
      default: Date.now
    }
  }],

  // Additional Information
  notes: {
    type: String,
    trim: true,
    maxlength: [1000, 'Notes cannot exceed 1000 characters']
  },

  // Documents
  documents: [{
    type: {
      type: String,
      enum: ['quotation', 'invoice', 'warranty', 'drawing', 'photo', 'other']
    },
    url: String,
    caption: String,
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

InstallationSchema.virtual('totalMaterialsUsed').get(function() {
  return this.materialsUsed.length;
});

InstallationSchema.virtual('totalMaterialQuantity').get(function() {
  return this.materialsUsed.reduce((sum, item) => sum + item.qty, 0);
});

InstallationSchema.virtual('totalMaterialCost').get(function() {
  return this.materialsUsed.reduce((sum, item) => sum + item.totalCostSnapshot, 0);
});

InstallationSchema.virtual('durationDays').get(function() {
  if (!this.installDate) return 0;
  const end = this.completionDate || new Date();
  const diffTime = Math.abs(end - this.installDate);
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
});

// ==================== METHODS ====================

InstallationSchema.methods = {
  /**
   * Check if installation is completed
   */
  isCompleted: function() {
    return this.status === 'completed';
  },

  /**
   * Check if installation is in progress
   */
  isInProgress: function() {
    return this.status === 'in_progress';
  },

  /**
   * Assign material to installation
   */
  assignMaterial: function(materialData, userId) {
    this.materialsUsed.push({
      ...materialData,
      installedBy: userId,
      installedAt: new Date()
    });
    return this.save();
  },

  /**
   * Reverse material assignment
   */
  reverseMaterial: function(materialUsageId, reason, userId) {
    const materialIndex = this.materialsUsed.findIndex(
      m => m._id.toString() === materialUsageId
    );
    
    if (materialIndex === -1) {
      throw new Error('Material usage record not found');
    }

    const material = this.materialsUsed[materialIndex];
    if (material.status === 'reversed') {
      throw new Error('Material already reversed');
    }

    material.status = 'reversed';
    material.reversedAt = new Date();
    material.reversedBy = userId;
    material.reversalReason = reason;

    return this.save();
  },

  /**
   * Update installation status
   */
  updateStatus: function(status, userId) {
    this.status = status;
    this.updatedBy = userId;
    
    if (status === 'completed') {
      this.completionDate = new Date();
    }
    
    return this.save();
  },

  /**
   * Calculate total cost
   */
  calculateTotalCost: function() {
    const materialCost = this.materialsUsed.reduce(
      (sum, item) => sum + item.totalCostSnapshot,
      0
    );
    this.materialsCost = materialCost;
    this.totalCost = materialCost + (this.laborCost || 0);
    return this.save();
  }
};

// ==================== STATIC METHODS ====================

InstallationSchema.statics = {
  /**
   * Generate installation ID
   */
  async generateInstallationId() {
    const Counter = mongoose.model('Counter');
    const counter = await Counter.findByIdAndUpdate(
      'installationId',
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );
    const year = new Date().getFullYear();
    return `INST-${year}-${String(counter.seq).padStart(4, '0')}`;
  },

  /**
   * Generate the project number, serially.
   *
   * It used to be a free-text box, which meant gaps, duplicates and numbers that
   * only existed in somebody's notebook. The counter is its own sequence, so a
   * project number never moves when an installation is deleted or renumbered.
   */
  async generateProjectNo() {
    const Counter = mongoose.model('Counter');
    const counter = await Counter.findByIdAndUpdate(
      'projectNo',
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );
    const year = new Date().getFullYear();
    return `PRJ-${year}-${String(counter.seq).padStart(4, '0')}`;
  },

  /**
   * Get installations by customer
   */
  getByCustomer(customerId) {
    return this.find({ customer: customerId, isActive: true })
      .sort({ createdAt: -1 })
      .populate('customer', 'name phone customerId');
  },

  /**
   * Get installations by date range
   */
  getByDateRange(startDate, endDate) {
    return this.find({
      installDate: {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      },
      isActive: true
    }).populate('customer', 'name phone');
  },

  /**
   * Get installation summary
   */
  async getSummary(startDate, endDate) {
    return this.aggregate([
      {
        $match: {
          installDate: {
            $gte: new Date(startDate),
            $lte: new Date(endDate)
          },
          isActive: true
        }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalKW: { $sum: '$systemSizeKW' },
          totalCost: { $sum: '$totalCost' }
        }
      }
    ]);
  },

  /**
   * Get material usage report
   */
  async getMaterialUsageReport(startDate, endDate) {
    return this.aggregate([
      {
        $match: {
          installDate: {
            $gte: new Date(startDate),
            $lte: new Date(endDate)
          },
          isActive: true
        }
      },
      { $unwind: '$materialsUsed' },
      {
        $match: {
          'materialsUsed.status': 'installed'
        }
      },
      {
        $group: {
          _id: '$materialsUsed.material',
          materialName: { $first: '$materialsUsed.materialNameSnapshot' },
          totalQty: { $sum: '$materialsUsed.qty' },
          totalCost: { $sum: '$materialsUsed.totalCostSnapshot' },
          installations: { $addToSet: '$installationId' }
        }
      },
      {
        $lookup: {
          from: 'materials',
          localField: '_id',
          foreignField: '_id',
          as: 'materialDetails'
        }
      },
      { $unwind: { path: '$materialDetails', preserveNullAndEmptyArrays: true } }
    ]);
  },

  /**
   * Get system performance stats
   */
  async getSystemPerformance() {
    return this.aggregate([
      { $match: { isActive: true, status: 'completed' } },
      {
        $group: {
          _id: '$roofType',
          count: { $sum: 1 },
          avgSizeKW: { $avg: '$systemSizeKW' },
          totalKW: { $sum: '$systemSizeKW' },
          avgCost: { $avg: '$totalCost' }
        }
      }
    ]);
  }
};

// ==================== HOOKS ====================

InstallationSchema.pre('save', function(next) {
  // Update timestamps based on status changes
  if (this.isModified('status')) {
    if (this.status === 'completed' && !this.completionDate) {
      this.completionDate = new Date();
    }
  }
  // next();
});

// ==================== INDEXES ====================

InstallationSchema.index({ customer: 1, installDate: -1 });
InstallationSchema.index({ installDate: -1 });
InstallationSchema.index({ status: 1, installDate: 1 });
InstallationSchema.index({ 'materialsUsed.material': 1 });
// Compound indexes
InstallationSchema.index({ customer: 1, status: 1 });
InstallationSchema.index({ status: 1, installDate: -1 });

// A customer can only have ONE active installation. Partial unique index so a
// soft-deleted (isActive:false) installation doesn't block creating a new one.
InstallationSchema.index(
  { customer: 1 },
  { unique: true, partialFilterExpression: { isActive: true } }
);

// ==================== EXPORT ====================

const Installation = mongoose.model('Installation', InstallationSchema);
export default Installation;
