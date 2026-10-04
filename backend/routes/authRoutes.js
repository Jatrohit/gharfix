'use strict';
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const config = require('../config/env');
const v = require('../utils/validators');
const auth = require('../controllers/authController');
const { authenticateToken } = require('../middleware/authMiddleware');
const { uploadProfileImage } = require('../middleware/uploadMiddleware');

// Brute-force protection: much stricter than the global limiter
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.rateLimit.authMax,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts. Please try again in 15 minutes.' },
});

router.post('/register', authLimiter, v.registerCustomer, auth.register);
router.post('/login', authLimiter, v.login, auth.login);
// multipart/form-data (with optional "profile_image") or plain JSON are both accepted
router.post('/professional/register', authLimiter, uploadProfileImage, v.registerProfessional, auth.registerProfessional);
router.post('/professional/login', authLimiter, v.login, auth.professionalLogin);
router.get('/me', authenticateToken, auth.me);

module.exports = router;
