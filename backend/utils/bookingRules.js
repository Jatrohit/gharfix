'use strict';
const AppError = require('./AppError');
const config = require('../config/env');
const { TIME_SLOTS, BOOKING_RULES } = require('./constants');

/** Current date (YYYY-MM-DD) and minutes-since-midnight in the platform timezone. */
function nowInTz(tz = config.timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type).value;
  const hour = Number(get('hour')) % 24; // some runtimes report midnight as "24"
  return { today: `${get('year')}-${get('month')}-${get('day')}`, minutes: hour * 60 + Number(get('minute')) };
}

const addDays = (dateStr, days) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

/** Canonicalise "9am-12pm", "9 AM - 12 PM" ... to the stored slot label. */
function findSlot(input) {
  const m = /^(\d{1,2})\s*(AM|PM)\s*[-–—]\s*(\d{1,2})\s*(AM|PM)$/i.exec(input);
  if (!m) return null;
  const label = `${Number(m[1])} ${m[2].toUpperCase()} – ${Number(m[3])} ${m[4].toUpperCase()}`;
  return TIME_SLOTS.find((s) => s.label === label) || null;
}

/**
 * Validate the requested date + time. Returns the canonical values to store.
 * Accepts a named slot ("9 AM – 12 PM") or an exact time ("14:30").
 */
function validateSchedule(dateStr, timeStr) {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
  if (!dm) throw new AppError('preferred_date must be in YYYY-MM-DD format', 422);
  const [y, mo, d] = dm.slice(1).map(Number);
  const asDate = new Date(Date.UTC(y, mo - 1, d));
  if (asDate.getUTCFullYear() !== y || asDate.getUTCMonth() !== mo - 1 || asDate.getUTCDate() !== d) {
    throw new AppError('Preferred date is not a valid calendar date', 422);
  }

  const { today, minutes: nowMin } = nowInTz();
  if (dateStr < today) throw new AppError('Preferred date cannot be in the past', 422);
  if (dateStr > addDays(today, BOOKING_RULES.maxDaysAhead)) {
    throw new AppError(`Bookings can be made up to ${BOOKING_RULES.maxDaysAhead} days in advance`, 422);
  }

  const raw = String(timeStr || '').trim();
  const slot = findSlot(raw);
  if (slot) {
    if (dateStr === today && slot.endMin <= nowMin) {
      throw new AppError('This time slot has already passed. Please choose a later slot.', 422);
    }
    return { preferred_date: dateStr, preferred_time: slot.label };
  }

  const tm = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(raw);
  if (!tm) {
    throw new AppError(
      `Invalid time. Use one of: ${TIME_SLOTS.map((s) => s.label).join(', ')} or HH:MM (24-hour)`,
      422
    );
  }
  const minutes = Number(tm[1]) * 60 + Number(tm[2]);
  if (minutes < BOOKING_RULES.earliestMinute || minutes > BOOKING_RULES.latestMinute) {
    throw new AppError('Services are available between 07:00 and 21:00', 422);
  }
  if (dateStr === today && minutes < nowMin + BOOKING_RULES.minLeadMinutes) {
    throw new AppError(
      `Please choose a time at least ${BOOKING_RULES.minLeadMinutes} minutes from now`,
      422
    );
  }
  return { preferred_date: dateStr, preferred_time: `${String(tm[1]).padStart(2, '0')}:${tm[2]}` };
}

/**
 * Price is always decided on the backend (the client-sent price is ignored).
 * The professional's own starting price wins; otherwise the service's base price.
 */
function calculateEstimatedPrice(professional, service) {
  const proPrice = Number(professional.starting_price);
  const price = proPrice > 0 ? proPrice : Number(service.starting_price);
  return Math.round(price * 100) / 100;
}

module.exports = { nowInTz, validateSchedule, calculateEstimatedPrice, findSlot };
