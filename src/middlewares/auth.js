// src/middlewares/auth.js
import jwt from 'jsonwebtoken';
import config from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import logger from '../utils/logger.js';
import { User } from '../models/index.js';

/**
 * Extract JWT token from Authorization header
 */
const extractToken = (req) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return null;
  }

  // Check if it's a Bearer token
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return null;
  }

  return parts[1];
};

/**
 * Verify JWT token
 */
const verifyToken = (token) => {
  try {
    const decoded = jwt.verify(token, config.JWT_SECRET, {
      algorithms: [config.JWT_ALGORITHM],
    });
    return decoded;
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new ApiError(401, 'Token expired');
    }
    if (error.name === 'JsonWebTokenError') {
      throw new ApiError(401, 'Invalid token');
    }
    throw new ApiError(401, 'Authentication failed');
  }
};

/**
 * Authentication middleware
 * Verifies JWT token and attaches user to request
 */
export const authenticate = async (req, res, next) => {
  try {
    // Extract token
    const token = extractToken(req);
    if (!token) {
      throw new ApiError(401, 'Authentication required. No token provided.');
    }

    // Verify token
    const decoded = verifyToken(token);

    // Check if user exists and is active
    const user = await User.findById(decoded.id)
      .select('-passwordHash -resetPasswordToken -resetPasswordExpires');

    if (!user) {
      throw new ApiError(401, 'User not found');
    }

    if (!user.isActive || user.status !== 'active') {
      throw new ApiError(403, 'User account is inactive. Please contact admin.');
    }

    // Attach user to request
    req.user = user;
    req.userId = user._id;

    // Log authentication success
    logger.debug(`User authenticated: ${user.email} (${user.role})`);

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Optional authentication middleware
 * Authenticates if token is provided, but continues if not
 */
export const optionalAuthenticate = async (req, res, next) => {
  try {
    const token = extractToken(req);
    if (token) {
      const decoded = verifyToken(token);
      const user = await User.findById(decoded.id)
        .select('-passwordHash -resetPasswordToken -resetPasswordExpires');
      
      if (user && user.isActive) {
        req.user = user;
        req.userId = user._id;
      }
    }
    next();
  } catch (error) {
    // Don't fail if authentication fails, just continue without user
    next();
  }
};

/**
 * Role-based authorization middleware
 */
export const authorize = (...roles) => {
  return (req, res, next) => {
    try {
      if (!req.user) {
        throw new ApiError(401, 'Authentication required');
      }

      if (!roles.includes(req.user.role)) {
        throw new ApiError(403, `Access denied. Required roles: ${roles.join(', ')}`);
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Permission-based authorization middleware
 */
export const hasPermission = (permission) => {
  return (req, res, next) => {
    try {
      if (!req.user) {
        throw new ApiError(401, 'Authentication required');
      }

      // Admin has all permissions
      if (req.user.role === 'admin') {
        return next();
      }

      if (!req.user.permissions || !req.user.permissions.includes(permission)) {
        throw new ApiError(403, `Access denied. Required permission: ${permission}`);
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Refresh token middleware
 * Generates a new access token from refresh token
 */
export const refreshToken = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      throw new ApiError(400, 'Refresh token is required');
    }

    // Verify refresh token
    const decoded = verifyToken(refreshToken);

    // Check if user exists
    const user = await User.findById(decoded.id)
      .select('-passwordHash -resetPasswordToken -resetPasswordExpires');

    if (!user || !user.isActive) {
      throw new ApiError(401, 'Invalid refresh token');
    }

    // Generate new access token
    const accessToken = jwt.sign(
      { 
        id: user._id,
        email: user.email,
        role: user.role,
        permissions: user.permissions 
      },
      config.JWT_SECRET,
      { 
        expiresIn: config.JWT_EXPIRES_IN,
        algorithm: config.JWT_ALGORITHM 
      }
    );

    res.status(200).json({
      success: true,
      data: {
        accessToken,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          permissions: user.permissions,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};