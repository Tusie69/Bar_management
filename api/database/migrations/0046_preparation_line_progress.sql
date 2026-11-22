-- migrate:up transaction:false
-- Tiến độ chế biến theo số lượng, dùng chung giữa mọi thiết bị của quầy.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

ALTER TABLE sales_order_cancellations
  ADD COLUMN waste_quantity SMALLINT UNSIGNED NOT NULL DEFAULT 0 AFTER policy,
  ADD CONSTRAINT ck_sales_order_cancellations_waste_quantity CHECK (waste_quantity <= quantity);

CREATE TABLE preparation_line_progress (
  organization_id       BIGINT UNSIGNED NOT NULL,
  venue_id              BIGINT UNSIGNED NOT NULL,
  ticket_id             BIGINT UNSIGNED NOT NULL,
  line_id               BIGINT UNSIGNED NOT NULL,
  station               VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  line_no               SMALLINT UNSIGNED NOT NULL,
  done_quantity         SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  version               INT UNSIGNED NOT NULL DEFAULT 1,
  updated_by_user_id    BIGINT UNSIGNED NOT NULL,
  updated_by_membership_id BIGINT UNSIGNED NOT NULL,
  created_at            DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  updated_at            DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (ticket_id, line_id),
  UNIQUE KEY uq_preparation_line_progress_line_no (ticket_id, line_no),
  KEY ix_preparation_line_progress_venue (organization_id, venue_id, ticket_id),
  CONSTRAINT fk_preparation_line_progress_ticket FOREIGN KEY (venue_id, ticket_id)
    REFERENCES preparation_tickets (venue_id, id),
  CONSTRAINT fk_preparation_line_progress_line FOREIGN KEY (line_id)
    REFERENCES sales_order_lines (id),
  CONSTRAINT fk_preparation_line_progress_user FOREIGN KEY (updated_by_user_id) REFERENCES users (id),
  CONSTRAINT fk_preparation_line_progress_membership FOREIGN KEY (updated_by_membership_id) REFERENCES memberships (id),
  CONSTRAINT ck_preparation_line_progress_station CHECK (station IN ('BAR','KITCHEN'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE preparation_line_progress_events (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id       BIGINT UNSIGNED NOT NULL,
  venue_id              BIGINT UNSIGNED NOT NULL,
  ticket_id             BIGINT UNSIGNED NOT NULL,
  line_id               BIGINT UNSIGNED NOT NULL,
  station               VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  line_no               SMALLINT UNSIGNED NOT NULL,
  quantity_before       SMALLINT UNSIGNED NOT NULL,
  quantity_after        SMALLINT UNSIGNED NOT NULL,
  progress_version      INT UNSIGNED NOT NULL,
  actor_user_id         BIGINT UNSIGNED NOT NULL,
  actor_membership_id   BIGINT UNSIGNED NOT NULL,
  idempotency_key       VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  occurred_at           DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (id),
  UNIQUE KEY uq_preparation_line_progress_event_version (ticket_id, line_id, progress_version),
  UNIQUE KEY uq_preparation_line_progress_event_idempotency (organization_id, idempotency_key),
  KEY ix_preparation_line_progress_events_venue (organization_id, venue_id, id),
  CONSTRAINT fk_preparation_line_progress_events_ticket FOREIGN KEY (venue_id, ticket_id)
    REFERENCES preparation_tickets (venue_id, id),
  CONSTRAINT fk_preparation_line_progress_events_line FOREIGN KEY (line_id)
    REFERENCES sales_order_lines (id),
  CONSTRAINT fk_preparation_line_progress_events_user FOREIGN KEY (actor_user_id) REFERENCES users (id),
  CONSTRAINT fk_preparation_line_progress_events_membership FOREIGN KEY (actor_membership_id) REFERENCES memberships (id),
  CONSTRAINT ck_preparation_line_progress_events_station CHECK (station IN ('BAR','KITCHEN'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- migrate:down
-- irreversible: migrations are forward-only. Restore a backup or fix forward.
