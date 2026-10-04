'use strict';
const fs = require('fs');
const config = require('../config/env');

/** "+91 98765-43210" / "098765 43210" / "919876543210" -> "9876543210" */
function normalizePhone(value) {
  if (value === undefined || value === null) return value;
  let digits = String(value).replace(/[\s\-().]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return digits;
}

const isValidPincode = (v) => /^[1-9]\d{5}$/.test(String(v || ''));

/** Pull a 6-digit pincode out of free text such as "Rohini Sector 23, 110085". */
function extractPincode(text) {
  const m = /(?<!\d)([1-9]\d{5})(?!\d)/.exec(String(text || ''));
  return m ? m[1] : null;
}

const slugify = (text) =>
  String(text || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** Escape %, _ and \ so user input cannot act as a LIKE wildcard. */
const escapeLike = (text) => String(text).replace(/[\\%_]/g, (c) => `\\${c}`);

/** '/uploads/profiles/x.jpg' -> 'http://localhost:5000/uploads/profiles/x.jpg' */
const imageUrl = (path) => {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  return `${config.publicBaseUrl}${path}`;
};

/** Clamp page/limit coming from the query string. */
function getPagination(queryParams, { defaultLimit = 10, maxLimit = 50 } = {}) {
  const page = Math.max(parseInt(queryParams.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(queryParams.limit, 10) || defaultLimit, 1), maxLimit);
  return { page, limit, offset: (page - 1) * limit };
}

const buildPagination = ({ page, limit }, total) => ({
  page,
  limit,
  total,
  totalPages: Math.max(Math.ceil(total / limit), 1),
});

/** Build "col = ?, col2 = ?" from whitelisted keys that are present in `data`. */
function buildUpdate(allowedFields, data) {
  const sets = [];
  const values = [];
  for (const field of allowedFields) {
    if (data[field] !== undefined) {
      sets.push(`${field} = ?`);
      values.push(data[field] === '' ? null : data[field]);
    }
  }
  return sets.length ? { sets: sets.join(', '), values } : null;
}

const removeFile = (filePath) => {
  if (filePath) fs.unlink(filePath, () => {});
};

const toNumber = (v) => (v === null || v === undefined ? null : Number(v));

module.exports = {
  normalizePhone,
  isValidPincode,
  extractPincode,
  slugify,
  escapeLike,
  imageUrl,
  getPagination,
  buildPagination,
  buildUpdate,
  removeFile,
  toNumber,
};
