'use strict';

const { MongoClient } = require('mongodb');
const config = require('../config');

let client = null;
let db = null;

const connect = async () => {
  if (db) return db;
  client = new MongoClient(config.mongo.uri, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  db = client.db(config.mongo.db);
  return db;
};

const getDb = () => {
  if (!db) {
    throw new Error('MongoDB is not connected. Call connect() during startup.');
  }
  return db;
};

const collection = (name) => getDb().collection(name);

const close = async () => {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
};

module.exports = { connect, collection, close };
