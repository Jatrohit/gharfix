'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const config = require('../config/env');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { removeFile } = require('../utils/helpers');

const UPLOAD_ROOT = path.join(__dirname, '..', 'uploads');
const PROFILE_DIR = path.join(UPLOAD_ROOT, 'profiles');
fs.mkdirSync(PROFILE_DIR, { recursive: true });

const EXT_BY_MIME = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

/**
 * Local disk storage keeps the project working with zero external services.
 * To move to Cloudinary/S3 later, swap this storage engine and change the
 * value saved in `profile_image` to the returned URL.
 */
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, PROFILE_DIR),
  // random name + extension from the verified MIME type (never trust the client's filename)
  filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + EXT_BY_MIME[file.mimetype]),
});

const upload = multer({
  storage,
  limits: { fileSize: config.upload.maxMb * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) =>
    EXT_BY_MIME[file.mimetype]
      ? cb(null, true)
      : cb(new AppError('Only JPG, PNG or WEBP images are allowed', 422)),
});

/** Multipart field name: profile_image. JSON requests pass through untouched. */
const uploadProfileImage = upload.single('profile_image');

const hasMagicBytes = (buf, mime) => {
  if (mime === 'image/jpeg') return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (mime === 'image/png') return buf.slice(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  if (mime === 'image/webp') return buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP';
  return false;
};

/** The MIME type is client-supplied, so also check the file's real signature. */
const verifyImageContent = asyncHandler(async (req, res, next) => {
  if (!req.file) return next();
  const fd = await fs.promises.open(req.file.path, 'r');
  try {
    const buf = Buffer.alloc(12);
    await fd.read(buf, 0, 12, 0);
    if (!hasMagicBytes(buf, req.file.mimetype)) {
      removeFile(req.file.path);
      req.file = undefined;
      throw new AppError('The uploaded file is not a valid image', 422);
    }
  } finally {
    await fd.close();
  }
  return next();
});

/** Path stored in the database / served under /uploads */
const publicPath = (file) => (file ? `/uploads/profiles/${file.filename}` : undefined);

module.exports = { uploadProfileImage: [uploadProfileImage, verifyImageContent], publicPath, UPLOAD_ROOT };
