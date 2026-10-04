'use strict';
const router = require('express').Router();
const v = require('../utils/validators');
const services = require('../controllers/serviceController');
const { authenticateToken, authorizeRole } = require('../middleware/authMiddleware');

const adminOnly = [authenticateToken, authorizeRole('admin')];

router.get('/', services.list);
router.get('/:idOrSlug', services.getOne); // numeric id OR slug

router.post('/', adminOnly, v.createService, services.create);
router.put('/:id', adminOnly, v.updateService, services.update);
router.delete('/:id', adminOnly, v.idParam(), v.validate, services.remove);

module.exports = router;
