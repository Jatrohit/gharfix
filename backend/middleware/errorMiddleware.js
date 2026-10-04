'use strict';
const config = require('../config/env');
const AppError = require('../utils/AppError');
const { removeFile } = require('../utils/helpers');

const notFound = (req, res, next) =>
  next(new AppError(`Route not found: ${req.method} ${req.originalUrl}`, 404, 'ROUTE_NOT_FOUND'));

const DB_DOWN_CODES = new Set([
  'ECONNREFUSED', 'PROTOCOL_CONNECTION_LOST', 'ETIMEDOUT', 'ENOTFOUND', 'ER_CON_COUNT_ERROR',
  'ER_ACCESS_DENIED_ERROR', 'ER_BAD_DB_ERROR', 'POOL_CLOSED',
]);

const duplicateMessage = (err) => {
  const m = err.sqlMessage || '';
  if (m.includes('uq_users_email')) return 'An account with this email already exists';
  if (m.includes('uq_users_phone')) return 'An account with this phone number already exists';
  if (m.includes('uq_services_name') || m.includes('uq_services_slug')) return 'A service with this name already exists';
  if (m.includes('uq_reviews_booking')) return 'You have already reviewed this booking';
  if (m.includes('uq_professionals_user')) return 'A professional profile already exists for this account';
  return 'This record already exists';
};

/** Translate known library/database errors into clean API errors. */
function normalize(err) {
  if (err instanceof AppError) return err;
  if (err.type === 'entity.parse.failed') return new AppError('Request body is not valid JSON', 400);
  if (err.type === 'entity.too.large') return new AppError('Request body is too large', 413);
  if (err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return new AppError(`Image is too large. Maximum size is ${config.upload.maxMb} MB`, 413);
    }
    return new AppError('File upload failed. Send one image in the "profile_image" field', 400);
  }
  if (err.code === 'ER_DUP_ENTRY') return new AppError(duplicateMessage(err), 409, 'DUPLICATE');
  if (err.code === 'ER_NO_REFERENCED_ROW_2') return new AppError('A related record does not exist', 400);
  if (err.code === 'ER_ROW_IS_REFERENCED_2') return new AppError('This record is in use and cannot be removed', 409);
  if (DB_DOWN_CODES.has(err.code) || /Pool is closed/i.test(err.message || '')) {
    return new AppError('Service temporarily unavailable. Please try again shortly.', 503, 'DB_UNAVAILABLE');
  }
  return null;
}

// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  if (req.file) removeFile(req.file.path);
  const known = normalize(err);

  if (!known) {
    // Unexpected error: log details server-side, never leak them to the client
    console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`, config.isProd ? err.message : err);
  } else if (known.statusCode >= 500) {
    console.error(`[${new Date().toISOString()}] ${known.message} (${err.code || 'n/a'})`);
  }

  const status = known ? known.statusCode : 500;
  const body = { success: false, message: known ? known.message : 'Something went wrong' };
  if (known && known.code) body.code = known.code;
  res.status(status).json(body);
};

module.exports = { notFound, errorHandler };
