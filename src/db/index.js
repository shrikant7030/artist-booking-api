'use strict';

const mysql = require('./mysql');
const mongo = require('./mongo');

const connectAll = async () => {
  await mysql.connect();
  await mongo.connect();
};

const closeAll = async () => {
  await Promise.allSettled([mysql.close(), mongo.close()]);
};

module.exports = { connectAll, closeAll };
