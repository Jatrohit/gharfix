'use strict';
const bcrypt = require('bcryptjs');
const config = require('../config/env');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { success, created } = require('../utils/apiResponse');
const { generateToken } = require('../utils/generateToken');
const { mapUser, mapProfessional } = require('../utils/mappers');
const { normalizePhone } = require('../utils/helpers');
const { withTransaction } = require('../config/db');
const { ROLES } = require('../utils/constants');
const { publicPath } = require('../middleware/uploadMiddleware');
const userModel = require('../models/userModel');
const serviceModel = require('../models/serviceModel');
const professionalModel = require('../models/professionalModel');

// Compared against when the account does not exist, so response time does not reveal valid emails
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password-1', 10);

async function assertUnique(email, phone) {
  if (await userModel.findByEmail(email)) throw new AppError('An account with this email already exists', 409, 'EMAIL_EXISTS');
  if (await userModel.findByPhone(phone)) throw new AppError('An account with this phone number already exists', 409, 'PHONE_EXISTS');
}

const hashPassword = (plain) => bcrypt.hash(plain, config.bcryptRounds);

exports.register = asyncHandler(async (req, res) => {
  const b = req.body;
  await assertUnique(b.email, b.phone);
  const id = await userModel.create({
    name: b.name, email: b.email, phone: b.phone, password: await hashPassword(b.password),
    role: ROLES.CUSTOMER, address: b.address || null, locality: b.locality || null,
    city: b.city || null, pincode: b.pincode || null, profile_image: null,
  });
  const user = await userModel.findById(id);
  return created(res, { user: mapUser(user), token: generateToken(user) }, 'Registration successful');
});

exports.registerProfessional = asyncHandler(async (req, res) => {
  const b = req.body;
  const service = await serviceModel.findById(b.service_id);
  if (!service || !service.is_active) throw new AppError('Selected service is not available', 404);
  await assertUnique(b.email, b.phone);

  const image = publicPath(req.file) || null;
  const password = await hashPassword(b.password);

  const userId = await withTransaction(async (conn) => {
    const uid = await userModel.create(
      {
        name: b.name, email: b.email, phone: b.phone, password, role: ROLES.PROFESSIONAL,
        address: null, locality: b.locality || null, city: b.city, pincode: b.pincode, profile_image: image,
      },
      conn
    );
    await professionalModel.create(
      {
        user_id: uid, service_id: service.id, bio: b.bio || null, experience_years: b.experience_years,
        starting_price: b.starting_price, service_area: b.service_area, city: b.city, pincode: b.pincode,
        profile_image: image,
      },
      conn
    );
    return uid;
  });

  const user = await userModel.findById(userId);
  const professional = await professionalModel.findByUserId(userId);
  return created(
    res,
    { user: mapUser(user), professional: mapProfessional(professional, 'owner'), token: generateToken(user) },
    'Registration received. Your profile will go live after admin verification.'
  );
});

/** Shared login logic. `allowedRoles` keeps customer and professional logins separate. */
const makeLogin = (allowedRoles) =>
  asyncHandler(async (req, res) => {
    const identifier = String(req.body.email || req.body.identifier || req.body.phone || '').trim();
    const isEmail = identifier.includes('@');
    const user = await userModel.findForLogin(
      isEmail ? { email: identifier } : { phone: normalizePhone(identifier) }
    );

    const passwordOk = await bcrypt.compare(String(req.body.password), user ? user.password : DUMMY_HASH);
    if (!user || !passwordOk || !allowedRoles.includes(user.role)) {
      throw new AppError('Invalid email/phone or password', 401, 'INVALID_CREDENTIALS');
    }
    if (!user.is_active) {
      throw new AppError('Your account has been suspended. Please contact support.', 403, 'ACCOUNT_SUSPENDED');
    }

    const safeUser = await userModel.findById(user.id);
    const data = { user: mapUser(safeUser), token: generateToken(safeUser) };
    if (user.role === ROLES.PROFESSIONAL) {
      data.professional = mapProfessional(await professionalModel.findByUserId(user.id), 'owner');
    }
    return success(res, data, 'Login successful');
  });

exports.login = makeLogin([ROLES.CUSTOMER, ROLES.ADMIN]);
exports.professionalLogin = makeLogin([ROLES.PROFESSIONAL]);

exports.me = asyncHandler(async (req, res) => {
  const data = { user: mapUser(req.user) };
  if (req.user.role === ROLES.PROFESSIONAL) {
    data.professional = mapProfessional(await professionalModel.findByUserId(req.user.id), 'owner');
  }
  return success(res, data, 'Current user fetched');
});
