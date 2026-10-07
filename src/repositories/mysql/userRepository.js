'use strict';

const { query } = require('../../db/mysql');

// Only the login path needs the hash; everything else selects without it.
const findByEmail = async (email) => {
  const rows = await query(
    'SELECT id, email, password_hash, role, name FROM users WHERE email = ? LIMIT 1',
    [email]
  );
  return rows[0] || null;
};

const findById = async (id) => {
  const rows = await query(
    'SELECT id, email, role, name FROM users WHERE id = ? LIMIT 1',
    [id]
  );
  return rows[0] || null;
};

const artistExists = async (id) => {
  const rows = await query(
    "SELECT 1 FROM users WHERE id = ? AND role = 'artist' LIMIT 1",
    [id]
  );
  return rows.length > 0;
};

module.exports = { findByEmail, findById, artistExists };
