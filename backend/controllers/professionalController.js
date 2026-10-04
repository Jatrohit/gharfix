'use strict';
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { success, paginated } = require('../utils/apiResponse');
const { mapProfessional } = require('../utils/mappers');
const { getPagination, buildPagination } = require('../utils/helpers');
const { withTransaction } = require('../config/db');
const { publicPath } = require('../middleware/uploadMiddleware');
const professionalModel = require('../models/professionalModel');
const userModel = require('../models/userModel');
const serviceModel = require('../models/serviceModel');

async function runSearch(req, res, extraFilters = {}) {
  const page = getPagination(req.query);
  const { rows, total } = await professionalModel.searchPublic({ ...req.query, ...extraFilters }, page);
  return paginated(res, rows.map((r) => mapProfessional(r)), buildPagination(page, total), 'Professionals fetched');
}

exports.list = asyncHandler((req, res) => runSearch(req, res));
exports.search = asyncHandler((req, res) => runSearch(req, res));

exports.byService = asyncHandler(async (req, res) => {
  const service = await serviceModel.findById(req.params.serviceId);
  if (!service || !service.is_active) throw new AppError('Service not found', 404);
  return runSearch(req, res, { serviceId: service.id });
});

exports.getOne = asyncHandler(async (req, res) => {
  const pro = await professionalModel.findPublicById(req.params.id);
  if (!pro) throw new AppError('Professional not found', 404);
  return success(res, mapProfessional(pro), 'Professional fetched');
});

exports.getMyProfile = asyncHandler(async (req, res) =>
  success(res, mapProfessional(req.professional, 'owner'), 'Profile fetched')
);

/**
 * Professionals may edit their own details only.
 * verification_status, rating, total_reviews and completed_jobs are never read from the request.
 */
exports.updateMyProfile = asyncHandler(async (req, res) => {
  const b = req.body;
  if (b.phone && b.phone !== req.user.phone && (await userModel.phoneTakenByOther(b.phone, req.user.id))) {
    throw new AppError('An account with this phone number already exists', 409, 'PHONE_EXISTS');
  }
  const image = publicPath(req.file);

  await withTransaction(async (conn) => {
    await userModel.update(req.user.id, { name: b.name, phone: b.phone, locality: b.locality, profile_image: image }, conn);
    await professionalModel.updateProfile(
      req.professional.id,
      {
        bio: b.bio, experience_years: b.experience_years, starting_price: b.starting_price,
        service_area: b.service_area, city: b.city, pincode: b.pincode,
        availability_status: b.availability_status, profile_image: image,
      },
      conn
    );
  });

  const updated = await professionalModel.findById(req.professional.id);
  return success(res, mapProfessional(updated, 'owner'), 'Profile updated successfully');
});

