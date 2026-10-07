'use strict';

const { query, withTransaction } = require('../../db/mysql');

const COLUMNS = `id, artist_id, client_id, status, amount, event_start, event_end,
                 notes, created_at, updated_at`;

const findById = async (id) => {
  const rows = await query(`SELECT ${COLUMNS} FROM bookings WHERE id = ? LIMIT 1`, [id]);
  return rows[0] || null;
};

// Half-open overlap: [start, end) intersects [event_start, event_end) when
// event_start < end AND event_end > start, so back-to-back bookings are allowed.
const OVERLAP_SQL = `
  SELECT id FROM bookings
   WHERE artist_id = ?
     AND status = 'confirmed'
     AND event_start < ?
     AND event_end   > ?
   LIMIT 1`;

const findConfirmedOverlap = async (artistId, eventStart, eventEnd, connection) => {
  const runner = connection
    ? (sql, params) => connection.execute(sql, params).then(([rows]) => rows)
    : query;
  const rows = await runner(OVERLAP_SQL, [artistId, eventEnd, eventStart]);
  return rows[0] || null;
};

// The overlap is re-checked inside the transaction so two concurrent requests
// cannot both pass a check-then-insert.
const createPending = async ({ artistId, clientId, eventStart, eventEnd, notes, amount }) =>
  withTransaction(async (connection) => {
    const clash = await findConfirmedOverlap(artistId, eventStart, eventEnd, connection);
    if (clash) return { conflict: clash };

    const [result] = await connection.execute(
      `INSERT INTO bookings
         (artist_id, client_id, status, amount, event_start, event_end, notes)
       VALUES (?, ?, 'pending', ?, ?, ?, ?)`,
      [artistId, clientId, amount ?? null, eventStart, eventEnd, notes]
    );

    const [rows] = await connection.execute(
      `SELECT ${COLUMNS} FROM bookings WHERE id = ?`,
      [result.insertId]
    );
    return { booking: rows[0] };
  });

// Compare-and-set: a writer that read a stale status affects 0 rows.
const updateStatus = async (id, fromStatus, toStatus) => {
  const result = await query(
    `UPDATE bookings SET status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = ?`,
    [toStatus, id, fromStatus]
  );
  return result.affectedRows === 1;
};

const findCompletedIdsByArtist = async (artistId) => {
  const rows = await query(
    `SELECT id FROM bookings WHERE artist_id = ? AND status = 'completed'`,
    [artistId]
  );
  return rows.map((row) => row.id);
};

module.exports = {
  findById,
  createPending,
  updateStatus,
  findCompletedIdsByArtist,
};
