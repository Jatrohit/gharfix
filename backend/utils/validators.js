'use strict';
const { body, param, query, validationResult } = require('express-validator');
const { normalizePhone, removeFile } = require('./helpers');
const { AVAILABILITY, BOOKING_STATUSES, ROLES } = require('./constants');

/** Collects express-validator errors into one consistent 422 response. */
const validate = (req, res, next) => {
  const result = validationResult(req);
  if (result.isEmpty()) return next();
  if (req.file) removeFile(req.file.path); // do not keep uploads for rejected requests
  const errors = result.array({ onlyFirstError: true }).map((e) => ({ field: e.path, message: e.msg }));
  return res.status(422).json({ success: false, message: errors[0].message, errors });
};

/* ---------- reusable field rules ---------- */
const req = (chain, msg) => chain.exists({ checkFalsy: true }).withMessage(msg);

const nameRule = (f = 'name', required = true) => {
  const c = body(f);
  return (required ? req(c, 'Name is required') : c.optional())
    .isString().trim().isLength({ min: 2, max: 100 }).withMessage('Name must be 2-100 characters');
};
const emailRule = () =>
  req(body('email'), 'Email is required').trim().isEmail().withMessage('Enter a valid email address')
    .isLength({ max: 150 }).normalizeEmail({ gmail_remove_dots: false });
const phoneRule = (f = 'phone', required = true) => {
  const c = body(f);
  return (required ? req(c, 'Phone number is required') : c.optional({ values: 'falsy' }))
    .customSanitizer(normalizePhone)
    .matches(/^[6-9]\d{9}$/).withMessage('Enter a valid 10-digit Indian mobile number');
};
const passwordRule = () =>
  req(body('password'), 'Password is required').isString()
    .isLength({ min: 8, max: 72 }).withMessage('Password must be 8-72 characters')
    .matches(/[A-Za-z]/).withMessage('Password must contain at least one letter')
    .matches(/\d/).withMessage('Password must contain at least one number');
const pincodeRule = (f = 'pincode', required = false) => {
  const c = body(f);
  return (required ? req(c, 'Pincode is required') : c.optional({ values: 'falsy' }))
    .trim().matches(/^[1-9]\d{5}$/).withMessage('Enter a valid 6-digit pincode');
};
const textRule = (f, max, label = f, required = false) => {
  const c = body(f);
  return (required ? req(c, `${label} is required`) : c.optional({ values: 'falsy' }))
    .isString().withMessage(`${label} must be text`).trim().isLength({ max }).withMessage(`${label} is too long (max ${max} characters)`);
};
const addressFields = (required = false) => [
  textRule('address', 255, 'Address', required),
  textRule('locality', 100, 'Locality'),
  textRule('city', 80, 'City', required),
  pincodeRule('pincode', required),
];
const idParam = (name = 'id') =>
  param(name).isInt({ min: 1 }).withMessage(`Invalid ${name}`).toInt();

/* ---------- auth ---------- */
const registerCustomer = [
  nameRule(), emailRule(), phoneRule(), passwordRule(), ...addressFields(false), validate,
];

const login = [
  body().custom((b) => {
    if (!(b.email || b.phone || b.identifier)) throw new Error('Email or phone number is required');
    return true;
  }),
  req(body('password'), 'Password is required').isString(),
  validate,
];

const registerProfessional = [
  nameRule(), emailRule(), phoneRule(), passwordRule(),
  req(body('service_id'), 'Please select the service you provide').isInt({ min: 1 }).withMessage('Invalid service').toInt(),
  body('experience_years').optional({ values: 'falsy' }).isInt({ min: 0, max: 60 }).withMessage('Experience must be between 0 and 60 years').toInt(),
  body('starting_price').optional({ values: 'falsy' }).isFloat({ min: 1, max: 100000 }).withMessage('Starting price must be between 1 and 100000').toFloat(),
  textRule('bio', 1000, 'Bio'),
  req(body('service_area'), 'Service area is required').isString().trim().isLength({ max: 255 }).withMessage('Service area is too long'),
  req(body('city'), 'City is required').isString().trim().isLength({ min: 2, max: 80 }).withMessage('City must be 2-80 characters'),
  pincodeRule('pincode', true),
  textRule('locality', 100, 'Locality'),
  validate,
];

/* ---------- users / profiles ---------- */
const updateMe = [
  nameRule('name', false), phoneRule('phone', false), ...addressFields(false), validate,
];
const updateAddress = [
  textRule('address', 255, 'Address', true), textRule('locality', 100, 'Locality'),
  textRule('city', 80, 'City', true), pincodeRule('pincode', true), validate,
];
const updateProfessionalProfile = [
  nameRule('name', false), phoneRule('phone', false),
  textRule('bio', 1000, 'Bio'),
  body('experience_years').optional({ values: 'falsy' }).isInt({ min: 0, max: 60 }).withMessage('Experience must be between 0 and 60 years').toInt(),
  body('starting_price').optional({ values: 'falsy' }).isFloat({ min: 1, max: 100000 }).withMessage('Starting price must be between 1 and 100000').toFloat(),
  textRule('service_area', 255, 'Service area'), textRule('city', 80, 'City'), pincodeRule('pincode'),
  textRule('locality', 100, 'Locality'),
  body('availability_status').optional().isIn(AVAILABILITY).withMessage(`availability_status must be one of: ${AVAILABILITY.join(', ')}`),
  validate,
];

/* ---------- services ---------- */
const createService = [
  req(body('name'), 'Service name is required').isString().trim().isLength({ min: 2, max: 80 }).withMessage('Service name must be 2-80 characters'),
  textRule('slug', 100, 'Slug'), textRule('description', 500, 'Description'), textRule('icon', 16, 'Icon'),
  body('starting_price').exists().withMessage('Starting price is required').isFloat({ min: 0, max: 100000 }).withMessage('Starting price must be between 0 and 100000').toFloat(),
  body('is_active').optional().isBoolean().withMessage('is_active must be true or false').toBoolean(),
  validate,
];
const updateService = [
  idParam(),
  body('name').optional().isString().trim().isLength({ min: 2, max: 80 }).withMessage('Service name must be 2-80 characters'),
  textRule('slug', 100, 'Slug'), textRule('description', 500, 'Description'), textRule('icon', 16, 'Icon'),
  body('starting_price').optional().isFloat({ min: 0, max: 100000 }).withMessage('Starting price must be between 0 and 100000').toFloat(),
  body('is_active').optional().isBoolean().withMessage('is_active must be true or false').toBoolean(),
  validate,
];

/* ---------- professional search ---------- */
const professionalSearch = [
  query('page').optional().isInt({ min: 1 }).withMessage('page must be 1 or more'),
  query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('limit must be between 1 and 50'),
  query('pincode').optional({ values: 'falsy' }).matches(/^[1-9]\d{5}$/).withMessage('Enter a valid 6-digit pincode'),
  query('min_rating').optional().isFloat({ min: 0, max: 5 }).withMessage('min_rating must be between 0 and 5'),
  query('experience').optional().isInt({ min: 0, max: 60 }).withMessage('experience must be between 0 and 60'),
  query('price').optional().isFloat({ min: 0 }).withMessage('price must be a positive number'),
  query('availability').optional({ values: 'falsy' }).isIn(AVAILABILITY).withMessage(`availability must be one of: ${AVAILABILITY.join(', ')}`),
  query('sort').optional({ values: 'falsy' }).isIn(['rating', 'experience', 'price', 'completed_jobs']).withMessage('sort must be rating, experience, price or completed_jobs'),
  query('order').optional({ values: 'falsy' }).isIn(['asc', 'desc']).withMessage('order must be asc or desc'),
  validate,
];
const paginationQuery = [
  query('page').optional().isInt({ min: 1 }).withMessage('page must be 1 or more'),
  query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('limit must be between 1 and 50'),
  validate,
];

/* ---------- bookings ---------- */
const createBooking = [
  body('service_id').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('Invalid service_id').toInt(),
  body('service').optional({ values: 'falsy' }).isString().trim().isLength({ min: 2, max: 80 }).withMessage('Invalid service'),
  body('professional_id').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('Invalid professional_id').toInt(),
  body().custom((b) => {
    if (!b.service_id && !b.service && !b.professional_id) throw new Error('Please select a service');
    return true;
  }),
  textRule('location', 255, 'Location'),
  body('address').optional({ values: 'falsy' }).isString().trim().isLength({ min: 5, max: 255 }).withMessage('Address must be 5-255 characters'),
  textRule('locality', 100, 'Locality'), textRule('city', 80, 'City'), pincodeRule('pincode'),
  req(body('preferred_date'), 'Preferred date is required').isString().trim().matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('preferred_date must be in YYYY-MM-DD format'),
  req(body('preferred_time'), 'Preferred time is required').isString().trim().isLength({ max: 30 }).withMessage('Invalid preferred_time'),
  phoneRule('contact_phone', false),
  textRule('problem_description', 1000, 'Problem description'),
  textRule('customer_notes', 500, 'Notes'),
  validate,
];
const finalPrice = (required) => {
  const c = body('final_price');
  return (required ? c.exists({ checkFalsy: true }).withMessage('final_price is required') : c.optional({ values: 'falsy' }))
    .isFloat({ min: 1, max: 1000000 }).withMessage('final_price must be between 1 and 1000000').toFloat();
};
const setPrice = [idParam(), finalPrice(true), validate];
const completeBooking = [idParam(), finalPrice(false), validate];

/* ---------- reviews ---------- */
const createReview = [
  req(body('booking_id'), 'booking_id is required').isInt({ min: 1 }).withMessage('Invalid booking_id').toInt(),
  body('rating').exists().withMessage('Rating is required').isInt({ min: 1, max: 5 }).withMessage('Rating must be a whole number between 1 and 5').toInt(),
  textRule('review', 1000, 'Review'),
  validate,
];

/* ---------- admin ---------- */
const adminListQuery = [
  ...paginationQuery.slice(0, -1),
  query('role').optional({ values: 'falsy' }).isIn(Object.values(ROLES)).withMessage('Invalid role'),
  query('status').optional({ values: 'falsy' }).isString().trim().isLength({ max: 20 }),
  query('search').optional({ values: 'falsy' }).isString().trim().isLength({ max: 100 }),
  validate,
];
const adminUpdateBooking = [
  idParam(),
  body('status').optional().isIn(BOOKING_STATUSES).withMessage(`status must be one of: ${BOOKING_STATUSES.join(', ')}`),
  finalPrice(false),
  body().custom((b) => {
    if (!b.status && !b.final_price) throw new Error('Provide a status and/or final_price');
    return true;
  }),
  validate,
];

module.exports = {
  validate, idParam,
  registerCustomer, login, registerProfessional,
  updateMe, updateAddress, updateProfessionalProfile,
  createService, updateService,
  professionalSearch, paginationQuery,
  createBooking, setPrice, completeBooking,
  createReview,
  adminListQuery, adminUpdateBooking,
};
