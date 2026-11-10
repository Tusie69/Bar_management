-- C1 (anh Luân, họp 08/11/2026): a merged cluster is a LAYOUT entity that exists
-- before any guest and lives until a receptionist splits it.
--
-- Membership was carried by table_allocations.group_id, and ck_alloc_owner forces
-- every allocation to belong to a hold or a visit, so a cluster could not exist
-- without a guest. Membership therefore moves to its own table; group_id stays as
-- it is so the BA-021 merge, BA-020 undo and waitlist paths keep working unchanged.
--
-- table_groups gains an origin so the two lifecycles cannot be confused:
--   CLAIM  = the existing implicit cluster of one booking or visit. Unchanged:
--            dissolveUnusedGroups and the business-day worker still dissolve it.
--   LAYOUT = the new independent cluster. Never auto-dissolved, has member rows.
ALTER TABLE table_groups
  ADD COLUMN origin VARCHAR(10) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'CLAIM'
    AFTER venue_id,
  ADD COLUMN name VARCHAR(60) NULL DEFAULT NULL
    AFTER symbol_no,
  ADD COLUMN version INT UNSIGNED NOT NULL DEFAULT 1
    AFTER name,
  -- A LAYOUT cluster outlives its business date, so its symbol must stay unique
  -- venue-wide; uq_table_groups_active_symbol only scopes a symbol to one date.
  ADD COLUMN active_layout_symbol TINYINT UNSIGNED
    AS (IF(origin = 'LAYOUT' AND dissolved_at IS NULL, symbol_no, NULL)) STORED,
  ADD UNIQUE KEY uq_table_groups_active_layout_symbol (venue_id, active_layout_symbol),
  ADD CONSTRAINT ck_table_groups_origin CHECK (origin IN ('CLAIM', 'LAYOUT'));

-- uq_group_member_active is what guarantees "one physical table belongs to at most
-- one active cluster" — in the database, not in application code, so two devices
-- merging the same table concurrently cannot both win.
-- Rows are append-only: leaving a cluster sets left_at, it never deletes history.
CREATE TABLE table_group_members (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id    BIGINT UNSIGNED NOT NULL,
  venue_id           BIGINT UNSIGNED NOT NULL,
  group_id           BIGINT UNSIGNED NOT NULL,
  table_id           BIGINT UNSIGNED NOT NULL,
  joined_at          DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  joined_by_user_id  BIGINT UNSIGNED NOT NULL,
  left_at            DATETIME(3) NULL,
  left_by_user_id    BIGINT UNSIGNED NULL,
  left_reason        VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NULL,
  active_table_key   BIGINT UNSIGNED AS (IF(left_at IS NULL, table_id, NULL)) STORED,
  PRIMARY KEY (id),
  -- Exact FK indexes first, before the wider ones (MySQL 9.7.2 FK-skip, see doc 07).
  KEY fx_group_member_table (venue_id, table_id),
  KEY fx_group_member_group (venue_id, group_id),
  UNIQUE KEY uq_group_member_active (venue_id, active_table_key),
  KEY ix_group_member_org_venue (organization_id, venue_id),
  KEY ix_group_member_group_active (venue_id, group_id, left_at),
  CONSTRAINT fk_group_member_venue FOREIGN KEY (organization_id, venue_id)
    REFERENCES venues (organization_id, id),
  CONSTRAINT fk_group_member_group FOREIGN KEY (venue_id, group_id)
    REFERENCES table_groups (venue_id, id),
  CONSTRAINT fk_group_member_table FOREIGN KEY (venue_id, table_id)
    REFERENCES dining_tables (venue_id, id),
  CONSTRAINT fk_group_member_joined_by FOREIGN KEY (joined_by_user_id) REFERENCES users (id),
  CONSTRAINT fk_group_member_left_by FOREIGN KEY (left_by_user_id) REFERENCES users (id),
  CONSTRAINT ck_group_member_left CHECK (
    (left_at IS NULL AND left_by_user_id IS NULL AND left_reason IS NULL)
    OR (left_at IS NOT NULL AND left_reason IS NOT NULL AND left_at >= joined_at))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Managing an empty layout cluster is not an operation on a guest, so it does not
-- reuse visit.combine / visit.split. The API still accepts those for the clients
-- already shipped against them.
INSERT INTO permissions (code, description, is_sensitive)
VALUES ('table.group.manage', 'Ghép / tách cụm bàn trên sơ đồ mặt bằng', 0);

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles AS r
JOIN permissions AS p ON p.code = 'table.group.manage'
WHERE r.code IN ('OWNER_ADMIN', 'RECEPTIONIST');

-- migrate:down
-- irreversible: migrations are forward-only (doc 10 §2). Fix forward or restore a backup.
