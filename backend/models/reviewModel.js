'use strict';
const { query } = require('../config/db');

const SELECT = `
  SELECT r.id, r.booking_id, r.professional_id, r.rating, r.review, r.created_at,
         CONCAT(SUBSTRING_INDEX(u.name, ' ', 1),
                IF(LOCATE(' ', u.name) > 0, CONCAT(' ', LEFT(SUBSTRING_INDEX(u.name, ' ', -1), 1), '.'), '')) AS customer_name
  FROM reviews r JOIN users u ON u.id = r.customer_id`;

const create = async (d, db) => {
  const r = await query(
    'INSERT INTO reviews (booking_id, customer_id, professional_id, rating, review) VALUES (?, ?, ?, ?, ?)',
    [d.booking_id, d.customer_id, d.professional_id, d.rating, d.review || null],
    db
  );
  return r.insertId;
};

/** Rating is always computed from the reviews table - never taken from the client. */
const recalcProfessionalStats = async (professionalId, db) =>
  query(
    `UPDATE professionals p SET
       p.rating = COALESCE((SELECT ROUND(AVG(r.rating), 1) FROM reviews r WHERE r.professional_id = p.id), 0),
       p.total_reviews = (SELECT COUNT(*) FROM reviews r WHERE r.professional_id = p.id)
     WHERE p.id = ?`,
    [professionalId],
    db
  );

const findById = async (id, db) => (await query(`${SELECT} WHERE r.id = ?`, [id], db))[0] || null;

const listByProfessional = async (professionalId, { limit, offset }) => {
  const [{ total }] = await query('SELECT COUNT(*) AS total FROM reviews WHERE professional_id = ?', [professionalId]);
  const rows = await query(
    `${SELECT} WHERE r.professional_id = ? ORDER BY r.created_at DESC, r.id DESC LIMIT ${Number(limit)} OFFSET ${Number(offset)}`,
    [professionalId]
  );
  return { rows, total };
};

const listAll = async ({ limit, offset }) => {
  const [{ total }] = await query('SELECT COUNT(*) AS total FROM reviews');
  const rows = await query(
    `${SELECT} ORDER BY r.created_at DESC, r.id DESC LIMIT ${Number(limit)} OFFSET ${Number(offset)}`
  );
  return { rows, total };
};

const remove = async (id, db) => query('DELETE FROM reviews WHERE id = ?', [id], db);

module.exports = { create, recalcProfessionalStats, findById, listByProfessional, listAll, remove };
