'use strict';
const router = require('express').Router();
const v = require('../utils/validators');
const users = require('../controllers/userController');
const { authenticateToken } = require('../middleware/authMiddleware');
const { uploadProfileImage } = require('../middleware/uploadMiddleware');

router.use(authenticateToken);

router.get('/me', users.getMe);
router.put('/me', uploadProfileImage, v.updateMe, users.updateMe);
router.put('/me/address', v.updateAddress, users.updateAddress);

module.exports = router;
