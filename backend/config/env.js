'use strict';
require('dotenv').config({ quiet: true });

const num = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const bool = (value) => String(value).toLowerCase() === 'true';

const env = process.env.NODE_ENV || 'development';
const isProd = env === 'production';
const timezone = process.env.APP_TIMEZONE || 'Asia/Kolkata';
process.env.TZ = timezone; // dates/times are interpreted in the service area's timezone

const config = {
  env,
  isProd,
  port: num(process.env.PORT, 5000),
  timezone,
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, ''),
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: num(process.env.DB_PORT, 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'home_services',
    connectionLimit: num(process.env.DB_CONNECTION_LIMIT, 10),
  },
  jwt: {
    secret: process.env.JWT_SECRET || '',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },
  bcryptRounds: num(process.env.BCRYPT_ROUNDS, 12),
  cors: {
    origins: (process.env.CORS_ORIGINS || '')
      .split(',')
      .map((o) => o.trim().replace(/\/+$/, ''))
      .filter(Boolean),
    allowFileOrigin: !isProd && bool(process.env.CORS_ALLOW_FILE_ORIGIN),
  },
  trustProxy: num(process.env.TRUST_PROXY, 0),
  rateLimit: {
    max: num(process.env.RATE_LIMIT_MAX, 300),
    authMax: num(process.env.AUTH_RATE_LIMIT_MAX, 20),
  },
  upload: { maxMb: num(process.env.UPLOAD_MAX_MB, 2) },
};

if (!config.jwt.secret) {
  throw new Error('JWT_SECRET is missing. Copy .env.example to .env and set a strong secret.');
}
if (isProd && (config.jwt.secret.length < 32 || config.jwt.secret.includes('change_this'))) {
  throw new Error('JWT_SECRET is too weak for production. Use at least 32 random characters.');
}

module.exports = config;
