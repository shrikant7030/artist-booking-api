'use strict';

const ApiError = require('../utils/ApiError');
const config = require('../config');
const { fail } = require('../utils/respond');

const notFoundHandler = (req, _res, next) =>
  next(ApiError.notFound(`No route matches ${req.method} ${req.originalUrl}`));

const errorHandler = (err, _req, res, _next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return fail(res, 400, 'Request body is not valid JSON');
  }

  if (err instanceof ApiError) {
    return fail(res, err.status, err.message);
  }

  // Unrecognised: log it in full, tell the client nothing.
  if (!config.isTest) console.error('[unhandled]', err);
  return fail(res, 500, 'Internal server error');
};

module.exports = { notFoundHandler, errorHandler };
