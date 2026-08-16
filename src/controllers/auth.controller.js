// src/controllers/auth.controller.js
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { User } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import config from '../config/env.js';
import logger from '../utils/logger.js';
import { redisSet, redisDel } from '../config/redis.js';

/**
 * Generate JWT tokens
 */
const generateTokens = (user) => {
  const payload = {
    id: user._id,
    email: user.email,
    role: user.role,
    permissions: user.permissions || [],
  };

  const accessToken = jwt.sign(payload, config.JWT_SECRET, {
    expiresIn: config.JWT_EXPIRES_IN,
    algorithm: config.JWT_ALGORITHM,
  });

  const refreshToken = jwt.sign(
    { id: user._id },
    config.JWT_SECRET,
    {
      expiresIn: config.JWT_REFRESH_EXPIRES_IN,
      algorithm: config.JWT_ALGORITHM,
    }
  );

  return { accessToken, refreshToken };
};

/**
 * Store refresh token in Redis
 */
const storeRefreshToken = async (userId, refreshToken) => {
  const key = `refresh_token:${userId}`;
  await redisSet(key, refreshToken, 30 * 24 * 60 * 60); // 30 days
};

/**
 * Login user
 */
export const login = async (req, res) => {
  const { email, password } = req.body;

  // Find user
  const user = await User.findOne({ email });
  if (!user) {
    throw ApiError.unauthorized('Invalid email or password');
  }

  // Check if user is active
  if (!user.isActive || user.status !== 'active') {
    throw ApiError.forbidden('Account is inactive. Please contact admin.');
  }

  // Verify password
  const isPasswordValid = await user.comparePassword(password);
  if (!isPasswordValid) {
    throw ApiError.unauthorized('Invalid email or password');
  }

  // Update last login
  await user.updateLastLogin();

  // Generate tokens
  const { accessToken, refreshToken } = generateTokens(user);

  // Store refresh token
  await storeRefreshToken(user._id, refreshToken);

  // Log login
  logger.info(`User logged in: ${user.email} (${user.role})`);

  // Return response
  return ApiResponse.send(res, {
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      permissions: user.permissions || [],
      phone: user.phone,
      department: user.department,
    },
    accessToken,
    refreshToken,
  }, 'Login successful');
};

/**
 * Register new user (admin only)
 */
export const register = async (req, res) => {
  const { name, email, password, phone, role, department } = req.body;

  // Check if user already exists
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    throw ApiError.conflict('User with this email already exists');
  }

  // Create user
  const user = await User.createUser({
    name,
    email,
    password,
    phone,
    role: role || 'viewer',
    department: department || 'administration',
    // createdBy: req.user?._id,
  });

  // Log registration
  logger.info(`New user registered: ${user.email} (${user.role})`);

  return ApiResponse.sendCreated(res, {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    phone: user.phone,
    department: user.department,
  }, 'User registered successfully');
};

/**
 * Get current user profile
 */
export const getProfile = async (req, res) => {
  const user = await User.findById(req.userId)
    .select('-passwordHash -resetPasswordToken -resetPasswordExpires');

  if (!user) {
    throw ApiError.notFound('User');
  }

  return ApiResponse.send(res, {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    permissions: user.permissions || [],
    phone: user.phone,
    department: user.department,
    status: user.status,
    lastLogin: user.lastLogin,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  });
};

/**
 * Update user profile
 */
export const updateProfile = async (req, res) => {
  const { name, phone, department } = req.body;

  const user = await User.findById(req.userId);
  if (!user) {
    throw ApiError.notFound('User');
  }

  // Update fields
  if (name) user.name = name;
  if (phone) user.phone = phone;
  if (department) user.department = department;
  user.updatedBy = req.userId;

  await user.save();

  return ApiResponse.send(res, {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    phone: user.phone,
    department: user.department,
  }, 'Profile updated successfully');
};

/**
 * Change password
 */
export const changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  const user = await User.findById(req.userId);
  if (!user) {
    throw ApiError.notFound('User');
  }

  // Verify current password
  const isPasswordValid = await user.comparePassword(currentPassword);
  if (!isPasswordValid) {
    throw ApiError.unauthorized('Current password is incorrect');
  }

  // Hash new password
  const salt = await bcrypt.genSalt(parseInt(config.BCRYPT_SALT_ROUNDS));
  const passwordHash = await bcrypt.hash(newPassword, salt);

  // Update password
  user.passwordHash = passwordHash;
  user.updatedBy = req.userId;
  await user.save();

  // Invalidate all sessions (optional - remove refresh tokens)
  await redisDel(`refresh_token:${user._id}`);

  logger.info(`Password changed for user: ${user.email}`);

  return ApiResponse.send(res, null, 'Password changed successfully');
};

/**
 * Forgot password - Send reset link
 */
export const forgotPassword = async (req, res) => {
  const { email } = req.body;

  const user = await User.findOne({ email });
  if (!user) {
    // Don't reveal if user exists or not
    return ApiResponse.send(res, null, 'If an account exists, a reset link will be sent');
  }

  // Generate reset token
  const resetToken = user.generatePasswordResetToken();
  await user.save();

  // TODO: Send email with reset link
  // await emailService.sendPasswordResetEmail(user.email, resetToken);

  logger.info(`Password reset requested for: ${email}`);

  return ApiResponse.send(res, null, 'If an account exists, a reset link will be sent');
};

/**
 * Reset password with token
 */
export const resetPassword = async (req, res) => {
  const { token, newPassword } = req.body;

  // Find user with valid token
  const user = await User.findOne({
    resetPasswordToken: token,
    resetPasswordExpires: { $gt: Date.now() },
  });

  if (!user) {
    throw ApiError.badRequest('Invalid or expired reset token');
  }

  // Hash new password
  const salt = await bcrypt.genSalt(parseInt(config.BCRYPT_SALT_ROUNDS));
  const passwordHash = await bcrypt.hash(newPassword, salt);

  // Update password and clear reset token
  user.passwordHash = passwordHash;
  user.resetPasswordToken = undefined;
  user.resetPasswordExpires = undefined;
  user.updatedBy = user._id;
  await user.save();

  // Invalidate all sessions
  await redisDel(`refresh_token:${user._id}`);

  logger.info(`Password reset completed for: ${user.email}`);

  return ApiResponse.send(res, null, 'Password reset successful');
};

/**
 * Logout user
 */
export const logout = async (req, res) => {
  // Remove refresh token
  if (req.userId) {
    await redisDel(`refresh_token:${req.userId}`);
  }

  logger.info(`User logged out: ${req.user?.email || 'unknown'}`);

  return ApiResponse.send(res, null, 'Logged out successfully');
};