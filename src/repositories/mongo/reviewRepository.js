'use strict';

const { collection } = require('../../db/mongo');

const reviews = () => collection('reviews');

// Reviews are visible only once their booking has completed. Bookings live in
// MySQL, so the caller passes the completed ids across the seam.
const visibilityFilter = (artistId, completedBookingIds) => ({
  artist_id: Number(artistId),
  booking_id: { $in: completedBookingIds },
});

const findPage = async (artistId, completedBookingIds, { skip, limit }) => {
  if (completedBookingIds.length === 0) return [];
  return reviews()
    .find(visibilityFilter(artistId, completedBookingIds))
    .sort({ created_at: -1, _id: -1 })
    .skip(skip)
    .limit(limit)
    .toArray();
};

// Average, total and the 1..5 histogram in one round trip, computed server-side.
const summarise = async (artistId, completedBookingIds) => {
  const empty = { total: 0, sum: 0, distribution: {} };
  if (completedBookingIds.length === 0) return empty;

  const [result] = await reviews()
    .aggregate([
      { $match: visibilityFilter(artistId, completedBookingIds) },
      { $group: { _id: '$score', count: { $sum: 1 } } },
      {
        $group: {
          _id: null,
          total: { $sum: '$count' },
          sum: { $sum: { $multiply: ['$_id', '$count'] } },
          buckets: { $push: { score: '$_id', count: '$count' } },
        },
      },
    ])
    .toArray();

  if (!result) return empty;

  const distribution = {};
  for (const bucket of result.buckets) distribution[bucket.score] = bucket.count;
  return { total: result.total, sum: result.sum, distribution };
};

module.exports = { findPage, summarise };
