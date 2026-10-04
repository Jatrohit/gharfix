'use strict';
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { success, created, paginated } = require('../utils/apiResponse');
const { mapBooking } = require('../utils/mappers');
const { getPagination, buildPagination, extractPincode, isValidPincode } = require('../utils/helpers');
const { validateSchedule, calculateEstimatedPrice } = require('../utils/bookingRules');
const { changeStatus } = require('../utils/bookingWorkflow');
const { BOOKING_STATUSES, ROLES } = require('../utils/constants');
const bookingModel = require('../models/bookingModel');
const serviceModel = require('../models/serviceModel');
const professionalModel = require('../models/professionalModel');

/**
 * Work out address/locality/city/pincode from what the frontend sent.
 * The existing frontend has ONE "Location" box (locality or pincode), so we accept that
 * as `location`. The customer's saved profile is used ONLY when the request carries no
 * location information at all - otherwise a typed locality could be paired with the
 * pincode of a different area.
 */
function resolveLocation(body, customer) {
  const text = (body.location || '').trim();
  const looksLikePincode = /^[1-9]\d{5}$/.test(text);
  const given = Boolean(text || body.pincode || body.locality || body.address);

  if (!given) {
    return { address: customer.address, locality: customer.locality, city: body.city || customer.city, pincode: customer.pincode };
  }
  const pincode = body.pincode || (looksLikePincode ? text : extractPincode(text)) || null;
  const locality =
    body.locality || (text && !looksLikePincode ? text.replace(/[\s,]*[1-9]\d{5}$/, '').trim() : null) || null;
  return {
    address: body.address || text || locality,
    locality,
    city: body.city || customer.city || null,
    pincode,
  };
}

exports.create = asyncHandler(async (req, res) => {
  const b = req.body;
  const customer = req.user;

  // 1-2. Resolve and validate the professional + service
  let professional = null;
  if (b.professional_id) {
    professional = await professionalModel.findById(b.professional_id);
    if (!professional) throw new AppError('Professional not found', 404);
  }
  let service = null;
  if (b.service_id) service = await serviceModel.findById(b.service_id);
  else if (b.service) service = await serviceModel.findByIdentifier(b.service);
  else if (professional) service = await serviceModel.findById(professional.service_id);
  if (!service) throw new AppError('Service not found', 404);
  if (!service.is_active) throw new AppError('This service is not available right now', 409);

  // 3. Professional must provide this service, be approved/active, and be available
  if (professional) {
    if (professional.service_id !== service.id) {
      throw new AppError('This professional does not provide the selected service', 422);
    }
    if (professional.verification_status !== 'approved' || !professional.is_active) {
      throw new AppError('This professional is not verified yet and cannot accept bookings', 409, 'PROFESSIONAL_NOT_VERIFIED');
    }
    if (professional.availability_status !== 'available') {
      throw new AppError(
        `${professional.name} is currently ${professional.availability_status}. Please choose another professional.`,
        409,
        'PROFESSIONAL_UNAVAILABLE'
      );
    }
  }

  // 4. Location + schedule
  const loc = resolveLocation(b, customer);
  if (!loc.pincode && !loc.locality) throw new AppError('Please enter your locality or pincode', 422);
  if (loc.pincode && !isValidPincode(loc.pincode)) throw new AppError('Enter a valid 6-digit pincode', 422);
  const schedule = validateSchedule(b.preferred_date, b.preferred_time);

  // 5. "Any available professional": pick the best free match in the customer's area
  if (!professional) {
    const candidates = await professionalModel.findAvailableCandidates({
      serviceId: service.id, city: loc.city, pincode: loc.pincode,
    });
    for (const c of candidates) {
      const taken = await bookingModel.hasSlotConflict({
        professionalId: c.id, customerId: customer.id, date: schedule.preferred_date, time: schedule.preferred_time,
      });
      if (!taken) { professional = await professionalModel.findById(c.id); break; }
    }
    if (!professional) {
      throw new AppError('No professionals are available for this service and time in your area. Try another slot.', 404, 'NO_PROFESSIONAL');
    }
  } else if (
    await bookingModel.hasSlotConflict({
      professionalId: professional.id, customerId: customer.id, date: schedule.preferred_date, time: schedule.preferred_time,
    })
  ) {
    throw new AppError('This professional is already booked for that slot. Please choose another time.', 409, 'SLOT_TAKEN');
  }

  // 6. Price is calculated here - any price sent by the client is ignored
  const estimated = calculateEstimatedPrice(professional, service);

  const id = await bookingModel.create({
    customer_id: customer.id,
    professional_id: professional.id,
    service_id: service.id,
    address: loc.address || loc.locality,
    locality: loc.locality,
    city: loc.city || professional.city,
    pincode: loc.pincode,
    ...schedule,
    problem_description: b.problem_description || null,
    estimated_price: estimated,
    customer_notes: b.customer_notes || null,
    contact_phone: b.contact_phone || customer.phone,
    booking_source: 'web', // phone / whatsapp / admin sources will be set by future operator tooling
  });

  const booking = await bookingModel.findById(id);
  return created(res, mapBooking(booking, 'customer'), 'Booking created successfully');
});

const listQuery = (req) => {
  const status = BOOKING_STATUSES.includes(req.query.status) ? req.query.status : undefined;
  return { status, ...getPagination(req.query) };
};

exports.myBookings = asyncHandler(async (req, res) => {
  const q = listQuery(req);
  const { rows, total } = await bookingModel.listForCustomer(req.user.id, q);
  return paginated(res, rows.map((r) => mapBooking(r, 'customer')), buildPagination(q, total), 'Bookings fetched');
});

exports.professionalBookings = asyncHandler(async (req, res) => {
  const q = listQuery(req);
  const { rows, total } = await bookingModel.listForProfessional(req.professional.id, q);
  return paginated(res, rows.map((r) => mapBooking(r, 'professional')), buildPagination(q, total), 'Bookings fetched');
});

/** Customer who owns it, the assigned professional, or an admin. Others get a 404 (no information leak). */
exports.getOne = asyncHandler(async (req, res) => {
  const booking = await bookingModel.findById(req.params.id);
  if (!booking) throw new AppError('Booking not found', 404);
  const { id, role } = req.user;
  const isOwner = booking.customer_id === id;
  const isAssignedPro = role === ROLES.PROFESSIONAL && booking.professional_user_id === id;
  if (!isOwner && !isAssignedPro && role !== ROLES.ADMIN) throw new AppError('Booking not found', 404);
  const viewer = role === ROLES.ADMIN ? 'admin' : isAssignedPro ? 'professional' : 'customer';
  return success(res, mapBooking(booking, viewer), 'Booking fetched');
});

/* ---- helpers for ownership checks ---- */
async function ownedByCustomer(req) {
  const booking = await bookingModel.findById(req.params.id);
  if (!booking || booking.customer_id !== req.user.id) throw new AppError('Booking not found', 404);
  return booking;
}
async function ownedByProfessional(req) {
  const booking = await bookingModel.findById(req.params.id);
  if (!booking || booking.professional_id !== req.professional.id) throw new AppError('Booking not found', 404);
  return booking;
}

exports.cancel = asyncHandler(async (req, res) => {
  const booking = await ownedByCustomer(req);
  const updated = await changeStatus({ booking, to: 'cancelled', actor: 'customer' });
  return success(res, mapBooking(updated, 'customer'), 'Booking cancelled successfully');
});

const proAction = (to, message) =>
  asyncHandler(async (req, res) => {
    const booking = await ownedByProfessional(req);
    const updated = await changeStatus({ booking, to, actor: 'professional', finalPrice: req.body.final_price });
    return success(res, mapBooking(updated, 'professional'), message);
  });

exports.accept = proAction('accepted', 'Booking accepted');
exports.reject = proAction('rejected', 'Booking rejected');
exports.start = proAction('in_progress', 'Work started');
exports.complete = proAction('completed', 'Booking marked as completed');

/** Professional records the real price after inspecting the work (before or at completion). */
exports.setPrice = asyncHandler(async (req, res) => {
  const booking = await ownedByProfessional(req);
  const ok = await bookingModel.setFinalPrice(booking.id, req.body.final_price, ['accepted', 'confirmed', 'in_progress']);
  if (!ok) throw new AppError('The final price can only be set while the booking is accepted or in progress', 409);
  return success(res, mapBooking(await bookingModel.findById(booking.id), 'professional'), 'Final price updated');
});
