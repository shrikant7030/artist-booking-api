'use strict';

const ApiError = require('../utils/ApiError');

const STATUS = Object.freeze({
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
});

const ALL_STATUSES = Object.freeze(Object.values(STATUS));

/**
 *   pending     --> confirmed     (artist approves the request)
 *   confirmed   --> in_progress   (event has started)
 *   in_progress --> completed     (event is done)
 *   pending     --> cancelled     (either party, before confirmation)
 *   confirmed   --> cancelled     (either party, after confirmation)
 *
 * `completed` and `cancelled` are terminal. Anything else is a 422.
 */
const TRANSITIONS = Object.freeze({
  [STATUS.PENDING]: Object.freeze([STATUS.CONFIRMED, STATUS.CANCELLED]),
  [STATUS.CONFIRMED]: Object.freeze([STATUS.IN_PROGRESS, STATUS.CANCELLED]),
  [STATUS.IN_PROGRESS]: Object.freeze([STATUS.COMPLETED]),
  [STATUS.COMPLETED]: Object.freeze([]),
  [STATUS.CANCELLED]: Object.freeze([]),
});

const ALLOWED_ROLES = Object.freeze({
  [`${STATUS.PENDING}->${STATUS.CONFIRMED}`]: Object.freeze(['artist']),
  [`${STATUS.CONFIRMED}->${STATUS.IN_PROGRESS}`]: Object.freeze(['artist']),
  [`${STATUS.IN_PROGRESS}->${STATUS.COMPLETED}`]: Object.freeze(['artist']),
  [`${STATUS.PENDING}->${STATUS.CANCELLED}`]: Object.freeze(['artist', 'client']),
  [`${STATUS.CONFIRMED}->${STATUS.CANCELLED}`]: Object.freeze(['artist', 'client']),
});

const isTerminal = (status) => TRANSITIONS[status]?.length === 0;

const assertTransitionAllowed = (from, to) => {
  const allowed = TRANSITIONS[from];
  if (!allowed) {
    throw ApiError.unprocessable(`Booking is in an unrecognised status "${from}"`);
  }
  if (allowed.includes(to)) return;

  const reason = isTerminal(from)
    ? `Booking is already ${from}; it is a final status and cannot change.`
    : `Allowed transitions from "${from}": ${allowed.join(', ')}.`;

  throw ApiError.unprocessable(`Invalid status transition: "${from}" -> "${to}". ${reason}`);
};

const assertRoleMayTransition = (role, from, to) => {
  const roles = ALLOWED_ROLES[`${from}->${to}`] || [];
  if (roles.includes(role)) return;
  throw ApiError.forbidden(
    `A ${role} cannot move a booking from "${from}" to "${to}". ` +
      `That transition is reserved for: ${roles.join(', ') || 'nobody'}.`
  );
};

module.exports = { ALL_STATUSES, assertTransitionAllowed, assertRoleMayTransition };
