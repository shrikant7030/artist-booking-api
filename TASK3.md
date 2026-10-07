# Task 3 — SQL & Database

## Task A — Leaderboard query

`GET /artists/leaderboard` — top 10 artists by average review score over the last 90 days,
minimum 5 reviews in the period.

```sql
WITH recent_reviews AS (
    SELECT
        r.artist_id,
        AVG(r.score) AS avg_score_raw,
        COUNT(*)     AS review_count
    FROM reviews r
    WHERE r.created_at >= NOW() - INTERVAL :days DAY
    GROUP BY r.artist_id
    HAVING COUNT(*) >= :min_reviews
)
SELECT
    a.id                        AS artist_id,
    a.name                      AS artist_name,
    a.category                  AS category,
    ROUND(rr.avg_score_raw, 2)  AS avg_score,
    rr.review_count             AS review_count,
    (
        SELECT COUNT(*)
        FROM bookings b
        WHERE b.artist_id = rr.artist_id
          AND b.status    = 'completed'
          AND b.event_end >= NOW() - INTERVAL :days DAY
    )                           AS completed_booking_count
FROM recent_reviews rr
JOIN artists a ON a.id = rr.artist_id
ORDER BY avg_score DESC, completed_booking_count DESC, a.id ASC
LIMIT :row_limit;
```

Parameters: `:days = 90`, `:min_reviews = 5`, `:row_limit = 10`.

The CTE cuts reviews down to one row per artist and applies the 5-review bar first, so the
correlated booking count only runs for artists that qualify. Joining reviews, artists and
bookings together instead would multiply rows across two one-to-many relationships and
double-count reviews.

`ROUND` is applied after `AVG`, not per score. `a.id` is the last tiebreaker so the order is
stable when two artists match on both sort keys.

I scoped the completed booking count to the same 90 days as the reviews, so every column on
a row covers the same period. Drop the `event_end` predicate for a lifetime count.

The CTE needs MySQL 8. On 5.7 use a derived table instead, which plans the same way.

### Indexes

```sql
CREATE INDEX idx_reviews_created_artist_score ON reviews  (created_at, artist_id, score);
CREATE INDEX idx_bookings_artist_status_end   ON bookings (artist_id, status, event_end);
```

`reviews (created_at, artist_id, score)`: `created_at` leads because the date range is the
only predicate, and a B-tree can only range-scan on its leading column. Adding `artist_id`
and `score` makes it covering, so the `GROUP BY` and `AVG` come straight from the index and
the table is never read. Cost then tracks rows inside the window, not table size.

`(artist_id, created_at)` looks like the obvious choice but is wrong here, because there is
no `artist_id` predicate to seek on. It is still worth having for `GET /artists/:id/reviews`,
which does filter by artist and sort by date.

`bookings (artist_id, status, event_end)` matches the subquery predicates left to right: two
equalities, then a range. All three resolve inside the index, and the same index serves the
availability check in `POST /bookings`.

I did not index `reviews (score)`. Five distinct values is roughly 20% selectivity, so the
optimiser would ignore it and writes would still pay for it.

Check with `EXPLAIN`: the bookings lookup should say `Using index`, and rows examined should
track reviews in the window rather than the whole table.

### At tens of millions of rows

Stop running it per request. The query has to touch every review in the window and no index
changes that, but nobody needs the leaderboard live to the second.

Refresh a `leaderboard_snapshot` table every 5–15 minutes and have the endpoint read ten
rows from it, swapping the new version in atomically so readers never see a half-built
table. That is the first thing I would do: small, reversible, and it turns the request into
a single indexed read.

After that, keep an `artist_review_stats` roll-up (`artist_id`, day bucket, count, sum)
updated as reviews land. The leaderboard then sums about 90 small rows per artist instead of
scanning raw reviews, and the same table serves the per-artist summary.

A 60-second HTTP cache on top absorbs traffic spikes but does not make the query cheaper.

Trade-off: staleness, and a refresh job that can fail quietly. The snapshot needs a
`computed_at` column the endpoint returns so monitoring can catch a stale one.

---

## Task B — Schema audit

Five problems with the schema as given. Corrected version:
[`sql/schema.sql`](sql/schema.sql).

### 1. No foreign keys

`bookings.artist_id`, `bookings.client_id`, `reviews.booking_id` and `reviews.artist_id` are
bare `INT`s with no `REFERENCES`.

Nothing stops a booking for an artist that does not exist, or deleting an artist with fifty
bookings and orphaning all of them. Referential integrity becomes application code every
future endpoint has to remember, and the one place that forgets corrupts data permanently.
Declared keys also help the optimiser estimate join cardinality.

```sql
ALTER TABLE bookings
  MODIFY artist_id INT UNSIGNED NOT NULL,
  MODIFY client_id INT UNSIGNED NOT NULL,
  ADD CONSTRAINT fk_bookings_artist FOREIGN KEY (artist_id) REFERENCES artists (id),
  ADD CONSTRAINT fk_bookings_client FOREIGN KEY (client_id) REFERENCES users (id);

ALTER TABLE reviews
  MODIFY booking_id INT UNSIGNED NOT NULL,
  MODIFY artist_id  INT UNSIGNED NOT NULL,
  ADD CONSTRAINT fk_reviews_booking FOREIGN KEY (booking_id) REFERENCES bookings (id),
  ADD CONSTRAINT fk_reviews_artist  FOREIGN KEY (artist_id)  REFERENCES artists (id);
```

Clean up violating rows first or the `ALTER` fails. Types must match exactly, signedness
included.

### 2. `FLOAT` for money

`hourly_rate` and `amount` are binary floating point, which cannot represent most decimal
fractions exactly. Values drift, sums stop reconciling, and `WHERE amount = 1250.10` can
match nothing for a row that displays as 1250.10. On a platform that pays artists, that is a
correctness bug waiting for a big enough invoice.

```sql
ALTER TABLE artists  MODIFY hourly_rate DECIMAL(10,2) NOT NULL DEFAULT 0.00;
ALTER TABLE bookings MODIFY amount      DECIMAL(10,2) NULL;

ALTER TABLE artists  ADD CONSTRAINT chk_artists_rate CHECK (hourly_rate >= 0);
ALTER TABLE bookings ADD CONSTRAINT chk_bookings_amount
  CHECK (amount IS NULL OR amount >= 0);
```

Converting an existing `FLOAT` rounds to two places, so check that against real data first.

### 3. No indexes beyond the primary keys

Every table has exactly one index, so every query is a full table scan: per-artist booking
lists, the availability check on every booking attempt, the leaderboard. Nobody notices at a
thousand rows, which is why it surfaces months later as high CPU with no bad deploy to blame.

```sql
CREATE INDEX idx_bookings_artist_status_start ON bookings (artist_id, status, event_start);
CREATE INDEX idx_bookings_artist_status_end   ON bookings (artist_id, status, event_end);
CREATE INDEX idx_bookings_client_created      ON bookings (client_id, created_at);
CREATE INDEX idx_reviews_artist_created       ON reviews  (artist_id, created_at);
CREATE INDEX idx_reviews_created_artist_score ON reviews  (created_at, artist_id, score);
CREATE INDEX idx_artists_category             ON artists  (category);
```

Each one is ordered to match a real access pattern rather than one index per column, since
indexes are paid for on every write.

### 4. `status VARCHAR(50)` and unconstrained `score`

Status is free text, so `'confirmed'`, `'Confirmed'` and `'confirmed '` are three statuses
to the database and one to a human. Any query filtering `status = 'completed'` silently
misses rows written by a different code path, and silently missing rows in a revenue report
is the worst kind of bug. The application enforces the state machine, but it is not the only
writer, since migrations and admin scripts write here too. `score INT` has the same hole: `0`,
`-3` and `47` all insert cleanly and corrupt every average.

```sql
ALTER TABLE bookings
  MODIFY status ENUM('pending','confirmed','in_progress','completed','cancelled')
         NOT NULL DEFAULT 'pending';

ALTER TABLE reviews
  MODIFY score TINYINT UNSIGNED NOT NULL,
  ADD CONSTRAINT chk_reviews_score CHECK (score BETWEEN 1 AND 5);
```

A lookup table with a foreign key is the alternative if statuses need to change without a
migration. I used `ENUM` because this state machine is a product invariant.

### 5. Missing `NOT NULL`, defaults and uniqueness

Everything outside the primary keys is nullable, `created_at` has no default,
`reviews.booking_id` is not unique, and nothing checks that `event_end` is after
`event_start`. Three failures, all invisible until they are expensive:

- A nullable `created_at` with no default means any insert that omits it stores `NULL`, and
  `WHERE created_at >= NOW() - INTERVAL 90 DAY` is `NULL` for those rows, so they quietly
  drop out of the leaderboard with no error anywhere.
- Without a unique key on `booking_id`, one booking can be reviewed repeatedly. That is a
  ratings-inflation hole, and a unique index is the only thing that closes it against
  concurrent writers; an application-side check loses the race.
- Backwards or zero-length bookings make overlap detection incoherent, so one corrupt row
  silently disables double-booking protection.

```sql
ALTER TABLE artists
  MODIFY name       VARCHAR(120) NOT NULL,
  MODIFY category   VARCHAR(64)  NOT NULL,
  MODIFY created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE bookings
  MODIFY event_start DATETIME NOT NULL,
  MODIFY event_end   DATETIME NOT NULL,
  MODIFY created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD    updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                              ON UPDATE CURRENT_TIMESTAMP,
  ADD CONSTRAINT chk_bookings_window CHECK (event_end > event_start);

ALTER TABLE reviews
  MODIFY created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD UNIQUE KEY uq_reviews_booking (booking_id);
```

Backfill nulls and de-duplicate reviews per booking before running these.

### Also worth fixing

No `users` table exists, so `bookings.client_id` points at nothing in this schema. No charset
is declared, which on an older install means `latin1` and mojibake for non-Latin names. And
no table has `updated_at`, which you want the moment you are debugging a status change.
