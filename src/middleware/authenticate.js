'use strict';

const ApiError = require('../utils/ApiError');
const { verifyAccessToken } = require('../utils/tokens');

const authenticate = (req, _res, next) => {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');

  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return next(ApiError.unauthorized('Missing or malformed Authorization header'));
  }

  try {
    const payload = verifyAccessToken(token);
    req.user = { id: Number(payload.sub), role: payload.role };
    return next();
  } catch (err) {
    const message =
      err.name === 'TokenExpiredError' ? 'Access token has expired' : 'Invalid access token';
    return next(ApiError.unauthorized(message));
  }
};

const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user) return next(ApiError.unauthorized('Authentication required'));
  if (!roles.includes(req.user.role)) {
    return next(ApiError.forbidden(`This endpoint is restricted to: ${roles.join(', ')}`));
  }
  return next();
};

module.exports = { authenticate, requireRole };
