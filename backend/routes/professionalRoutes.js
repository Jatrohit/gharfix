'use strict';
const router = require('express').Router();
const v = require('../utils/validators');
const pros = require('../controllers/professionalController');
const reviews = require('../controllers/reviewController');
const { authenticateToken, authorizeRole, loadProfessional } = require('../middleware/authMiddleware');
const { uploadProfileImage } = require('../middleware/uploadMiddleware');

const proOnly = [authenticateToken, authorizeRole('professional'), loadProfessional];

// Public
router.get('/', v.professionalSearch, pros.list);
router.get('/search', v.professionalSearch, pros.search);
router.get('/service/:serviceId', v.idParam('serviceId'), v.professionalSearch, pros.byService);

// Professional's own profile (must stay above "/:id")
router.get('/me/profile', proOnly, pros.getMyProfile);
router.put('/me/profile', proOnly, uploadProfileImage, v.updateProfessionalProfile, pros.updateMyProfile);

router.get('/:id', v.idParam(), v.validate, pros.getOne);
router.get('/:id/reviews', v.idParam(), v.paginationQuery, reviews.listForProfessional);

module.exports = router;
