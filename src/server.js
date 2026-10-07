'use strict';

const config = require('./config');
const createApp = require('./app');
const { connectAll, closeAll } = require('./db');

const start = async () => {
  await connectAll();

  const server = createApp().listen(config.port, () => {
    console.log(`API listening on http://localhost:${config.port}`);
  });

  const shutdown = () => {
    server.close(async () => {
      await closeAll();
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
};

start().catch((err) => {
  console.error('Failed to start the server:', err.message);
  process.exit(1);
});
