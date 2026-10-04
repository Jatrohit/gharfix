'use strict';
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { success, paginated } = require('../utils/apiResponse');
const { mapUser, mapProfessional, mapBooking, mapReview } = require('../utils/mappers');
const { getPagination, buildPagination } = require('../utils/helpers');
const { changeStatus } = require('../utils/bookingWorkflow');
const { withTransaction, query } = require('../config/db');
const { VERIFICATION, BOOKING_STATUSES } = require('../utils/constants');
const userModel = require('../models/userModel');
const professionalModel = require('../models/professionalModel');
const bookingModel = require('../models/bookingModel');
const reviewModel = require('../models/reviewModel');
const serviceModel = require('../models/serviceModel');

exports.dashboard = asyncHandler(async (req, res) => {
  const [users] = await query(`SELECT
      COALESCE(SUM(role = 'customer'), 0) AS total_customers FROM users`);
  const [pros] = await query(`SELECT
      COUNT(*) AS total_professionals,
      COALESCE(SUM(verification_status = 'approved'), 0) AS verified_professionals,
      COALESCE(SUM(verification_status = 'pending'), 0) AS pending_professionals,
      COALESCE(SUM(verification_status = 'rejected'), 0) AS rejected_professionals
      FROM professionals`);
  const bookings = await bookingModel.dashboardCounts();
  const [reviews] = await query('SELECT COUNT(*) AS total_reviews FROM reviews');
  const data = {
    total_customers: Number(users.total_customers),
    total_professionals: Number(pros.total_professionals),
    verified_professionals: Number(pros.verified_professionals),
    pending_professionals: Number(pros.pending_professionals),
    rejected_professionals: Number(pros.rejected_professionals),
    total_bookings: Number(bookings.total_bookings),
    pending_bookings: Number(bookings.pending_bookings),
    completed_bookings: Number(bookings.completed_bookings),
    cancelled_bookings: Number(bookings.cancelled_bookings),
    total_services: await serviceModel.count(),
    total_reviews: Number(reviews.total_reviews),
  };
  return success(res, data, 'Dashboard statistics fetched');
});

exports.listUsers = asyncHandler(async (req, res) => {
  const page = getPagination(req.query);
  const { rows, total } = await userModel.list({ role: req.query.role, search: req.query.search, ...page });
  return paginated(res, rows.map(mapUser), buildPagination(page, total), 'Users fetched');
});

exports.listProfessionals = asyncHandler(async (req, res) => {
  const status = [...VERIFICATION, 'suspended'].includes(req.query.status) ? req.query.status : undefined;
  const page = getPagination(req.query);
  const { rows, total } = await professionalModel.adminList({ status, search: req.query.search, ...page });
  return paginated(res, rows.map((r) => mapProfessional(r, 'admin')), buildPagination(page, total), 'Professionals fetched');
});

async function getProfessional(id) {
  const pro = await professionalModel.findById(id);
  if (!pro) throw new AppError('Professional not found', 404);
  return pro;
}

const setVerification = (status, message) =>
  asyncHandler(async (req, res) => {
    const pro = await getProfessional(req.params.id);
    await withTransaction(async (conn) => {
      await professionalModel.setVerification(pro.id, status, pro.user_id, conn);
      if (status === 'approved') await professionalModel.setSuspended(pro.user_id, false, conn);
    });
    return success(res, mapProfessional(await professionalModel.findById(pro.id), 'admin'), message);
  });

exports.approveProfessional = setVerification('approved', 'Professional approved');
exports.rejectProfessional = setVerification('rejected', 'Professional rejected');

exports.suspendProfessional = asyncHandler(async (req, res) => {
  const pro = await getProfessional(req.params.id);
  await professionalModel.setSuspended(pro.user_id, true);
  return success(res, mapProfessional(await professionalModel.findById(pro.id), 'admin'), 'Professional suspended');
});

exports.reinstateProfessional = asyncHandler(async (req, res) => {
  const pro = await getProfessional(req.params.id);
  await professionalModel.setSuspended(pro.user_id, false);
  return success(res, mapProfessional(await professionalModel.findById(pro.id), 'admin'), 'Professional reinstated');
});

exports.listBookings = asyncHandler(async (req, res) => {
  const status = BOOKING_STATUSES.includes(req.query.status) ? req.query.status : undefined;
  const page = getPagination(req.query);
  const { rows, total } = await bookingModel.listAll({ status, search: req.query.search, ...page });
  return paginated(res, rows.map((r) => mapBooking(r, 'admin')), buildPagination(page, total), 'Bookings fetched');
});

/** Admin override: change status (still validated against allowed transitions) and/or final price. */
exports.updateBooking = asyncHandler(async (req, res) => {
  let booking = await bookingModel.findById(req.params.id);
  if (!booking) throw new AppError('Booking not found', 404);
  const { status, final_price: finalPrice } = req.body;

  if (status && status !== booking.status) {
    booking = await changeStatus({ booking, to: status, actor: 'admin', finalPrice });
  }
  if (finalPrice) await bookingModel.setFinalPrice(booking.id, finalPrice, BOOKING_STATUSES);
  return success(res, mapBooking(await bookingModel.findById(booking.id), 'admin'), 'Booking updated');
});

exports.listReviews = asyncHandler(async (req, res) => {
  const page = getPagination(req.query);
  const { rows, total } = await reviewModel.listAll(page);
  return paginated(res, rows.map(mapReview), buildPagination(page, total), 'Reviews fetched');
});

exports.deleteReview = asyncHandler(async (req, res) => {
  const review = await reviewModel.findById(req.params.id);
  if (!review) throw new AppError('Review not found', 404);
  await withTransaction(async (conn) => {
    await reviewModel.remove(review.id, conn);
    await reviewModel.recalcProfessionalStats(review.professional_id, conn);
  });
  return success(res, { id: review.id }, 'Review removed and professional rating recalculated');
});
