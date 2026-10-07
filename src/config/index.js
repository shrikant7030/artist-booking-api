'use strict';

require('dotenv').config();

const toInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const env = process.env.NODE_ENV || 'development';

const config = {
  isTest: env === 'test',
  port: toInt(process.env.PORT, 3000),

  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: '1h',
  },

  mysql: {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: toInt(process.env.MYSQL_PORT, 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'artist_booking',
    connectionLimit: 10,
  },

  mongo: {
    uri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017',
    db: process.env.MONGO_DB || 'artist_booking',
  },

  bcryptRounds: 10,
};

if (!config.jwt.secret) {
  throw new Error('JWT_SECRET is not set. Copy .env.example to .env and set a value.');
}

module.exports = config;
