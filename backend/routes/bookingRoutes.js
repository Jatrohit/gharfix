'use strict';
const router = require('express').Router();
const v = require('../utils/validators');
const bookings = require('../controllers/bookingController');
const { authenticateToken, authorizeRole, loadProfessional } = require('../middleware/authMiddleware');

const customerOnly = authorizeRole('customer');
const proOnly = [authorizeRole('professional'), loadProfessional];

router.use(authenticateToken);

// Customer
router.post('/', customerOnly, v.createBooking, bookings.create);
router.get('/my-bookings', customerOnly, v.paginationQuery, bookings.myBookings);

// Professional (static paths must come before "/:id")
router.get('/professional', proOnly, v.paginationQuery, bookings.professionalBookings);

router.get('/:id', v.idParam(), v.validate, bookings.getOne);
router.put('/:id/cancel', customerOnly, v.idParam(), v.validate, bookings.cancel);

router.put('/:id/accept', proOnly, v.idParam(), v.validate, bookings.accept);
router.put('/:id/reject', proOnly, v.idParam(), v.validate, bookings.reject);
router.put('/:id/start', proOnly, v.idParam(), v.validate, bookings.start);
router.put('/:id/complete', proOnly, v.completeBooking, bookings.complete);
router.put('/:id/price', proOnly, v.setPrice, bookings.setPrice);

module.exports = router;
