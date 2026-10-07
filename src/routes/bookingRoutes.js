'use strict';

const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { ok } = require('../utils/respond');
const { authenticate, requireRole } = require('../middleware/authenticate');
const bookingService = require('../services/bookingService');

const router = express.Router();

router.use(authenticate);

router.post(
  '/',
  requireRole('client'),
  asyncHandler(async (req, res) => {
    const booking = await bookingService.create({ actor: req.user, body: req.body || {} });
    return ok(res, { booking }, 201);
  })
);

router.patch(
  '/:id/status',
  requireRole('artist', 'client'),
  asyncHandler(async (req, res) => {
    const booking = await bookingService.updateStatus({
      actor: req.user,
      bookingId: req.params.id,
      nextStatus: (req.body || {}).status,
    });
    return ok(res, { booking });
  })
);

module.exports = router;
