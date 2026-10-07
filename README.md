# Artist Booking API

A booking platform backend: clients request artists for a time window, artists drive the
booking through a state machine, and completed bookings earn reviews.

Node.js 18+ · Express · MySQL 8 (users, bookings, payments) · MongoDB (artist profiles,
reviews) · JWT auth · Jest + Supertest.

Assignment deliverables: **[TASK3.md](TASK3.md)** (schema audit + leaderboard query and
index reasoning) and **[TASK4.md](TASK4.md)** (system design).

---

## Requirements

- Node.js 18 or later
- MySQL 8 or later, running locally. Version 8 matters: the leaderboard query uses a CTE.
- MongoDB, running locally on the default port

## Quick start

### 1. Clone and install

```bash
git clone <repository-url>
cd artist-booking-api
npm install
```

### 2. Configure

```bash
cp .env.example .env
```

Set `JWT_SECRET` and your local MySQL credentials in `.env`. Generate a secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

`.env` is gitignored. No password, key or secret is committed anywhere, and the app refuses
to boot without `JWT_SECRET` rather than falling back to a baked-in default.

### 3. Create the schema and seed

Make sure MySQL and MongoDB are both running, then:

```bash
npm run schema   # creates the artist_booking database and tables
npm run seed     # fills MySQL and MongoDB with demo data
```

Both read their connection details from `.env`. `npm run schema` applies
`sql/schema.sql` through the Node driver so the `mysql` client does not need to be on your
PATH, which it often is not on Windows. If you would rather use the CLI:

```bash
mysql -u root -p < sql/schema.sql
```

Both commands drop and recreate the tables, so they are safe to re-run.

Seeded accounts, all with the password `Password123!`:

| Role   | Email                | Notes                                   |
| ------ | -------------------- | --------------------------------------- |
| artist | `aria@example.com`   | 7 reviews — appears on the leaderboard   |
| artist | `dev@example.com`    | 6 reviews — appears on the leaderboard   |
| artist | `maya@example.com`   | 3 reviews — below the 5-review bar       |
| client | `nina@example.com`   | has bookings with every artist           |
| client | `omar@example.com`   | second client, for ownership checks      |

### 4. Run

```bash
npm start    # http://localhost:3000
npm test     # integration test (requires MySQL + MongoDB running)
```

`npm test` runs against the real databases. It creates its own users and booking, asserts
the invalid transition, then deletes exactly those rows, so your seeded data is left intact.
The schema must exist first (step 3).

---

## API reference

Every endpoint returns the same envelope, on success and on failure:

```json
{ "success": true, "data": {}, "error": null }
```

On failure `data` is `null` and `error` is a human-readable message. There are no other
top-level keys, on success or failure.

### `POST /auth/login`

```bash
curl -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"nina@example.com","password":"Password123!"}'
```

Returns a signed JWT in `data.token`, to be sent as `Authorization: Bearer <token>`. Its
payload carries `sub` (user id), `role` (`artist` or `client`) and `iat` (issued-at). Invalid credentials return **401** with the same message whether the
email is unknown or the password is wrong.

### `POST /bookings` — clients only

```bash
curl -X POST http://localhost:3000/bookings \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"artist_id":3,"event_start":"2027-06-15T18:00:00Z","event_end":"2027-06-15T22:00:00Z","notes":"Sangeet, 150 guests"}'
```

Required: `artist_id`, `event_start`, `event_end`, `notes`. Creates the booking as
`pending`.

| Condition                                           | Status |
| --------------------------------------------------- | ------ |
| Created                                              | 201    |
| Missing/invalid field, or `event_start` in the past  | 400    |
| Caller is an artist                                  | 403    |
| Artist id does not exist                             | 404    |
| Overlaps a **confirmed** booking for that artist     | 409    |

### `PATCH /bookings/:id/status`

```bash
curl -X PATCH http://localhost:3000/bookings/9/status \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"status":"confirmed"}'
```

```
pending     ──▶ confirmed      (artist approves)
confirmed   ──▶ in_progress    (event has started)
in_progress ──▶ completed      (event is done)
pending     ──▶ cancelled      (either party, before confirmation)
confirmed   ──▶ cancelled      (either party, after confirmation)

completed and cancelled are terminal.
```

| Condition                                                  | Status  |
| ---------------------------------------------------------- | ------- |
| Applied                                                     | 200     |
| `status` is not one of the five known values                | 400     |
| Valid edge, but wrong role (e.g. a client confirming)       | 403     |
| Booking does not exist, or caller is party to neither side  | 404     |
| Someone else changed the status concurrently                | 409     |
| **Not an edge of the state machine**                        | **422** |

The 422 message names the attempted move and the moves that would have been legal:

```json
{
  "success": false,
  "data": null,
  "error": "Invalid status transition: \"pending\" -> \"completed\". Allowed transitions from \"pending\": confirmed, cancelled."
}
```

### `GET /artists/:id/reviews`

```bash
curl 'http://localhost:3000/artists/3/reviews?page=1&limit=10'
```

Public. Returns only reviews attached to **completed** bookings, newest first, with a
summary computed over the whole visible set rather than the current page:

```json
{
  "success": true,
  "data": {
    "artist_id": 3,
    "reviews": [ { "booking_id": 3, "score": 5, "comment": "…", "created_at": "…" } ],
    "summary": {
      "average_score": 4.71,
      "total_reviews": 7,
      "score_distribution": { "1": 0, "2": 0, "3": 0, "4": 2, "5": 5 }
    },
    "pagination": { "page": 1, "limit": 10, "total": 7, "total_pages": 1, "has_next": false }
  },
  "error": null
}
```

`limit` defaults to 20 and is capped at 100.

---

## Design decisions

### A repository layer between services and databases

Services depend on three repository interfaces rather than calling drivers directly. This
keeps SQL and Mongo query syntax out of the business logic and makes the two-database split
an implementation detail instead of something every service has to know about.

### The state machine is one table, not scattered `if` statements

`src/domain/bookingStatus.js` holds the legal edges and the role allowed to drive each one.
The service asks it two questions; the rules exist in exactly one place. The error messages
are generated from the same table that enforces the rule, so they cannot drift out of date.

### Error codes chosen deliberately

- **422 for an invalid transition.** The request is well-formed and the booking exists; the
  operation just is not legal from the current state.
- **400 for an unknown status value.** `"teleported"` is not a failed transition, it is a
  malformed request. Distinguishing the two tells a client whether to fix its code or
  re-read the booking.
- **404, not 403, for a booking belonging to someone else.** A 403 confirms the id exists.
  Users party to neither side are told it does not exist, which is all they are entitled to.
- **409 when the compare-and-set finds a different status.** Somebody won the race, so the
  client should re-read rather than retry blindly.

### Concurrency is handled in the database, not in JavaScript

- **Double-booking.** The overlap check and the insert run inside one transaction, with the
  check repeated inside it. A check-then-insert in application code loses to a concurrent
  request between the two statements.
- **Status transitions.** The update is `UPDATE … SET status = ? WHERE id = ? AND status = ?`
  which is a compare-and-set. A second writer that read a stale status affects zero rows and
  gets a 409 instead of silently overwriting the first writer's change.

Overlap uses half-open intervals (`event_start < :end AND event_end > :start`), so a booking
that starts exactly when another ends is allowed rather than rejected.

### Login does not leak which field was wrong

An unknown email runs a dummy bcrypt comparison before returning. Without it, "unknown
email" returns in microseconds and "wrong password" takes ~80ms, and the endpoint becomes a
user-enumeration oracle regardless of the identical message.

### Time is UTC everywhere

MySQL `DATETIME` carries no timezone, so values are stored and read as UTC in the canonical
`YYYY-MM-DD HH:MM:SS` form (`dateStrings: true` on the pool), converted only at the API
edge. Clients send and receive ISO-8601.

### Why reviews exist in both stores

MongoDB is the source of truth for review documents — that is what `GET /artists/:id/reviews`
reads, and the document shape is what will grow (media attachments, tags, artist replies).
MySQL carries a `reviews` projection because Task A's leaderboard is a relational aggregate
joining artists and bookings. The seed writes both.

In production a dual write is the wrong mechanism — the projection should be fed by
change-data-capture or a transactional outbox so a crash between the two writes cannot leave
them disagreeing. That is the first thing I would add.

---

## Trade-offs I accepted

**Review visibility is a cross-store filter.** "Only reviews from completed bookings" means
asking MySQL for the artist's completed booking ids and passing them into the Mongo query.
It is correct and honest about the two-database split, but it is `$in` against a list that
grows with the artist's history. Fine at hundreds of bookings; past a few thousand I would
denormalise a `booking_status` field onto the review document and query it directly.

**`bcryptjs` rather than `bcrypt`.** The pure-JS implementation is slower but installs
without a native toolchain, which matters for a reviewer cloning this on Windows. For a real
deployment I would use native `bcrypt` or `argon2id`.

**No refresh tokens.** The assignment specifies JWT with no sessions. Access tokens expire in
an hour; a production system needs refresh tokens and a revocation path, which stateless JWTs
do not give you for free.

**`payments` and `artist_profiles` are schema-only.** Both are created and seeded because the
assignment names payments as relational data and artist profiles as document data, but the
four required endpoints do not read either one.

**No rate limiting, CORS or helmet.** Out of scope for a local-only exercise.
`POST /auth/login` is the obvious thing to rate-limit first.

---

## What I would do next

1. **Replace the review dual-write with an outbox.** The one place the current design can
   produce inconsistent data between the two stores.
2. **`POST /reviews`.** Reviews are read-only today; writing one belongs behind a check that
   the booking is completed and the author is its client, with the `UNIQUE (booking_id)` key
   doing the real enforcement.
3. **Materialise the leaderboard.** Per TASK3.md — a 5-minute refresh into a snapshot table,
   turning an O(reviews-in-window) request into a single indexed read.
4. **Broaden the test suite.** One integration test covers the required case; the overlap
   rule, the role matrix and the review summary maths all deserve the same treatment.
5. **Rate-limit login**, then add refresh tokens and revocation.
6. **A migration tool** (Knex or similar). `sql/schema.sql` drops and recreates, which is
   right for a local exercise and wrong for anything with data in it.

---

## Project layout

```
src/
  app.js                   Express wiring; the error handler is mounted last
  server.js                Startup, graceful shutdown
  config/                  Environment parsing; refuses to boot without JWT_SECRET
  domain/bookingStatus.js  The state machine: edges and who may drive each one
  services/                Business logic — depends on repository interfaces only
  repositories/mysql|mongo Data access, one module per aggregate
  middleware/              JWT authentication, role guards, error handling
  routes/                  Thin HTTP layer: parse, delegate, respond
  utils/                   Response envelope, ApiError, tokens, passwords, UTC datetimes
sql/schema.sql             The corrected schema (Task B's fixes, applied)
scripts/seed.js            Seeds MySQL and MongoDB with coherent demo data
tests/bookingStatus.test.js  The required integration test: invalid transition → 422
```
