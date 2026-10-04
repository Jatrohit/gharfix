'use strict';

const success = (res, data = null, message = 'Success', status = 200, extra = {}) =>
  res.status(status).json({ success: true, message, data, ...extra });

const created = (res, data, message = 'Created successfully') => success(res, data, message, 201);

const paginated = (res, data, pagination, message = 'Success') =>
  success(res, data, message, 200, { pagination });

module.exports = { success, created, paginated };
