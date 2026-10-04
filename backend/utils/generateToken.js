'use strict';
const jwt = require('jsonwebtoken');
const config = require('../config/env');

/** JWT payload carries only the user id and role. */
const generateToken = (user) =>
  jwt.sign({ id: user.id, role: user.role }, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
    issuer: 'gharfix',
  });

const verifyToken = (token) => jwt.verify(token, config.jwt.secret, { issuer: 'gharfix' });

module.exports = { generateToken, verifyToken };
