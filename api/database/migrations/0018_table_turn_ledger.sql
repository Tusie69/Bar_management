-- C2 — ghi nhận lượt khách (table turn ledger).
--
-- A table or a cluster earns +1 turn when it was IN_USE and the receptionist
-- completed Trả bàn. Each turn is its own row so later statistics read history
-- rather than recomputing it from live state.
--
-- Why a new table and not `visits`: a visit has the guest and the times, but it
-- has no ordinal, no booking source, and no record of WHICH tables or cluster the
-- party sat on — that lives in table_allocations, which is released on close and
-- changes when a cluster is split. Everything needed for a turn is therefore
-- snapshotted here at close time, so editing a booking or splitting a cluster
-- afterwards cannot rewrite what happened.
--
-- Scope. A LAYOUT cluster has a durable identity, so its turns are counted
-- against the cluster (one turn for B3+B4+B5, never three). Everything else is
-- counted against a table: its own table when the party sat alone, or the lowest
-- member id when the party sat on an ad-hoc CLAIM grouping, whose id is discarded
-- on close and so cannot carry an ordinal across turns.
CREATE TABLE table_turns (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id       BIGINT UNSIGNED NOT NULL,
  venue_id              BIGINT UNSIGNED NOT NULL,
  -- The 17:00 → 05:00 operating day the turn belongs to, taken from the visit.
  business_date         DATE NOT NULL,
  scope                 VARCHAR(10) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  table_id              BIGINT UNSIGNED NULL,
  group_id              BIGINT UNSIGNED NULL,
  -- One column to order and count by, whichever scope the turn has.
  scope_key             BIGINT UNSIGNED AS (IF(scope = 'GROUP', group_id, table_id)) STORED,
  turn_no               SMALLINT UNSIGNED NOT NULL,
  visit_id              BIGINT UNSIGNED NOT NULL,
  reservation_id        BIGINT UNSIGNED NULL,

  -- Snapshot. Never joined back to live rows for display: that is the point.
  table_codes_snapshot  JSON NOT NULL,
  member_table_ids      JSON NOT NULL,
  group_code_snapshot   VARCHAR(24) NULL,
  guest_name            VARCHAR(120) NOT NULL,
  guest_count           SMALLINT UNSIGNED NOT NULL,
  source_code           VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NULL,
  origin                VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,

  seated_at             DATETIME(3) NOT NULL,
  released_at           DATETIME(3) NOT NULL,
  end_reason            VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  -- Set only for a turn that counts. A visit closed by the business-day worker, an
  -- entry correction or a merge is recorded for history but is not a served turn,
  -- so the badge and the totals read completed_at rather than the row's existence.
  completed_at          DATETIME(3) NULL,
  closed_by_user_id     BIGINT UNSIGNED NULL,
  created_at            DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

  PRIMARY KEY (id),
  -- Exact FK indexes first, before the wider ones (MySQL 9.7.2 FK-skip, see doc 07).
  KEY fx_turn_table (venue_id, table_id),
  KEY fx_turn_group (venue_id, group_id),
  KEY fx_turn_reservation (venue_id, reservation_id),
  -- Idempotency: one visit is one turn, so a repeated or concurrent Close Visit
  -- cannot write a second row. Enforced here, not in application code.
  UNIQUE KEY uq_turn_visit (venue_id, visit_id),
  -- Two devices cannot hand out the same ordinal for the same scope and day.
  UNIQUE KEY uq_turn_ordinal (venue_id, business_date, scope, scope_key, turn_no),
  KEY ix_turn_org_venue (organization_id, venue_id),
  -- The badge query: completed turns for one operating day.
  KEY ix_turn_badge (venue_id, business_date, scope, scope_key, completed_at),
  -- The date-range report query.
  KEY ix_turn_range (venue_id, business_date, id),

  CONSTRAINT fk_turn_venue FOREIGN KEY (organization_id, venue_id)
    REFERENCES venues (organization_id, id),
  CONSTRAINT fk_turn_table FOREIGN KEY (venue_id, table_id)
    REFERENCES dining_tables (venue_id, id),
  CONSTRAINT fk_turn_group FOREIGN KEY (venue_id, group_id)
    REFERENCES table_groups (venue_id, id),
  CONSTRAINT fk_turn_visit FOREIGN KEY (venue_id, visit_id)
    REFERENCES visits (venue_id, id),
  CONSTRAINT fk_turn_reservation FOREIGN KEY (venue_id, reservation_id)
    REFERENCES reservations (venue_id, id),
  CONSTRAINT fk_turn_closed_by FOREIGN KEY (closed_by_user_id) REFERENCES users (id),

  CONSTRAINT ck_turn_scope CHECK (scope IN ('TABLE', 'GROUP')),
  CONSTRAINT ck_turn_scope_shape CHECK (
    (scope = 'TABLE' AND table_id IS NOT NULL AND group_id IS NULL)
    OR (scope = 'GROUP' AND group_id IS NOT NULL AND table_id IS NULL)),
  CONSTRAINT ck_turn_ordinal CHECK (turn_no >= 1),
  CONSTRAINT ck_turn_guests CHECK (guest_count BETWEEN 1 AND 500),
  CONSTRAINT ck_turn_origin CHECK (origin IN ('RESERVATION', 'WALK_IN', 'WAITLIST')),
  CONSTRAINT ck_turn_times CHECK (released_at >= seated_at),
  -- A business-day close has no acting user, exactly as visits and allocations record it.
  CONSTRAINT ck_turn_closed_by CHECK (
    (end_reason = 'BUSINESS_DAY_END' AND closed_by_user_id IS NULL)
    OR (end_reason <> 'BUSINESS_DAY_END' AND closed_by_user_id IS NOT NULL)),
  CONSTRAINT ck_turn_completed CHECK (completed_at IS NULL OR completed_at >= released_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- migrate:down
-- irreversible: migrations are forward-only (doc 10 §2). Fix forward or restore a backup.
