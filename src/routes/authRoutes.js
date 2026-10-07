'use strict';

const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { ok } = require('../utils/respond');
const authService = require('../services/authService');

const router = express.Router();

router.post(
  '/login',
  asyncHandler(async (req, res) => ok(res, await authService.login(req.body || {})))
);

module.exports = router;
