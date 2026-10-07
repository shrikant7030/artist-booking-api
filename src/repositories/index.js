'use strict';

module.exports = {
  users: require('./mysql/userRepository'),
  bookings: require('./mysql/bookingRepository'),
  reviews: require('./mongo/reviewRepository'),
};
