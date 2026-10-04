'use strict';
const config = require('./config/env'); // must be first: loads .env and validates it
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { pool, testConnection } = require('./config/db');
const { notFound, errorHandler } = require('./middleware/errorMiddleware');
const { UPLOAD_ROOT } = require('./middleware/uploadMiddleware');

const app = express();
app.disable('x-powered-by');
if (config.trustProxy) app.set('trust proxy', config.trustProxy);

// ---- Security headers (images must be embeddable from the frontend's origin) ----
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// ---- CORS: explicit allow-list, never "*" ----
app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true); // curl, Postman, server-to-server
      if (origin === 'null') return cb(null, config.cors.allowFileOrigin); // file:// pages (dev only)
      return cb(null, config.cors.origins.includes(origin));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600,
  })
);

// ---- Global rate limit + body parsing ----
app.use(
  '/api',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.rateLimit.max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { success: false, message: 'Too many requests. Please slow down.' },
  })
);
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

// ---- Static uploads (profile images) ----
app.use('/uploads', express.static(UPLOAD_ROOT, { index: false, dotfiles: 'deny', maxAge: '7d' }));

// ---- Health check (also verifies the database) ----
app.get('/api/health', async (req, res) => {
  try {
    await testConnection();
    res.json({ success: true, message: 'GharFix API is running', data: { database: 'connected', time: new Date().toISOString() } });
  } catch (err) {
    res.status(503).json({ success: false, message: 'Database is not reachable' });
  }
});

// ---- Routes ----
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/users', require('./routes/userRoutes'));
app.use('/api/services', require('./routes/serviceRoutes'));
app.use('/api/professionals', require('./routes/professionalRoutes'));
app.use('/api/bookings', require('./routes/bookingRoutes'));
app.use('/api/reviews', require('./routes/reviewRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));

app.use(notFound);
app.use(errorHandler);

async function start() {
  try {
    await testConnection();
    console.log(`MySQL connected (${config.db.host}:${config.db.port}/${config.db.database})`);
  } catch (err) {
    console.error(`Could not connect to MySQL: ${err.code || err.message}`);
    console.error('Check DB_HOST / DB_USER / DB_PASSWORD / DB_NAME in .env and that MySQL is running.');
    process.exit(1);
  }

  const server = app.listen(config.port, () => {
    console.log(`GharFix API running on http://localhost:${config.port} (${config.env})`);
  });

  const shutdown = (signal) => {
    console.log(`${signal} received, shutting down...`);
    server.close(async () => {
      await pool.end().catch(() => {});
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

process.on('unhandledRejection', (reason) => console.error('Unhandled rejection:', reason));

if (require.main === module) start();

module.exports = app;
