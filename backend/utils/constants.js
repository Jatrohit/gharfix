'use strict';

const ROLES = Object.freeze({ CUSTOMER: 'customer', PROFESSIONAL: 'professional', ADMIN: 'admin' });
const AVAILABILITY = ['available', 'busy', 'offline'];
const VERIFICATION = ['pending', 'approved', 'rejected'];
const BOOKING_STATUSES = [
  'pending',
  'accepted',
  'rejected',
  'confirmed',
  'in_progress',
  'completed',
  'cancelled',
];
const BOOKING_SOURCES = ['web', 'admin', 'phone', 'whatsapp'];

/**
 * Who may move a booking to which status, and from which current statuses.
 * "confirmed" is reserved for admin/operator confirmation (phone/WhatsApp workflow,
 * later: payment confirmation). A professional accepting a booking sets "accepted".
 */
const ACTOR_TRANSITIONS = Object.freeze({
  customer: { cancelled: ['pending', 'accepted', 'confirmed'] },
  professional: {
    accepted: ['pending'],
    rejected: ['pending'],
    in_progress: ['accepted', 'confirmed'],
    completed: ['in_progress'],
  },
  admin: {
    accepted: ['pending'],
    rejected: ['pending'],
    confirmed: ['pending', 'accepted'],
    in_progress: ['accepted', 'confirmed'],
    completed: ['in_progress'],
    cancelled: ['pending', 'accepted', 'confirmed', 'in_progress'],
  },
});

/** Bookable windows (matches the time slots in the existing frontend modal). */
const TIME_SLOTS = [
  { label: '9 AM – 12 PM', startMin: 9 * 60, endMin: 12 * 60 },
  { label: '12 PM – 3 PM', startMin: 12 * 60, endMin: 15 * 60 },
  { label: '3 PM – 6 PM', startMin: 15 * 60, endMin: 18 * 60 },
  { label: '6 PM – 9 PM', startMin: 18 * 60, endMin: 21 * 60 },
];

const BOOKING_RULES = Object.freeze({
  maxDaysAhead: 60,
  minLeadMinutes: 30, // exact HH:MM bookings for today must be at least this far ahead
  earliestMinute: 7 * 60,
  latestMinute: 21 * 60,
});

module.exports = {
  ROLES,
  AVAILABILITY,
  VERIFICATION,
  BOOKING_STATUSES,
  BOOKING_SOURCES,
  ACTOR_TRANSITIONS,
  TIME_SLOTS,
  BOOKING_RULES,
};
