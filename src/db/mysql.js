'use strict';

const mysql = require('mysql2/promise');
const config = require('../config');

let pool = null;

const getPool = () => {
  if (!pool) {
    pool = mysql.createPool({
      host: config.mysql.host,
      port: config.mysql.port,
      user: config.mysql.user,
      password: config.mysql.password,
      database: config.mysql.database,
      waitForConnections: true,
      connectionLimit: config.mysql.connectionLimit,
      queueLimit: 0,
      dateStrings: true,
      timezone: 'Z',
      namedPlaceholders: true,
    });
  }
  return pool;
};

const query = async (sql, params) => {
  const [rows] = await getPool().execute(sql, params);
  return rows;
};

const getConnection = () => getPool().getConnection();

const withTransaction = async (fn) => {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const result = await fn(connection);
    await connection.commit();
    return result;
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
};

const connect = async () => {
  const connection = await getPool().getConnection();
  connection.release();
};

const close = async () => {
  if (pool) {
    await pool.end();
    pool = null;
  }
};

module.exports = { query, getConnection, withTransaction, connect, close };
