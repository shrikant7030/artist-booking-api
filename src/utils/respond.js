'use strict';

const ok = (res, data, status = 200) =>
  res.status(status).json({ success: true, data: data ?? {}, error: null });

const fail = (res, status, message) =>
  res.status(status).json({ success: false, data: null, error: message });

module.exports = { ok, fail };
