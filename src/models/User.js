// src/models/User.js
import crypto from 'crypto';
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
    // `agent` is a field agent: signs in, sees only the applications they
    // collected, and files a new consumer application from the consumer's house.
    enum: ['admin', 'manager', 'agent', 'warehouse_staff', 'installation_team', 'viewer'],
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
      'view_audit_logs',
      // Quotation module. Access is role-gated (admin/manager) for now so that
      // existing users are not locked out before these are granted; they are
      // declared here so hasPermission('...') can be enabled later without a
      // schema change.
      'create_quotation',
      'edit_quotation',
      'delete_quotation',
      'view_quotation',
      'generate_quotation_pdf',
      'manage_quotations',
      // Agent / consumer application module. An `agent` owns their own
      // applications (create + edit until submitted); review, processing and
      // document upload stay with admin/manager.
      'create_application',
      'edit_application',
      'view_application',
      'view_own_applications',
      'submit_application',
      'review_application',
      'process_application',
      'upload_signed_document'
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

  /**
   * Staff number the office gives an agent. Referenced in the welcome email and
   * on the admin's agent list, so it is part of the model rather than a note.
   *
   * Sparse + unique: agents have one, admin/manager accounts that never needed
   * one are simply absent from the index.
   */
  employeeId: {
    type: String,
    trim: true,
    uppercase: true,
    sparse: true,
    unique: true
  },

  lastLogin: {
    type: Date
  },

  /**
   * Set when an admin creates the account with a generated password, or resets
   * one. The API reports it on login and on the profile so the client can push
   * the user straight to the change-password screen; it is cleared as soon as
   * they set a password of their own.
   */
  mustChangePassword: {
    type: Boolean,
    default: false
  },

  /** When the account's password was last set by its owner. */
  passwordChangedAt: {
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
   * Hash and store a new password.
   *
   * `require` is not available in an ES module, so crypto is imported at the top
   * of this file rather than inside the method.
   */
  setPassword: async function(newPassword) {
    const salt = await bcrypt.genSalt(10);
    this.passwordHash = await bcrypt.hash(newPassword, salt);
    // The password is now the owner's own choice, so any "change it" prompt is
    // satisfied and the reset token must not linger.
    this.mustChangePassword = false;
    this.passwordChangedAt = new Date();
    this.resetPasswordToken = undefined;
    this.resetPasswordExpires = undefined;
    return this;
  },

  /**
   * Generate password reset token
   */
  generatePasswordResetToken: function() {
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
