'use strict';

const repos = require('../repositories');
const ApiError = require('../utils/ApiError');
const {
  ALL_STATUSES,
  assertTransitionAllowed,
  assertRoleMayTransition,
} = require('../domain/bookingStatus');
const { parseIsoDate, toMysqlDateTime, toIso } = require('../utils/datetime');

const MAX_NOTES_LENGTH = 2000;

const present = (booking) => ({
  id: booking.id,
  artist_id: booking.artist_id,
  client_id: booking.client_id,
  status: booking.status,
  event_start: toIso(booking.event_start),
  event_end: toIso(booking.event_end),
  notes: booking.notes,
  created_at: toIso(booking.created_at),
  updated_at: toIso(booking.updated_at),
});

const parseCreatePayload = (body = {}) => {
  const errors = {};

  const artistId = Number(body.artist_id);
  if (!Number.isInteger(artistId) || artistId <= 0) {
    errors.artist_id = 'artist_id is required and must be a positive integer';
  }

  const eventStart = parseIsoDate(body.event_start);
  if (!eventStart) errors.event_start = 'event_start is required and must be an ISO-8601 datetime';

  const eventEnd = parseIsoDate(body.event_end);
  if (!eventEnd) errors.event_end = 'event_end is required and must be an ISO-8601 datetime';

  const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
  if (!notes) errors.notes = 'notes is required';
  else if (notes.length > MAX_NOTES_LENGTH) {
    errors.notes = `notes must be at most ${MAX_NOTES_LENGTH} characters`;
  }

  if (eventStart && eventEnd && eventEnd <= eventStart) {
    errors.event_end = 'event_end must be after event_start';
  }
  if (eventStart && eventStart.getTime() <= Date.now()) {
    errors.event_start = 'event_start must be in the future';
  }

  const problems = Object.values(errors);
  if (problems.length > 0) {
    throw ApiError.badRequest(`Validation failed: ${problems.join('; ')}`);
  }

  return { artistId, eventStart, eventEnd, notes };
};

const create = async ({ actor, body }) => {
  const { artistId, eventStart, eventEnd, notes } = parseCreatePayload(body);

  if (!(await repos.users.artistExists(artistId))) {
    throw ApiError.notFound(`No artist found with id ${artistId}`);
  }

  const { booking, conflict } = await repos.bookings.createPending({
    artistId,
    clientId: actor.id,
    eventStart: toMysqlDateTime(eventStart),
    eventEnd: toMysqlDateTime(eventEnd),
    notes,
  });

  if (conflict) {
    throw ApiError.conflict(
      'The artist already has a confirmed booking that overlaps this time window'
    );
  }

  return present(booking);
};

// Checks run in the order that leaks the least: existence and ownership first,
// then whether the transition exists at all (422), then whether this role may
// perform it (403).
const updateStatus = async ({ actor, bookingId, nextStatus }) => {
  if (!ALL_STATUSES.includes(nextStatus)) {
    throw ApiError.badRequest(`"status" must be one of: ${ALL_STATUSES.join(', ')}`);
  }

  const booking = await repos.bookings.findById(bookingId);
  if (!booking) throw ApiError.notFound(`No booking found with id ${bookingId}`);

  const isAssignedArtist = actor.role === 'artist' && booking.artist_id === actor.id;
  const isOwningClient = actor.role === 'client' && booking.client_id === actor.id;

  // 404 rather than 403: a party to neither side should not learn the id exists.
  if (!isAssignedArtist && !isOwningClient) {
    throw ApiError.notFound(`No booking found with id ${bookingId}`);
  }

  const from = booking.status;
  assertTransitionAllowed(from, nextStatus);
  assertRoleMayTransition(actor.role, from, nextStatus);

  const applied = await repos.bookings.updateStatus(booking.id, from, nextStatus);
  if (!applied) {
    throw ApiError.conflict('The booking was updated by someone else. Re-read it and retry.');
  }

  return present({ ...booking, status: nextStatus, updated_at: new Date() });
};

module.exports = { create, updateStatus };
