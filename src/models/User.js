// src/models/User.js
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const { Schema } = mongoose;

const UserSchema = new Schema({
  // Basic Information
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true
  },

  email: {
    type: String,
    required: [true, 'Email is required'],
    trim: true,
    lowercase: true,
    match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email address']
  },

  passwordHash: {
    type: String,
    required: [true, 'Password is required']
  },

  // Role & Permissions
  role: {
    type: String,
    enum: ['admin', 'manager', 'warehouse_staff', 'installation_team', 'viewer'],
    default: 'viewer'
  },

  permissions: [{
    type: String,
    enum: [
      'create_material',
      'edit_material',
      'delete_material',
      'view_material',
      'create_purchase',
      'edit_purchase',
      'delete_purchase',
      'view_purchase',
      'create_customer',
      'edit_customer',
      'delete_customer',
      'view_customer',
      'create_installation',
      'edit_installation',
      'delete_installation',
      'view_installation',
      'assign_material',
      'reverse_material',
      'view_reports',
      'generate_pdf',
      'manage_users',
      'view_audit_logs'
    ]
  }],

  // Status
  status: {
    type: String,
    enum: ['active', 'inactive', 'suspended', 'blocked'],
    default: 'active'
  },

  isActive: {
    type: Boolean,
    default: true
  },

  // Additional Information
  phone: {
    type: String,
    trim: true,
    match: [/^[0-9]{10}$/, 'Please enter a valid 10-digit phone number']
  },

  department: {
    type: String,
    enum: ['administration', 'warehouse', 'installation', 'sales', 'management'],
    default: 'administration'
  },

  lastLogin: {
    type: Date
  },

  resetPasswordToken: {
    type: String
  },

  resetPasswordExpires: {
    type: Date
  },

  // Metadata
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

UserSchema.methods = {
  /**
   * Compare password
   */
  comparePassword: async function(candidatePassword) {
    return bcrypt.compare(candidatePassword, this.passwordHash);
  },

  /**
   * Generate password reset token
   */
  generatePasswordResetToken: function() {
    const crypto = require('crypto');
    const token = crypto.randomBytes(32).toString('hex');
    this.resetPasswordToken = token;
    this.resetPasswordExpires = Date.now() + 3600000; // 1 hour
    return token;
  },

  /**
   * Check if user has permission
   */
  hasPermission: function(permission) {
    if (this.role === 'admin') return true;
    return this.permissions.includes(permission);
  },

  /**
   * Check if user is active
   */
  isCurrentlyActive: function() {
    return this.status === 'active' && this.isActive;
  },

  /**
   * Update last login
   */
  updateLastLogin: function() {
    this.lastLogin = new Date();
    return this.save();
  }
};

// ==================== STATIC METHODS ====================

UserSchema.statics = {
  /**
   * Create user with hashed password
   */
  async createUser(userData) {
    const { password, ...rest } = userData;
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
    
    return this.create({
      ...rest,
      passwordHash
    });
  },

  /**
   * Find by email with status check
   */
  findByEmail(email) {
    return this.findOne({ email, isActive: true });
  }
};

// ==================== HOOKS ====================

UserSchema.pre('save', function(next) {
  if (this.isModified('passwordHash')) {
    // Password is already hashed when creating user
    // This is just to ensure we don't re-hash if we save again
    // next();
  }
  // next();
});

// ==================== INDEXES ====================

UserSchema.index({ email: 1 }, { unique: true });
UserSchema.index({ status: 1, isActive: 1 });
UserSchema.index({ role: 1 });

// ==================== EXPORT ====================

const User = mongoose.model('User', UserSchema);
export default User;
