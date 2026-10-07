'use strict';

// MySQL DATETIME has no timezone, so everything is stored and read as UTC in
// the canonical 'YYYY-MM-DD HH:MM:SS' form and converted only at the API edge.
const pad = (n) => String(n).padStart(2, '0');

const toMysqlDateTime = (date) =>
  `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
  `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;

const fromMysqlDateTime = (value) => {
  if (value instanceof Date) return value;
  if (typeof value !== 'string') return null;
  const normalised = value.includes('T') ? value : value.replace(' ', 'T');
  const date = new Date(normalised.endsWith('Z') ? normalised : `${normalised}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
};

const parseIsoDate = (value) => {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const toIso = (value) => {
  const date = fromMysqlDateTime(value);
  return date ? date.toISOString() : null;
};

module.exports = { toMysqlDateTime, parseIsoDate, toIso };
