'use strict';
const AppError = require('./AppError');
const { ACTOR_TRANSITIONS } = require('./constants');
const { withTransaction } = require('../config/db');
const bookingModel = require('../models/bookingModel');
const professionalModel = require('../models/professionalModel');

/**
 * The single place where booking status changes are validated and applied.
 * Customers, professionals and admins all go through here, so the rules cannot drift.
 */
async function changeStatus({ booking, to, actor, finalPrice }) {
  const allowedFrom = (ACTOR_TRANSITIONS[actor] || {})[to];
  if (!allowedFrom) {
    throw new AppError(`You are not allowed to set a booking to "${to}"`, 403, 'FORBIDDEN_TRANSITION');
  }
  if (!allowedFrom.includes(booking.status)) {
    const msg =
      booking.status === 'cancelled'
        ? 'This booking has already been cancelled'
        : `A booking that is "${booking.status}" cannot be changed to "${to}"`;
    throw new AppError(msg, 409, 'INVALID_TRANSITION');
  }

  await withTransaction(async (conn) => {
    const extra = {};
    if (to === 'completed') {
      // final price: explicit value > price already set by the professional > estimate
      extra.final_price = finalPrice ?? booking.final_price ?? booking.estimated_price;
    }
    const changed = await bookingModel.transition(booking.id, allowedFrom, to, extra, conn);
    if (!changed) {
      throw new AppError('This booking was just updated by someone else. Please refresh and try again.', 409, 'CONFLICT');
    }
    if (to === 'completed') await professionalModel.incrementCompletedJobs(booking.professional_id, conn);
  });

  return bookingModel.findById(booking.id);
}

module.exports = { changeStatus };
