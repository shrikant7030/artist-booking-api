'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');

const signAccessToken = (user) =>
  jwt.sign(
    { sub: String(user.id), role: user.role, iat: Math.floor(Date.now() / 1000) },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );

const verifyAccessToken = (token) => jwt.verify(token, config.jwt.secret);

module.exports = { signAccessToken, verifyAccessToken };
