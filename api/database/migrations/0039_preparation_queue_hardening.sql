-- migrate:up transaction:false
-- Module 4 hardening. 0037-0038 are immutable and may already be deployed.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- READY remains visible until a staff member explicitly collects it. COLLECTED
-- is the terminal acknowledgement used as the Module 5 hand-off boundary.
ALTER TABLE preparation_tickets DROP CHECK ck_preparation_tickets_milestones;
ALTER TABLE preparation_tickets DROP CHECK ck_preparation_tickets_status;
ALTER TABLE preparation_tickets
  ADD COLUMN collected_by_user_id BIGINT UNSIGNED NULL AFTER ready_at,
  ADD COLUMN collected_at DATETIME(3) NULL AFTER collected_by_user_id,
  ADD CONSTRAINT fk_preparation_tickets_collected_by FOREIGN KEY (collected_by_user_id) REFERENCES users (id),
  ADD CONSTRAINT ck_preparation_tickets_status
    CHECK (status IN ('SUBMITTED','ACCEPTED','PREPARING','READY','COLLECTED')),
  ADD CONSTRAINT ck_preparation_tickets_milestones CHECK (
    (status = 'SUBMITTED' AND accepted_by_user_id IS NULL AND accepted_at IS NULL
      AND started_by_user_id IS NULL AND started_at IS NULL AND ready_by_user_id IS NULL AND ready_at IS NULL
      AND collected_by_user_id IS NULL AND collected_at IS NULL)
    OR (status = 'ACCEPTED' AND accepted_by_user_id IS NOT NULL AND accepted_at IS NOT NULL
      AND started_by_user_id IS NULL AND started_at IS NULL AND ready_by_user_id IS NULL AND ready_at IS NULL
      AND collected_by_user_id IS NULL AND collected_at IS NULL)
    OR (status = 'PREPARING' AND accepted_by_user_id IS NOT NULL AND accepted_at IS NOT NULL
      AND started_by_user_id IS NOT NULL AND started_at IS NOT NULL
      AND ready_by_user_id IS NULL AND ready_at IS NULL AND collected_by_user_id IS NULL AND collected_at IS NULL)
    OR (status = 'READY' AND accepted_by_user_id IS NOT NULL AND accepted_at IS NOT NULL
      AND started_by_user_id IS NOT NULL AND started_at IS NOT NULL
      AND ready_by_user_id IS NOT NULL AND ready_at IS NOT NULL
      AND collected_by_user_id IS NULL AND collected_at IS NULL)
    OR (status = 'COLLECTED' AND accepted_by_user_id IS NOT NULL AND accepted_at IS NOT NULL
      AND started_by_user_id IS NOT NULL AND started_at IS NOT NULL
      AND ready_by_user_id IS NOT NULL AND ready_at IS NOT NULL
      AND collected_by_user_id IS NOT NULL AND collected_at IS NOT NULL)
  );

ALTER TABLE preparation_ticket_events DROP CHECK ck_preparation_ticket_events_from;
ALTER TABLE preparation_ticket_events DROP CHECK ck_preparation_ticket_events_to;
ALTER TABLE preparation_ticket_events
  ADD CONSTRAINT ck_preparation_ticket_events_from CHECK
    (from_status IS NULL OR from_status IN ('SUBMITTED','ACCEPTED','PREPARING','READY')),
  ADD CONSTRAINT ck_preparation_ticket_events_to CHECK
    (to_status IN ('SUBMITTED','ACCEPTED','PREPARING','READY','COLLECTED'));

-- Core never guesses a printer protocol. A station is printable only while a
-- separately deployed adapter/worker advertises an active heartbeat.
CREATE TABLE preparation_print_capabilities (
  organization_id       BIGINT UNSIGNED NOT NULL,
  venue_id              BIGINT UNSIGNED NOT NULL,
  station               VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  adapter_name          VARCHAR(100) NULL,
  is_enabled            BOOLEAN NOT NULL DEFAULT FALSE,
  worker_heartbeat_at   DATETIME(3) NULL,
  updated_at            DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (venue_id, station),
  CONSTRAINT fk_preparation_print_capability_venue FOREIGN KEY (organization_id, venue_id)
    REFERENCES venues (organization_id, id),
  CONSTRAINT ck_preparation_print_capability_station CHECK (station IN ('BAR','KITCHEN'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE preparation_print_retry_events (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id       BIGINT UNSIGNED NOT NULL,
  venue_id              BIGINT UNSIGNED NOT NULL,
  outbox_id             BIGINT UNSIGNED NOT NULL,
  actor_user_id         BIGINT UNSIGNED NOT NULL,
  actor_membership_id   BIGINT UNSIGNED NOT NULL,
  idempotency_key       VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  requested_at          DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (id),
  UNIQUE KEY uq_preparation_print_retry_idem (organization_id, idempotency_key),
  KEY ix_preparation_print_retry_outbox (outbox_id, id),
  CONSTRAINT fk_preparation_print_retry_outbox FOREIGN KEY (outbox_id) REFERENCES preparation_print_outbox (id),
  CONSTRAINT fk_preparation_print_retry_user FOREIGN KEY (actor_user_id) REFERENCES users (id),
  CONSTRAINT fk_preparation_print_retry_membership FOREIGN KEY (actor_membership_id) REFERENCES memberships (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- READY is one durable event with multiple audiences. CASHIER_ROLE intentionally
-- has no chosen user; the actual cashier is recorded only when acknowledging.
CREATE TABLE preparation_ready_events (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id       BIGINT UNSIGNED NOT NULL,
  venue_id              BIGINT UNSIGNED NOT NULL,
  ticket_id             BIGINT UNSIGNED NOT NULL,
  visit_id              BIGINT UNSIGNED NOT NULL,
  ordered_by_user_id    BIGINT UNSIGNED NOT NULL,
  created_at            DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (id),
  UNIQUE KEY uq_preparation_ready_event_ticket (ticket_id),
  KEY ix_preparation_ready_event_venue (venue_id, id),
  CONSTRAINT fk_preparation_ready_event_ticket FOREIGN KEY (venue_id, ticket_id)
    REFERENCES preparation_tickets (venue_id, id),
  CONSTRAINT fk_preparation_ready_event_visit FOREIGN KEY (venue_id, visit_id) REFERENCES visits (venue_id, id),
  CONSTRAINT fk_preparation_ready_event_user FOREIGN KEY (ordered_by_user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE preparation_ready_audiences (
  event_id              BIGINT UNSIGNED NOT NULL,
  audience              VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  target_user_id        BIGINT UNSIGNED NULL,
  created_at            DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (event_id, audience),
  CONSTRAINT fk_preparation_ready_audience_event FOREIGN KEY (event_id) REFERENCES preparation_ready_events (id),
  CONSTRAINT fk_preparation_ready_audience_user FOREIGN KEY (target_user_id) REFERENCES users (id),
  CONSTRAINT ck_preparation_ready_audience CHECK (
    (audience = 'ORDERED_BY_USER' AND target_user_id IS NOT NULL)
    OR (audience = 'CASHIER_ROLE' AND target_user_id IS NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE preparation_ready_acknowledgements (
  id                         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_id                   BIGINT UNSIGNED NOT NULL,
  audience                   VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  acknowledged_by_user_id    BIGINT UNSIGNED NOT NULL,
  acknowledged_by_membership_id BIGINT UNSIGNED NOT NULL,
  idempotency_key            VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  acknowledged_at            DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (id),
  UNIQUE KEY uq_preparation_ready_ack_actor (event_id, audience, acknowledged_by_membership_id),
  UNIQUE KEY uq_preparation_ready_ack_idem (idempotency_key),
  CONSTRAINT fk_preparation_ready_ack_audience FOREIGN KEY (event_id, audience)
    REFERENCES preparation_ready_audiences (event_id, audience),
  CONSTRAINT fk_preparation_ready_ack_user FOREIGN KEY (acknowledged_by_user_id) REFERENCES users (id),
  CONSTRAINT fk_preparation_ready_ack_membership FOREIGN KEY (acknowledged_by_membership_id) REFERENCES memberships (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Idempotent backfill from the immutable 0037 notification table.
INSERT IGNORE INTO preparation_ready_events
  (organization_id, venue_id, ticket_id, visit_id, ordered_by_user_id, created_at)
SELECT organization_id, venue_id, ticket_id, visit_id, recipient_user_id, created_at
  FROM preparation_ready_notifications;

INSERT IGNORE INTO preparation_ready_audiences (event_id, audience, target_user_id, created_at)
SELECT id, 'ORDERED_BY_USER', ordered_by_user_id, created_at FROM preparation_ready_events;
INSERT IGNORE INTO preparation_ready_audiences (event_id, audience, target_user_id, created_at)
SELECT id, 'CASHIER_ROLE', NULL, created_at FROM preparation_ready_events;

INSERT INTO permissions (code, description, is_sensitive) VALUES
  ('preparation.ready.read', 'Nhận thông báo món đã sẵn sàng', 0),
  ('preparation.ready.acknowledge', 'Xác nhận đã nhận thông báo món sẵn sàng', 0);

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
  ON p.code IN ('preparation.ready.read','preparation.ready.acknowledge')
WHERE r.code IN ('WAITER','CASHIER','OWNER','ADMIN');

-- migrate:down
-- irreversible: migrations are forward-only. Restore a backup or fix forward.
