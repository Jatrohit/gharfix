'use strict';
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { created, paginated } = require('../utils/apiResponse');
const { mapReview } = require('../utils/mappers');
const { getPagination, buildPagination } = require('../utils/helpers');
const { withTransaction } = require('../config/db');
const bookingModel = require('../models/bookingModel');
const reviewModel = require('../models/reviewModel');
const professionalModel = require('../models/professionalModel');

exports.create = asyncHandler(async (req, res) => {
  const { booking_id: bookingId, rating, review } = req.body;
  const booking = await bookingModel.findById(bookingId);
  if (!booking || booking.customer_id !== req.user.id) throw new AppError('Booking not found', 404);
  if (booking.status !== 'completed') {
    throw new AppError('You can review a professional only after the booking is completed', 409, 'BOOKING_NOT_COMPLETED');
  }
  if (booking.review_id) throw new AppError('You have already reviewed this booking', 409, 'DUPLICATE_REVIEW');

  // Insert + recalculate in one transaction; the UNIQUE(booking_id) key blocks double submits
  const reviewId = await withTransaction(async (conn) => {
    const id = await reviewModel.create(
      { booking_id: booking.id, customer_id: req.user.id, professional_id: booking.professional_id, rating, review },
      conn
    );
    await reviewModel.recalcProfessionalStats(booking.professional_id, conn);
    return id;
  });

  const saved = await reviewModel.findById(reviewId);
  const pro = await professionalModel.findById(booking.professional_id);
  return created(res, { review: mapReview(saved), professional: { id: pro.id, rating: Number(pro.rating), total_reviews: pro.total_reviews } }, 'Review submitted successfully');
});

/** GET /api/professionals/:id/reviews (public) */
exports.listForProfessional = asyncHandler(async (req, res) => {
  const pro = await professionalModel.findPublicById(req.params.id);
  if (!pro) throw new AppError('Professional not found', 404);
  const page = getPagination(req.query);
  const { rows, total } = await reviewModel.listByProfessional(pro.id, page);
  return paginated(res, rows.map(mapReview), { ...buildPagination(page, total), rating: Number(pro.rating) }, 'Reviews fetched');
});
