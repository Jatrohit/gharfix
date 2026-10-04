'use strict';
const { query } = require('../config/db');
const { escapeLike } = require('../utils/helpers');

const SELECT = `
  SELECT b.*,
         s.name AS service_name, s.slug AS service_slug, s.icon AS service_icon,
         pu.name AS professional_name, pu.phone AS professional_phone,
         p.profile_image AS professional_image, p.user_id AS professional_user_id,
         cu.name AS customer_name, cu.phone AS customer_phone,
         r.id AS review_id
  FROM bookings b
  JOIN services s ON s.id = b.service_id
  JOIN professionals p ON p.id = b.professional_id
  JOIN users pu ON pu.id = p.user_id
  JOIN users cu ON cu.id = b.customer_id
  LEFT JOIN reviews r ON r.booking_id = b.id`;

const findById = async (id, db) => (await query(`${SELECT} WHERE b.id = ?`, [id], db))[0] || null;

const create = async (d, db) => {
  const r = await query(
    `INSERT INTO bookings
       (customer_id, professional_id, service_id, address, locality, city, pincode,
        preferred_date, preferred_time, problem_description, estimated_price,
        customer_notes, contact_phone, booking_source, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    [
      d.customer_id, d.professional_id, d.service_id, d.address, d.locality, d.city, d.pincode,
      d.preferred_date, d.preferred_time, d.problem_description, d.estimated_price,
      d.customer_notes, d.contact_phone, d.booking_source || 'web',
    ],
    db
  );
  return r.insertId;
};

/**
 * Atomic status change: only succeeds if the booking is still in one of `fromStatuses`.
 * Returns true when a row was changed (protects against double-clicks and races).
 */
const transition = async (id, fromStatuses, toStatus, extra = {}, db) => {
  const sets = ['status = ?'];
  const params = [toStatus];
  if (extra.final_price !== undefined && extra.final_price !== null) {
    sets.push('final_price = ?');
    params.push(extra.final_price);
  }
  const marks = fromStatuses.map(() => '?').join(', ');
  const result = await query(
    `UPDATE bookings SET ${sets.join(', ')} WHERE id = ? AND status IN (${marks})`,
    [...params, id, ...fromStatuses],
    db
  );
  return result.affectedRows === 1;
};

const setFinalPrice = async (id, price, allowedStatuses, db) => {
  const marks = allowedStatuses.map(() => '?').join(', ');
  const r = await query(
    `UPDATE bookings SET final_price = ? WHERE id = ? AND status IN (${marks})`,
    [price, id, ...allowedStatuses],
    db
  );
  return r.affectedRows === 1;
};

/** Is the professional already committed for this exact slot (or did this customer already request it)? */
const hasSlotConflict = async ({ professionalId, customerId, date, time }) => {
  const rows = await query(
    `SELECT id FROM bookings
     WHERE professional_id = ? AND preferred_date = ? AND preferred_time = ?
       AND (status IN ('accepted', 'confirmed', 'in_progress') OR (status = 'pending' AND customer_id = ?))
     LIMIT 1`,
    [professionalId, date, time, customerId]
  );
  return rows.length > 0;
};

const listPage = async ({ whereSql, params, limit, offset }) => {
  const [{ total }] = await query(
    `SELECT COUNT(*) AS total FROM bookings b JOIN users cu ON cu.id = b.customer_id
     JOIN professionals p ON p.id = b.professional_id JOIN users pu ON pu.id = p.user_id ${whereSql}`,
    params
  );
  const rows = await query(
    `${SELECT} ${whereSql} ORDER BY b.created_at DESC, b.id DESC LIMIT ${Number(limit)} OFFSET ${Number(offset)}`,
    params
  );
  return { rows, total };
};

const listForCustomer = (customerId, { status, limit, offset }) => {
  const where = ['b.customer_id = ?'];
  const params = [customerId];
  if (status) { where.push('b.status = ?'); params.push(status); }
  return listPage({ whereSql: `WHERE ${where.join(' AND ')}`, params, limit, offset });
};

const listForProfessional = (professionalId, { status, limit, offset }) => {
  const where = ['b.professional_id = ?'];
  const params = [professionalId];
  if (status) { where.push('b.status = ?'); params.push(status); }
  return listPage({ whereSql: `WHERE ${where.join(' AND ')}`, params, limit, offset });
};

const listAll = ({ status, search, limit, offset }) => {
  const where = [];
  const params = [];
  if (status) { where.push('b.status = ?'); params.push(status); }
  if (search) {
    const like = `%${escapeLike(search)}%`;
    where.push('(cu.name LIKE ? OR pu.name LIKE ? OR b.pincode = ?)');
    params.push(like, like, search);
  }
  return listPage({ whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '', params, limit, offset });
};

const dashboardCounts = async () =>
  (
    await query(`SELECT
      COUNT(*) AS total_bookings,
      COALESCE(SUM(status = 'completed'), 0) AS completed_bookings,
      COALESCE(SUM(status = 'cancelled'), 0) AS cancelled_bookings,
      COALESCE(SUM(status = 'pending'), 0) AS pending_bookings
      FROM bookings`)
  )[0];

module.exports = {
  findById, create, transition, setFinalPrice, hasSlotConflict,
  listForCustomer, listForProfessional, listAll, dashboardCounts,
};
