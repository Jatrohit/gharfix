'use strict';
const { query } = require('../config/db');
const { buildUpdate, slugify } = require('../utils/helpers');

const COLS = 'id, name, slug, description, icon, starting_price, is_active, created_at';

const findAll = async ({ includeInactive = false } = {}) =>
  query(`SELECT ${COLS} FROM services ${includeInactive ? '' : 'WHERE is_active = 1'} ORDER BY id ASC`);

const findById = async (id) => (await query(`SELECT ${COLS} FROM services WHERE id = ?`, [id]))[0] || null;
const findBySlug = async (slug) => (await query(`SELECT ${COLS} FROM services WHERE slug = ?`, [slug]))[0] || null;

/** Accepts a numeric id, a slug ("ac-repair") or a display name ("AC Repair"). */
const findByIdentifier = async (value) => {
  const text = String(value).trim();
  if (/^\d+$/.test(text)) {
    const byId = await findById(Number(text));
    if (byId) return byId;
  }
  const rows = await query(`SELECT ${COLS} FROM services WHERE slug = ? OR name = ? LIMIT 1`, [slugify(text), text]);
  return rows[0] || null;
};

const create = async (d) => {
  const r = await query(
    'INSERT INTO services (name, slug, description, icon, starting_price, is_active) VALUES (?, ?, ?, ?, ?, ?)',
    [d.name, d.slug, d.description || null, d.icon || null, d.starting_price, d.is_active === false ? 0 : 1]
  );
  return r.insertId;
};

const update = async (id, data) => {
  const upd = buildUpdate(['name', 'slug', 'description', 'icon', 'starting_price', 'is_active'], data);
  if (!upd) return;
  await query(`UPDATE services SET ${upd.sets} WHERE id = ?`, [...upd.values, id]);
};

const isInUse = async (id) => {
  const [a] = await query('SELECT COUNT(*) AS n FROM professionals WHERE service_id = ?', [id]);
  const [b] = await query('SELECT COUNT(*) AS n FROM bookings WHERE service_id = ?', [id]);
  return a.n + b.n > 0;
};

const remove = async (id) => query('DELETE FROM services WHERE id = ?', [id]);

const count = async () => (await query('SELECT COUNT(*) AS n FROM services'))[0].n;

module.exports = { findAll, findById, findBySlug, findByIdentifier, create, update, isInUse, remove, count };
