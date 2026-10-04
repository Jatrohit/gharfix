'use strict';
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { verifyToken } = require('../utils/generateToken');
const userModel = require('../models/userModel');
const professionalModel = require('../models/professionalModel');

/**
 * Verifies the Bearer token, then loads the user from the database.
 * The role used for authorization always comes from the database, never from the client.
 */
const authenticateToken = asyncHandler(async (req, res, next) => {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) {
    throw new AppError('Authentication required. Please login.', 401, 'NO_TOKEN');
  }

  let payload;
  try {
    payload = verifyToken(token);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw new AppError('Session expired. Please login again.', 401, 'TOKEN_EXPIRED');
    }
    throw new AppError('Invalid token. Please login again.', 401, 'INVALID_TOKEN');
  }

  const user = await userModel.findById(payload.id);
  if (!user) throw new AppError('Account no longer exists. Please register again.', 401, 'USER_NOT_FOUND');
  if (user.role !== payload.role) {
    throw new AppError('Your permissions changed. Please login again.', 401, 'ROLE_CHANGED');
  }
  if (!user.is_active) {
    throw new AppError('Your account has been suspended. Please contact support.', 403, 'ACCOUNT_SUSPENDED');
  }

  req.user = user;
  next();
});

/** Usage: authorizeRole('admin') or authorizeRole('customer', 'admin') */
const authorizeRole =
  (...roles) =>
  (req, res, next) => {
    if (!req.user) return next(new AppError('Authentication required. Please login.', 401, 'NO_TOKEN'));
    if (!roles.includes(req.user.role)) {
      return next(new AppError('You do not have permission to perform this action.', 403, 'FORBIDDEN'));
    }
    return next();
  };

/** For professional-only routes: attaches req.professional (the caller's own profile). */
const loadProfessional = asyncHandler(async (req, res, next) => {
  const professional = await professionalModel.findByUserId(req.user.id);
  if (!professional) throw new AppError('Professional profile not found', 404);
  req.professional = professional;
  next();
});

module.exports = { authenticateToken, authorizeRole, loadProfessional };
