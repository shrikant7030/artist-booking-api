'use strict';

const express = require('express');

const authRoutes = require('./routes/authRoutes');
const bookingRoutes = require('./routes/bookingRoutes');
const artistRoutes = require('./routes/artistRoutes');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

const createApp = () => {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  app.use('/auth', authRoutes);
  app.use('/bookings', bookingRoutes);
  app.use('/artists', artistRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};

module.exports = createApp;
