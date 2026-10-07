'use strict';

// Carries the HTTP status the client should see. Anything thrown that is not an
// ApiError is treated as an unexpected 500, so internal failures never leak.
class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    Error.captureStackTrace(this, ApiError);
  }

  static badRequest(message) {
    return new ApiError(400, message);
  }

  static unauthorized(message = 'Invalid credentials') {
    return new ApiError(401, message);
  }

  static forbidden(message = 'You are not allowed to perform this action') {
    return new ApiError(403, message);
  }

  static notFound(message = 'Resource not found') {
    return new ApiError(404, message);
  }

  static conflict(message) {
    return new ApiError(409, message);
  }

  static unprocessable(message) {
    return new ApiError(422, message);
  }
}

module.exports = ApiError;
