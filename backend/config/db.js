'use strict';
const mysql = require('mysql2/promise');
const config = require('./env');

const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  waitForConnections: true,
  connectionLimit: config.db.connectionLimit,
  queueLimit: 0,
  charset: 'utf8mb4',
  dateStrings: true, // DATE/TIMESTAMP come back as strings -> no timezone surprises
  decimalNumbers: true, // DECIMAL columns come back as numbers
});

/**
 * Run a parameterized query (server-side prepared statement).
 * `db` can be the pool (default) or a transaction connection.
 */
async function query(sql, params = [], db = pool) {
  const safe = params.map((v) => (v === undefined ? null : v));
  const [rows] = await db.execute(sql, safe);
  return rows;
}

/** Run `fn(conn)` inside a transaction; commits on success, rolls back on error. */
async function withTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    try {
      await conn.rollback();
    } catch (_) {
      /* connection already gone */
    }
    throw err;
  } finally {
    conn.release();
  }
}

async function testConnection() {
  const conn = await pool.getConnection();
  try {
    await conn.ping();
  } finally {
    conn.release();
  }
}

module.exports = { pool, query, withTransaction, testConnection };
