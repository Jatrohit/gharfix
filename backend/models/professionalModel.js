'use strict';
const { query } = require('../config/db');
const { buildUpdate, escapeLike, slugify } = require('../utils/helpers');

// A professional's own price wins; otherwise fall back to the service's base price
const EFFECTIVE_PRICE = 'COALESCE(NULLIF(p.starting_price, 0), s.starting_price)';

const SELECT = `
  SELECT p.id, p.user_id, p.service_id, p.bio, p.experience_years, p.starting_price,
         ${EFFECTIVE_PRICE} AS effective_price,
         p.service_area, p.city, p.pincode, p.rating, p.total_reviews, p.completed_jobs,
         p.availability_status, p.verification_status, p.profile_image, p.created_at, p.updated_at,
         u.name, u.email, u.phone, u.locality, u.is_active,
         s.name AS service_name, s.slug AS service_slug, s.icon AS service_icon
  FROM professionals p
  JOIN users u ON u.id = p.user_id
  JOIN services s ON s.id = p.service_id`;


const GENERIC_WORDS = new Set(['sector', 'block', 'phase', 'pocket', 'extension', 'ext', 'road', 'near', 'colony', 'delhi', 'new']);
/** Meaningful words from a typed locality; falls back to the whole text if nothing is left. */
function localityTokens(text) {
  const words = String(text).toLowerCase().split(/[\s,]+/).filter(Boolean);
  const kept = words.filter((w) => w.length > 2 && !/^\d+$/.test(w) && !GENERIC_WORDS.has(w));
  return (kept.length ? kept : [String(text).trim()]).slice(0, 4);
}

const PUBLIC_WHERE = "p.verification_status = 'approved' AND u.is_active = 1 AND s.is_active = 1";

const SORTS = {
  rating: 'p.rating',
  experience: 'p.experience_years',
  price: EFFECTIVE_PRICE,
  completed_jobs: 'p.completed_jobs',
};

const findById = async (id, db) => (await query(`${SELECT} WHERE p.id = ?`, [id], db))[0] || null;
const findByUserId = async (userId, db) => (await query(`${SELECT} WHERE p.user_id = ?`, [userId], db))[0] || null;

/** Approved + active professionals only (what customers are allowed to see). */
const findPublicById = async (id) =>
  (await query(`${SELECT} WHERE p.id = ? AND ${PUBLIC_WHERE}`, [id]))[0] || null;

function buildFilters(f) {
  const where = [PUBLIC_WHERE];
  const params = [];
  if (f.serviceId) { where.push('p.service_id = ?'); params.push(f.serviceId); }
  if (f.service) {
    const text = String(f.service).trim();
    where.push('(s.slug = ? OR s.name LIKE ? OR ? LIKE CONCAT(\'%\', s.name, \'%\') OR s.id = ?)');
    params.push(slugify(text), `%${escapeLike(text)}%`, text, /^\d+$/.test(text) ? Number(text) : 0);
  }
  if (f.city) { where.push('p.city = ?'); params.push(f.city); }
  if (f.locality) {
    // "Rohini Sector 23" -> match on "rohini" (numbers and generic words are ignored)
    const tokens = localityTokens(f.locality);
    const clauses = tokens.map(() => '(p.service_area LIKE ? OR u.locality LIKE ?)');
    for (const t of tokens) params.push(`%${escapeLike(t)}%`, `%${escapeLike(t)}%`);
    where.push(`(${clauses.join(' OR ')})`);
  }
  if (f.pincode) {
    where.push('(p.pincode = ? OR p.service_area LIKE ?)');
    params.push(f.pincode, `%${f.pincode}%`);
  }
  if (f.min_rating) { where.push('p.rating >= ?'); params.push(Number(f.min_rating)); }
  if (f.availability) { where.push('p.availability_status = ?'); params.push(f.availability); }
  if (f.experience) { where.push('p.experience_years >= ?'); params.push(Number(f.experience)); }
  if (f.price) { where.push(`${EFFECTIVE_PRICE} <= ?`); params.push(Number(f.price)); }
  return { clause: `WHERE ${where.join(' AND ')}`, params };
}

const searchPublic = async (filters, { limit, offset }) => {
  const { clause, params } = buildFilters(filters);
  const sortCol = SORTS[filters.sort] || SORTS.rating;
  const dir = String(filters.order).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const [{ total }] = await query(
    `SELECT COUNT(*) AS total FROM professionals p JOIN users u ON u.id = p.user_id JOIN services s ON s.id = p.service_id ${clause}`,
    params
  );
  const rows = await query(
    `${SELECT} ${clause} ORDER BY ${sortCol} ${dir}, p.completed_jobs DESC, p.id ASC LIMIT ${Number(limit)} OFFSET ${Number(offset)}`,
    params
  );
  return { rows, total };
};

const create = async (d, db) => {
  const r = await query(
    `INSERT INTO professionals
       (user_id, service_id, bio, experience_years, starting_price, service_area, city, pincode, profile_image)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [d.user_id, d.service_id, d.bio, d.experience_years || 0, d.starting_price || 0, d.service_area, d.city, d.pincode, d.profile_image],
    db
  );
  return r.insertId;
};

// Rating, total_reviews, completed_jobs and verification_status are deliberately NOT updatable here
const PROFILE_FIELDS = ['bio', 'experience_years', 'starting_price', 'service_area', 'city', 'pincode', 'availability_status', 'profile_image'];

const updateProfile = async (id, data, db) => {
  const upd = buildUpdate(PROFILE_FIELDS, data);
  if (!upd) return;
  await query(`UPDATE professionals SET ${upd.sets} WHERE id = ?`, [...upd.values, id], db);
};

/** Candidates for "any available professional" bookings, best match first. */
const findAvailableCandidates = async ({ serviceId, city, pincode }) => {
  const where = [PUBLIC_WHERE, 'p.service_id = ?', "p.availability_status = 'available'"];
  const params = [serviceId];
  if (city) {
    where.push('p.city = ?');
    params.push(city);
  }
  params.push(pincode || ''); // used by ORDER BY (same pincode first)
  return query(
    `SELECT p.id FROM professionals p
     JOIN users u ON u.id = p.user_id JOIN services s ON s.id = p.service_id
     WHERE ${where.join(' AND ')}
     ORDER BY (p.pincode = ?) DESC, p.rating DESC, p.completed_jobs DESC, p.id ASC LIMIT 10`,
    params
  );
};

const adminList = async ({ status, search, limit, offset }) => {
  const where = [];
  const params = [];
  if (status === 'suspended') where.push('u.is_active = 0');
  else if (status) { where.push('p.verification_status = ?'); params.push(status); }
  if (search) {
    const like = `%${escapeLike(search)}%`;
    where.push('(u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)');
    params.push(like, like, like);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [{ total }] = await query(
    `SELECT COUNT(*) AS total FROM professionals p JOIN users u ON u.id = p.user_id JOIN services s ON s.id = p.service_id ${clause}`,
    params
  );
  const rows = await query(`${SELECT} ${clause} ORDER BY p.id DESC LIMIT ${Number(limit)} OFFSET ${Number(offset)}`, params);
  return { rows, total };
};

const setVerification = async (id, status, userId, db) => {
  await query('UPDATE professionals SET verification_status = ? WHERE id = ?', [status, id], db);
  await query('UPDATE users SET is_verified = ? WHERE id = ?', [status === 'approved' ? 1 : 0, userId], db);
};

const setSuspended = async (userId, suspended, db) => {
  await query('UPDATE users SET is_active = ? WHERE id = ?', [suspended ? 0 : 1, userId], db);
  if (suspended) await query("UPDATE professionals SET availability_status = 'offline' WHERE user_id = ?", [userId], db);
};

const incrementCompletedJobs = async (id, db) =>
  query('UPDATE professionals SET completed_jobs = completed_jobs + 1 WHERE id = ?', [id], db);

module.exports = {
  findById, findByUserId, findPublicById, searchPublic, create, updateProfile,
  findAvailableCandidates, adminList, setVerification, setSuspended, incrementCompletedJobs,
};
