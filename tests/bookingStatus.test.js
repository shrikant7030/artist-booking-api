'use strict';

const request = require('supertest');
const createApp = require('../src/app');
const { connectAll, closeAll } = require('../src/db');
const { query } = require('../src/db/mysql');
const { hashPassword } = require('../src/utils/passwords');
const { toMysqlDateTime } = require('../src/utils/datetime');

const PASSWORD = 'IntegrationTest123!';
const ARTIST_EMAIL = 'test.artist@integration.local';
const CLIENT_EMAIL = 'test.client@integration.local';

let app;
let artistToken;
let bookingId;

// Removes only this test's rows, so the suite can run against a seeded
// database without disturbing it. Child rows go first for the foreign keys.
const cleanup = async () => {
  const emails = [ARTIST_EMAIL, CLIENT_EMAIL];
  await query(
    `DELETE FROM bookings
      WHERE artist_id IN (SELECT id FROM users WHERE email IN (?, ?))
         OR client_id IN (SELECT id FROM users WHERE email IN (?, ?))`,
    [...emails, ...emails]
  );
  await query('DELETE FROM artists WHERE id IN (SELECT id FROM users WHERE email IN (?, ?))', emails);
  await query('DELETE FROM users WHERE email IN (?, ?)', emails);
};

beforeAll(async () => {
  await connectAll();
  app = createApp();
  await cleanup();

  const passwordHash = await hashPassword(PASSWORD);

  const artist = await query(
    'INSERT INTO users (email, password_hash, role, name) VALUES (?, ?, ?, ?)',
    [ARTIST_EMAIL, passwordHash, 'artist', 'Test Artist']
  );
  await query('INSERT INTO artists (id, name, category, hourly_rate) VALUES (?, ?, ?, ?)', [
    artist.insertId,
    'Test Artist',
    'singer',
    1000,
  ]);

  const client = await query(
    'INSERT INTO users (email, password_hash, role, name) VALUES (?, ?, ?, ?)',
    [CLIENT_EMAIL, passwordHash, 'client', 'Test Client']
  );

  const start = new Date(Date.now() + 30 * 86400000);
  const booking = await query(
    `INSERT INTO bookings (artist_id, client_id, status, event_start, event_end, notes)
     VALUES (?, ?, 'pending', ?, ?, ?)`,
    [
      artist.insertId,
      client.insertId,
      toMysqlDateTime(start),
      toMysqlDateTime(new Date(start.getTime() + 4 * 3600000)),
      'Integration test fixture',
    ]
  );
  bookingId = booking.insertId;

  const login = await request(app)
    .post('/auth/login')
    .send({ email: ARTIST_EMAIL, password: PASSWORD });
  artistToken = login.body.data.token;
});

afterAll(async () => {
  await cleanup();
  await closeAll();
});

describe('PATCH /bookings/:id/status', () => {
  it('returns 422 with an error message for an invalid transition', async () => {
    // pending -> completed is not an edge of the state machine: the booking
    // must be confirmed and started first.
    const response = await request(app)
      .patch(`/bookings/${bookingId}/status`)
      .set('Authorization', `Bearer ${artistToken}`)
      .send({ status: 'completed' });

    expect(response.status).toBe(422);
    expect(response.body.success).toBe(false);
    expect(typeof response.body.error).toBe('string');
    expect(response.body.error).toMatch(/pending/);
    expect(response.body.error).toMatch(/completed/);
  });
});
