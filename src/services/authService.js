'use strict';

const repos = require('../repositories');
const ApiError = require('../utils/ApiError');
const { comparePassword, fakeCompare } = require('../utils/passwords');
const { signAccessToken } = require('../utils/tokens');

const INVALID = 'Invalid email or password';

const login = async ({ email, password }) => {
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    throw ApiError.badRequest('Both "email" and "password" are required');
  }

  const user = await repos.users.findByEmail(email.trim().toLowerCase());

  // Same error and the same cost whether the email is unknown or the password
  // is wrong, so the endpoint cannot be used to enumerate accounts.
  if (!user) {
    await fakeCompare();
    throw ApiError.unauthorized(INVALID);
  }

  if (!(await comparePassword(password, user.password_hash))) {
    throw ApiError.unauthorized(INVALID);
  }

  return {
    token: signAccessToken(user),
    user: { id: user.id, email: user.email, role: user.role, name: user.name },
  };
};

module.exports = { login };
