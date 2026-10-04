'use strict';
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { success } = require('../utils/apiResponse');
const { mapUser } = require('../utils/mappers');
const { publicPath } = require('../middleware/uploadMiddleware');
const userModel = require('../models/userModel');
const professionalModel = require('../models/professionalModel');
const { ROLES } = require('../utils/constants');

exports.getMe = asyncHandler(async (req, res) => success(res, mapUser(req.user), 'Profile fetched'));

exports.updateMe = asyncHandler(async (req, res) => {
  const { name, phone, address, locality, city, pincode } = req.body;
  if (phone && phone !== req.user.phone && (await userModel.phoneTakenByOther(phone, req.user.id))) {
    throw new AppError('An account with this phone number already exists', 409, 'PHONE_EXISTS');
  }
  const image = publicPath(req.file);
  await userModel.update(req.user.id, { name, phone, address, locality, city, pincode, profile_image: image });
  if (image && req.user.role === ROLES.PROFESSIONAL) {
    const pro = await professionalModel.findByUserId(req.user.id);
    if (pro) await professionalModel.updateProfile(pro.id, { profile_image: image });
  }
  return success(res, mapUser(await userModel.findById(req.user.id)), 'Profile updated successfully');
});

exports.updateAddress = asyncHandler(async (req, res) => {
  const { address, locality, city, pincode } = req.body;
  await userModel.update(req.user.id, { address, locality: locality || null, city, pincode });
  return success(res, mapUser(await userModel.findById(req.user.id)), 'Address updated successfully');
});
