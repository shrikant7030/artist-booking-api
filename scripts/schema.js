'use strict';

// Applies sql/schema.sql using the node driver, so the mysql CLI does not need
// to be on PATH (it usually is not on a default Windows install).

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const config = require('../src/config');

const run = async () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', 'schema.sql'), 'utf8');

  const connection = await mysql.createConnection({
    host: config.mysql.host,
    port: config.mysql.port,
    user: config.mysql.user,
    password: config.mysql.password,
    multipleStatements: true,
  });

  await connection.query(sql);
  await connection.end();

  console.log(`Schema applied to "${config.mysql.database}".`);
};

run().catch((err) => {
  console.error('Could not apply the schema:', err.sqlMessage || err.message);
  process.exit(1);
});
