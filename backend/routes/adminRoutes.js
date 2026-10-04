'use strict';
const router = require('express').Router();
const v = require('../utils/validators');
const admin = require('../controllers/adminController');
const services = require('../controllers/serviceController');
const { authenticateToken, authorizeRole } = require('../middleware/authMiddleware');

router.use(authenticateToken, authorizeRole('admin'));

router.get('/dashboard', admin.dashboard);

router.get('/users', v.adminListQuery, admin.listUsers);

router.get('/professionals', v.adminListQuery, admin.listProfessionals);
router.put('/professionals/:id/approve', v.idParam(), v.validate, admin.approveProfessional);
router.put('/professionals/:id/reject', v.idParam(), v.validate, admin.rejectProfessional);
router.put('/professionals/:id/suspend', v.idParam(), v.validate, admin.suspendProfessional);
router.put('/professionals/:id/reinstate', v.idParam(), v.validate, admin.reinstateProfessional);

router.get('/bookings', v.adminListQuery, admin.listBookings);
router.put('/bookings/:id', v.adminUpdateBooking, admin.updateBooking);

// Same handlers as /api/services (admin-only there too); this lists inactive services as well
router.get('/services', services.listAll);
router.post('/services', v.createService, services.create);
router.put('/services/:id', v.updateService, services.update);
router.delete('/services/:id', v.idParam(), v.validate, services.remove);

router.get('/reviews', v.paginationQuery, admin.listReviews);
router.delete('/reviews/:id', v.idParam(), v.validate, admin.deleteReview);

module.exports = router;
