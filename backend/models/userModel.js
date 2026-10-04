'use strict';
const { query } = require('../config/db');
const { buildUpdate, escapeLike } = require('../utils/helpers');

const COLS =
  'id, name, email, phone, role, address, locality, city, pincode, profile_image, is_verified, is_active, created_at, updated_at';

const UPDATABLE = ['name', 'phone', 'address', 'locality', 'city', 'pincode', 'profile_image'];

const findById = async (id, db) => (await query(`SELECT ${COLS} FROM users WHERE id = ?`, [id], db))[0] || null;
const findByEmail = async (email, db) => (await query('SELECT id FROM users WHERE email = ?', [email], db))[0] || null;
const findByPhone = async (phone, db) => (await query('SELECT id FROM users WHERE phone = ?', [phone], db))[0] || null;

/** Includes the password hash - only for login. */
const findForLogin = async ({ email, phone }) => {
  if (email) return (await query('SELECT * FROM users WHERE email = ?', [String(email).toLowerCase()]))[0] || null;
  return (await query('SELECT * FROM users WHERE phone = ?', [phone]))[0] || null;
};

const create = async (data, db) => {
  const result = await query(
    `INSERT INTO users (name, email, phone, password, role, address, locality, city, pincode, profile_image)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [data.name, data.email, data.phone, data.password, data.role, data.address, data.locality, data.city, data.pincode, data.profile_image],
    db
  );
  return result.insertId;
};

const update = async (id, data, db) => {
  const upd = buildUpdate(UPDATABLE, data);
  if (!upd) return;
  await query(`UPDATE users SET ${upd.sets} WHERE id = ?`, [...upd.values, id], db);
};

/** Another user (not `exceptId`) already owns this phone number? */
const phoneTakenByOther = async (phone, exceptId) =>
  (await query('SELECT id FROM users WHERE phone = ? AND id <> ?', [phone, exceptId]))[0] || null;

const list = async ({ role, search, limit, offset }) => {
  const where = [];
  const params = [];
  if (role) { where.push('role = ?'); params.push(role); }
  if (search) {
    where.push('(name LIKE ? OR email LIKE ? OR phone LIKE ?)');
    const like = `%${escapeLike(search)}%`;
    params.push(like, like, like);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM users ${clause}`, params);
  const rows = await query(
    `SELECT ${COLS} FROM users ${clause} ORDER BY id DESC LIMIT ${Number(limit)} OFFSET ${Number(offset)}`,
    params
  );
  return { rows, total };
};

module.exports = { findById, findByEmail, findByPhone, findForLogin, create, update, phoneTakenByOther, list };
