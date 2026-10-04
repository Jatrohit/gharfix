'use strict';
const router = require('express').Router();
const v = require('../utils/validators');
const reviews = require('../controllers/reviewController');
const { authenticateToken, authorizeRole } = require('../middleware/authMiddleware');

// Reading reviews is public: GET /api/professionals/:id/reviews (see professionalRoutes)
router.post('/', authenticateToken, authorizeRole('customer'), v.createReview, reviews.create);

module.exports = router;
