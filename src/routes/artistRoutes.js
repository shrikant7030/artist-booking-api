'use strict';

const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { ok } = require('../utils/respond');
const reviewService = require('../services/reviewService');

const router = express.Router();

router.get(
  '/:id/reviews',
  asyncHandler(async (req, res) =>
    ok(res, await reviewService.listForArtist(req.params.id, req.query))
  )
);

module.exports = router;
