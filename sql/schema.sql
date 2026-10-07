-- ---------------------------------------------------------------------------
-- MySQL schema — relational core: users, artists, bookings, payments, reviews.
-- This is the corrected schema; TASK3.md explains each fix against the audited
-- version in the assignment.
--
-- Rich artist profile documents and review bodies live in MongoDB; the
-- `reviews` table below is the relational projection the leaderboard
-- aggregates over (see README, "Why reviews exist in both stores").
-- ---------------------------------------------------------------------------

CREATE DATABASE IF NOT EXISTS artist_booking
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

USE artist_booking;

-- Dropped child-first so the foreign keys unwind cleanly on a re-run.
DROP TABLE IF EXISTS reviews;
DROP TABLE IF EXISTS payments;
DROP TABLE IF EXISTS bookings;
DROP TABLE IF EXISTS artists;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
  id            INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  email         VARCHAR(255)  NOT NULL,
  password_hash CHAR(60)      NOT NULL,            -- bcrypt output is fixed-width
  role          ENUM('artist','client') NOT NULL,
  name          VARCHAR(120)  NOT NULL,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP
                              ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)                -- login lookup + no duplicates
) ENGINE=InnoDB;

-- One row per artist user. Shares the primary key with `users`, so an artist
-- id is the same number everywhere and the 1:1 relationship cannot drift.
CREATE TABLE artists (
  id          INT UNSIGNED   NOT NULL,
  name        VARCHAR(120)   NOT NULL,
  category    VARCHAR(64)    NOT NULL,
  hourly_rate DECIMAL(10,2)  NOT NULL DEFAULT 0.00,
  created_at  DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_artists_category (category),
  CONSTRAINT fk_artists_user FOREIGN KEY (id) REFERENCES users (id)
    ON DELETE CASCADE,
  CONSTRAINT chk_artists_rate CHECK (hourly_rate >= 0)
) ENGINE=InnoDB;

CREATE TABLE bookings (
  id          INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  artist_id   INT UNSIGNED  NOT NULL,
  client_id   INT UNSIGNED  NOT NULL,
  status      ENUM('pending','confirmed','in_progress','completed','cancelled')
                            NOT NULL DEFAULT 'pending',
  amount      DECIMAL(10,2) NULL,                  -- money is never FLOAT
  event_start DATETIME      NOT NULL,
  event_end   DATETIME      NOT NULL,
  notes       VARCHAR(2000) NOT NULL,
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP
                            ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- Serves the availability check in POST /bookings: artist + status + range.
  KEY idx_bookings_artist_status_start (artist_id, status, event_start),
  -- Serves the leaderboard's completed-booking count, which ranges on
  -- event_end rather than event_start. See TASK3.md.
  KEY idx_bookings_artist_status_end (artist_id, status, event_end),
  KEY idx_bookings_client_created (client_id, created_at),
  CONSTRAINT fk_bookings_artist FOREIGN KEY (artist_id) REFERENCES artists (id),
  CONSTRAINT fk_bookings_client FOREIGN KEY (client_id) REFERENCES users (id),
  CONSTRAINT chk_bookings_window CHECK (event_end > event_start),
  CONSTRAINT chk_bookings_amount CHECK (amount IS NULL OR amount >= 0)
) ENGINE=InnoDB;

CREATE TABLE payments (
  id            INT UNSIGNED   NOT NULL AUTO_INCREMENT,
  booking_id    INT UNSIGNED   NOT NULL,
  amount        DECIMAL(10,2)  NOT NULL,
  currency      CHAR(3)        NOT NULL DEFAULT 'INR',
  status        ENUM('initiated','captured','failed','refunded')
                               NOT NULL DEFAULT 'initiated',
  -- The gateway's idempotency handle: a retried webhook cannot double-insert.
  provider_ref  VARCHAR(128)   NOT NULL,
  created_at    DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_payments_provider_ref (provider_ref),
  KEY idx_payments_booking (booking_id),
  CONSTRAINT fk_payments_booking FOREIGN KEY (booking_id) REFERENCES bookings (id),
  CONSTRAINT chk_payments_amount CHECK (amount >= 0)
) ENGINE=InnoDB;

CREATE TABLE reviews (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  booking_id INT UNSIGNED NOT NULL,
  artist_id  INT UNSIGNED NOT NULL,
  client_id  INT UNSIGNED NOT NULL,
  score      TINYINT UNSIGNED NOT NULL,
  comment    TEXT         NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- One review per booking, enforced by the database rather than by the app.
  UNIQUE KEY uq_reviews_booking (booking_id),
  -- Covering index for the leaderboard: see TASK3.md.
  KEY idx_reviews_created_artist_score (created_at, artist_id, score),
  KEY idx_reviews_artist_created (artist_id, created_at),
  CONSTRAINT fk_reviews_booking FOREIGN KEY (booking_id) REFERENCES bookings (id),
  CONSTRAINT fk_reviews_artist  FOREIGN KEY (artist_id)  REFERENCES artists (id),
  CONSTRAINT fk_reviews_client  FOREIGN KEY (client_id)  REFERENCES users (id),
  CONSTRAINT chk_reviews_score CHECK (score BETWEEN 1 AND 5)
) ENGINE=InnoDB;
