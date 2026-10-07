'use strict';

const repos = require('../repositories');
const ApiError = require('../utils/ApiError');
const { toIso } = require('../utils/datetime');

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const parsePagination = (query = {}) => {
  const errors = {};

  const page = query.page === undefined ? 1 : Number(query.page);
  if (!Number.isInteger(page) || page < 1) errors.page = 'page must be an integer >= 1';

  const limit = query.limit === undefined ? DEFAULT_LIMIT : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    errors.limit = `limit must be an integer between 1 and ${MAX_LIMIT}`;
  }

  const problems = Object.values(errors);
  if (problems.length > 0) {
    throw ApiError.badRequest(`Validation failed: ${problems.join('; ')}`);
  }
  return { page, limit };
};

const present = (review) => ({
  booking_id: review.booking_id,
  client_id: review.client_id ?? null,
  score: review.score,
  comment: review.comment ?? null,
  created_at: toIso(review.created_at),
});

// Every bucket is present even when empty, so clients render a fixed histogram.
const buildDistribution = (counts) => {
  const distribution = {};
  for (let score = 1; score <= 5; score += 1) distribution[score] = counts[score] || 0;
  return distribution;
};

const listForArtist = async (artistId, query) => {
  const id = Number(artistId);
  if (!Number.isInteger(id) || id <= 0) {
    throw ApiError.badRequest('Artist id must be a positive integer');
  }
  if (!(await repos.users.artistExists(id))) {
    throw ApiError.notFound(`No artist found with id ${id}`);
  }

  const { page, limit } = parsePagination(query);

  const completedBookingIds = await repos.bookings.findCompletedIdsByArtist(id);

  const [rows, totals] = await Promise.all([
    repos.reviews.findPage(id, completedBookingIds, { skip: (page - 1) * limit, limit }),
    repos.reviews.summarise(id, completedBookingIds),
  ]);

  const average = totals.total === 0 ? 0 : totals.sum / totals.total;

  return {
    artist_id: id,
    reviews: rows.map(present),
    summary: {
      average_score: Number(average.toFixed(2)),
      total_reviews: totals.total,
      score_distribution: buildDistribution(totals.distribution),
    },
    pagination: {
      page,
      limit,
      total: totals.total,
      total_pages: Math.ceil(totals.total / limit),
      has_next: page * limit < totals.total,
    },
  };
};

module.exports = { listForArtist };
