'use strict';

/**
 * Seeds both stores with a small, coherent dataset:
 *   MySQL   - users, artists, bookings, payments, reviews (the projection)
 *   MongoDB - artist_profiles, reviews (the document source of truth)
 *
 * Run `npm run seed` after applying sql/schema.sql. Safe to re-run: it clears
 * the tables and collections first.
 *
 * The demo password below is a local fixture, not a secret. No real credential is
 * committed anywhere in this repository.
 */

const mysql = require('../src/db/mysql');
const mongo = require('../src/db/mongo');
const { hashPassword } = require('../src/utils/passwords');
const { toMysqlDateTime } = require('../src/utils/datetime');

const DEMO_PASSWORD = 'Password123!';

const daysAgo = (days) => new Date(Date.now() - days * 86400000);
const daysAhead = (days) => new Date(Date.now() + days * 86400000);
const plusHours = (date, hours) => new Date(date.getTime() + hours * 3600000);

const ARTISTS = [
  {
    email: 'aria@example.com', name: 'Aria Mehta', category: 'singer', rate: 7500,
    stageName: 'Aria', bio: 'Ghazal and indie-folk vocalist.',
    genres: ['ghazal', 'indie-folk'], cities: ['Mumbai', 'Pune'],
    scores: [5, 5, 4, 5, 5, 4, 5],
  },
  {
    email: 'dev@example.com', name: 'Dev Khanna', category: 'dj', rate: 12000,
    stageName: 'DVK', bio: 'Open-format club DJ.',
    genres: ['house', 'techno'], cities: ['Delhi', 'Goa'],
    scores: [4, 5, 4, 4, 5, 3],
  },
  {
    email: 'maya@example.com', name: 'Maya Iyer', category: 'comedian', rate: 5000,
    stageName: 'Maya I.', bio: 'Observational stand-up, English and Tamil.',
    genres: ['stand-up'], cities: ['Chennai', 'Bengaluru'],
    // Only three reviews: below the 5-review bar in TASK3 Task A.
    scores: [5, 5, 5],
  },
];

const CLIENTS = [
  { email: 'nina@example.com', name: 'Nina Rao' },
  { email: 'omar@example.com', name: 'Omar Shah' },
];

/**
 * TRUNCATE resets AUTO_INCREMENT, which keeps seeded ids stable across re-runs,
 * but it cannot run while the foreign keys point at the table. FOREIGN_KEY_CHECKS
 * is session-scoped, so this holds one connection for the whole sequence rather
 * than borrowing a different pooled connection per statement. The statements also
 * go over the text protocol (`query`, not `execute`): TRUNCATE is not preparable.
 */
const clearMysql = async () => {
  const connection = await mysql.getConnection();
  try {
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const table of ['reviews', 'payments', 'bookings', 'artists', 'users']) {
      await connection.query(`TRUNCATE TABLE ${table}`);
    }
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');
  } finally {
    connection.release();
  }
};

const insertUser = async ({ email, name, role, passwordHash }) => {
  const result = await mysql.query(
    'INSERT INTO users (email, password_hash, role, name) VALUES (?, ?, ?, ?)',
    [email, passwordHash, role, name]
  );
  return result.insertId;
};

const insertBooking = async (booking) => {
  const result = await mysql.query(
    `INSERT INTO bookings
       (artist_id, client_id, status, amount, event_start, event_end, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      booking.artistId,
      booking.clientId,
      booking.status,
      booking.amount,
      toMysqlDateTime(booking.start),
      toMysqlDateTime(booking.end),
      booking.notes,
    ]
  );
  return result.insertId;
};

const run = async () => {
  await mysql.connect();
  await mongo.connect();

  const passwordHash = await hashPassword(DEMO_PASSWORD);

  await clearMysql();
  await mongo.collection('artist_profiles').deleteMany({});
  await mongo.collection('reviews').deleteMany({});

  const clientIds = [];
  for (const client of CLIENTS) {
    clientIds.push(await insertUser({ ...client, role: 'client', passwordHash }));
  }

  const mongoReviews = [];
  const mongoProfiles = [];
  let reviewCount = 0;
  let bookingCount = 0;

  for (const artist of ARTISTS) {
    const artistId = await insertUser({
      email: artist.email, name: artist.name, role: 'artist', passwordHash,
    });

    await mysql.query(
      'INSERT INTO artists (id, name, category, hourly_rate) VALUES (?, ?, ?, ?)',
      [artistId, artist.name, artist.category, artist.rate]
    );

    mongoProfiles.push({
      artist_id: artistId,
      stage_name: artist.stageName,
      category: artist.category,
      bio: artist.bio,
      genres: artist.genres,
      cities: artist.cities,
      hourly_rate: artist.rate,
      updated_at: new Date(),
    });

    // Completed history, each with one review, spread across the 90-day window.
    for (let i = 0; i < artist.scores.length; i += 1) {
      const start = daysAgo(7 + i * 9);
      const clientId = clientIds[i % clientIds.length];
      const bookingId = await insertBooking({
        artistId,
        clientId,
        status: 'completed',
        amount: artist.rate * 3,
        start,
        end: plusHours(start, 3),
        notes: `Past event #${i + 1} for ${artist.name}`,
      });
      bookingCount += 1;

      await mysql.query(
        'INSERT INTO payments (booking_id, amount, currency, status, provider_ref) ' +
          'VALUES (?, ?, ?, ?, ?)',
        [bookingId, artist.rate * 3, 'INR', 'captured', `seed-pay-${bookingId}`]
      );

      const createdAt = plusHours(start, 24);
      await mysql.query(
        'INSERT INTO reviews (booking_id, artist_id, client_id, score, comment, created_at) ' +
          'VALUES (?, ?, ?, ?, ?, ?)',
        [bookingId, artistId, clientId, artist.scores[i], 'Seeded review.',
          toMysqlDateTime(createdAt)]
      );
      mongoReviews.push({
        booking_id: bookingId,
        artist_id: artistId,
        client_id: clientId,
        score: artist.scores[i],
        comment: `Seeded review for ${artist.name} (event #${i + 1}).`,
        created_at: createdAt,
      });
      reviewCount += 1;
    }

    // One confirmed future booking - the slot POST /bookings must not double-book.
    const confirmedStart = daysAhead(10);
    await insertBooking({
      artistId,
      clientId: clientIds[0],
      status: 'confirmed',
      amount: artist.rate * 4,
      start: confirmedStart,
      end: plusHours(confirmedStart, 4),
      notes: 'Confirmed upcoming event',
    });

    // One pending request - the starting point for the status-transition demo.
    const pendingStart = daysAhead(20);
    await insertBooking({
      artistId,
      clientId: clientIds[1 % clientIds.length],
      status: 'pending',
      amount: null,
      start: pendingStart,
      end: plusHours(pendingStart, 3),
      notes: 'Awaiting artist approval',
    });
    bookingCount += 2;

    // A review written against a booking that never completed. It lives in the
    // store but must never surface in GET /artists/:id/reviews.
    const orphanStart = daysAhead(30);
    const cancelledId = await insertBooking({
      artistId,
      clientId: clientIds[0],
      status: 'cancelled',
      amount: null,
      start: orphanStart,
      end: plusHours(orphanStart, 2),
      notes: 'Called off by the client',
    });
    bookingCount += 1;
    mongoReviews.push({
      booking_id: cancelledId,
      artist_id: artistId,
      client_id: clientIds[0],
      score: 1,
      comment: 'Attached to a cancelled booking - must stay hidden.',
      created_at: new Date(),
    });
  }

  await mongo.collection('artist_profiles').insertMany(mongoProfiles);
  await mongo.collection('reviews').insertMany(mongoReviews);
  await mongo.collection('artist_profiles').createIndex({ artist_id: 1 }, { unique: true });
  await mongo.collection('reviews').createIndex({ booking_id: 1 }, { unique: true });
  await mongo.collection('reviews').createIndex({ artist_id: 1, created_at: -1 });

  /* eslint-disable no-console */
  console.log('Seed complete.');
  console.log(`  users    : ${ARTISTS.length + CLIENTS.length}`);
  console.log(`  bookings : ${bookingCount}`);
  console.log(`  reviews  : ${reviewCount} scored (+ ${ARTISTS.length} hidden)`);
  console.log(`\n  Log in with any seeded email and the password: ${DEMO_PASSWORD}`);
  console.log(`  artists : ${ARTISTS.map((a) => a.email).join(', ')}`);
  console.log(`  clients : ${CLIENTS.map((c) => c.email).join(', ')}`);
  /* eslint-enable no-console */
};

run()
  .then(async () => {
    await mysql.close();
    await mongo.close();
    process.exit(0);
  })
  .catch(async (err) => {
    // eslint-disable-next-line no-console
    console.error('Seed failed:', err.message);
    await mysql.close().catch(() => {});
    await mongo.close().catch(() => {});
    process.exit(1);
  });
