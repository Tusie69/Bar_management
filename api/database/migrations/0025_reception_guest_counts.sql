-- migrate:up transaction:false
-- Six receptionist-maintained guest-count figures, isolated from bookings and visits.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE reception_guest_counts (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id       BIGINT UNSIGNED NOT NULL,
  venue_id              BIGINT UNSIGNED NOT NULL,
  business_date         DATE NOT NULL,
  arrived_before        INT UNSIGNED NOT NULL,
  arrived_after         INT UNSIGNED NOT NULL,
  arrived_total         INT UNSIGNED NOT NULL,
  booked_tables         INT UNSIGNED NOT NULL,
  booked_guests         INT UNSIGNED NOT NULL,
  returning_guests      INT UNSIGNED NOT NULL,
  created_by_user_id    BIGINT UNSIGNED NOT NULL,
  updated_by_user_id    BIGINT UNSIGNED NOT NULL,
  created_at            DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  updated_at            DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  version               INT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_reception_guest_counts_scope (organization_id, venue_id, business_date),
  KEY ix_reception_guest_counts_created_by (created_by_user_id),
  KEY ix_reception_guest_counts_updated_by (updated_by_user_id),
  CONSTRAINT fk_reception_guest_counts_venue
    FOREIGN KEY (organization_id, venue_id) REFERENCES venues (organization_id, id),
  CONSTRAINT fk_reception_guest_counts_created_by
    FOREIGN KEY (created_by_user_id) REFERENCES users (id),
  CONSTRAINT fk_reception_guest_counts_updated_by
    FOREIGN KEY (updated_by_user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- migrate:down
-- irreversible: migrations are forward-only. Restore a backup or fix forward.
