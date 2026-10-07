'use strict';

const bcrypt = require('bcryptjs');
const config = require('../config');

const hashPassword = (plain) => bcrypt.hash(plain, config.bcryptRounds);

const comparePassword = (plain, hash) => bcrypt.compare(plain, hash);

// Burns the same CPU as a real comparison. Called when the email is unknown so
// that login timing cannot be used to enumerate accounts.
const DUMMY_HASH = '$2a$10$CwTycUXWue0Thq9StjUM0uJ8.0PbgfgJNrGU/gNDG3cQ0jBsqHYQi';
const fakeCompare = () => bcrypt.compare('password-that-never-matches', DUMMY_HASH);

module.exports = { hashPassword, comparePassword, fakeCompare };
