-- migrate:up transaction:false
-- GAM-APP / 21GAM - initial schema v1.2 (26 tables + RBAC reference data).
-- Target: MySQL Community 9.7.2 LTS, InnoDB, utf8mb4_0900_ai_ci.
-- Source: verification/ddl_draft.sql copied verbatim (doc 13 §12), catalog in doc 15.
--
-- Run with dbmate:  dbmate --no-dump-schema migrate --strict
-- Run without dbmate (mysql CLI / Workbench): select the target schema first (USE gam21_dev;),
-- then execute the whole file. The "-- migrate:*" lines are plain comments for MySQL.
--
-- DDL auto-commits in MySQL: transaction:false makes that explicit. If this file fails half way
-- on an empty dev database, drop and recreate the database, fix the file, run again (doc 14 §5).
-- After applying: run verification/fk_lint.sql, it must return no rows (MySQL 9.7.2 FK-skip, doc 07 §8).

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- =====================================================================
-- A. IDENTITY & AUTHORIZATION
-- =====================================================================

CREATE TABLE organizations (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code          VARCHAR(40)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name          VARCHAR(200) NOT NULL,
  status        VARCHAR(20)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
  created_at    DATETIME(3)  NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  updated_at    DATETIME(3)  NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  version       INT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_organizations_code (code),
  CONSTRAINT ck_organizations_status CHECK (status IN ('ACTIVE','SUSPENDED','CLOSED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE venues (
  id                             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id                BIGINT UNSIGNED NOT NULL,
  code                           VARCHAR(40)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name                           VARCHAR(200) NOT NULL,
  status                         VARCHAR(20)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
  timezone                       VARCHAR(64)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  business_day_start_local       TIME NOT NULL DEFAULT '17:00:00',
  business_day_cutoff_local      TIME NOT NULL DEFAULT '05:00:00',
  late_warning_minutes           SMALLINT UNSIGNED NOT NULL DEFAULT 15,
  no_show_warning_minutes        SMALLINT UNSIGNED NOT NULL DEFAULT 30,
  waitlist_hold_default_minutes  SMALLINT UNSIGNED NOT NULL DEFAULT 30,
  waitlist_claim_lease_seconds   SMALLINT UNSIGNED NOT NULL DEFAULT 300,
  reservation_hold_policy        VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'SEQUENTIAL',
  reservation_window_minutes     SMALLINT UNSIGNED NULL,
  group_symbol_count             TINYINT UNSIGNED NOT NULL DEFAULT 12,
  change_seq                     BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at                     DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  updated_at                     DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  version                        INT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_venues_org_code (organization_id, code),
  UNIQUE KEY uq_venues_org_id (organization_id, id),
  CONSTRAINT fk_venues_org FOREIGN KEY (organization_id) REFERENCES organizations (id),
  CONSTRAINT ck_venues_status CHECK (status IN ('ACTIVE','INACTIVE')),
  CONSTRAINT ck_venues_policy CHECK (
    (reservation_hold_policy = 'SEQUENTIAL' AND reservation_window_minutes IS NULL) OR
    (reservation_hold_policy = 'WINDOWED'   AND reservation_window_minutes BETWEEN 15 AND 720)),
  CONSTRAINT ck_venues_warnings CHECK (late_warning_minutes >= 1 AND no_show_warning_minutes > late_warning_minutes),
  CONSTRAINT ck_venues_hold_default CHECK (waitlist_hold_default_minutes BETWEEN 1 AND 240),
  CONSTRAINT ck_venues_claim_lease CHECK (waitlist_claim_lease_seconds BETWEEN 30 AND 3600),
  CONSTRAINT ck_venues_symbols CHECK (group_symbol_count BETWEEN 1 AND 50)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE users (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  username       VARCHAR(64)  NOT NULL,
  display_name   VARCHAR(120) NOT NULL,
  password_hash  VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status         VARCHAR(20)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
  last_login_at  DATETIME(3)  NULL,
  created_at     DATETIME(3)  NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  updated_at     DATETIME(3)  NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  version        INT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_username (username),
  CONSTRAINT ck_users_status CHECK (status IN ('ACTIVE','DISABLED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE memberships (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id  BIGINT UNSIGNED NOT NULL,
  user_id          BIGINT UNSIGNED NOT NULL,
  status           VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
  joined_at        DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  ended_at         DATETIME(3) NULL,
  created_at       DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  version          INT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_memberships_org_user (organization_id, user_id),
  UNIQUE KEY uq_memberships_org_id (organization_id, id),
  KEY ix_memberships_user (user_id),
  CONSTRAINT fk_memberships_org  FOREIGN KEY (organization_id) REFERENCES organizations (id),
  CONSTRAINT fk_memberships_user FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT ck_memberships_status CHECK (status IN ('ACTIVE','SUSPENDED','ENDED')),
  CONSTRAINT ck_memberships_ended CHECK ((status = 'ENDED') = (ended_at IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE roles (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code         VARCHAR(40)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name         VARCHAR(120) NOT NULL,
  is_system    TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_roles_code (code),
  CONSTRAINT ck_roles_is_system CHECK (is_system IN (0,1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE permissions (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code          VARCHAR(60)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  description   VARCHAR(200) NOT NULL,
  is_sensitive  TINYINT(1)   NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_permissions_code (code),
  CONSTRAINT ck_permissions_sensitive CHECK (is_sensitive IN (0,1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE role_permissions (
  role_id        BIGINT UNSIGNED NOT NULL,
  permission_id  BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  KEY ix_role_permissions_perm (permission_id),
  CONSTRAINT fk_role_permissions_role FOREIGN KEY (role_id) REFERENCES roles (id),
  CONSTRAINT fk_role_permissions_perm FOREIGN KEY (permission_id) REFERENCES permissions (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE membership_roles (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id     BIGINT UNSIGNED NOT NULL,
  membership_id       BIGINT UNSIGNED NOT NULL,
  role_id             BIGINT UNSIGNED NOT NULL,
  venue_id            BIGINT UNSIGNED NULL,          -- NULL = every venue of the organization
  granted_by_user_id  BIGINT UNSIGNED NULL,
  granted_at          DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  revoked_by_user_id  BIGINT UNSIGNED NULL,
  revoked_at          DATETIME(3) NULL,
  venue_scope         BIGINT UNSIGNED AS (IFNULL(venue_id, 0)) STORED,
  active_flag         TINYINT AS (IF(revoked_at IS NULL, 1, NULL)) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_membership_roles_active (membership_id, role_id, venue_scope, active_flag),
  KEY ix_membership_roles_org_membership (organization_id, membership_id),
  KEY ix_membership_roles_org_venue (organization_id, venue_id),
  KEY ix_membership_roles_role (role_id),
  CONSTRAINT fk_membership_roles_membership FOREIGN KEY (organization_id, membership_id) REFERENCES memberships (organization_id, id),
  CONSTRAINT fk_membership_roles_venue FOREIGN KEY (organization_id, venue_id) REFERENCES venues (organization_id, id),
  CONSTRAINT fk_membership_roles_role FOREIGN KEY (role_id) REFERENCES roles (id),
  CONSTRAINT fk_membership_roles_granted_by FOREIGN KEY (granted_by_user_id) REFERENCES users (id),
  CONSTRAINT fk_membership_roles_revoked_by FOREIGN KEY (revoked_by_user_id) REFERENCES users (id),
  CONSTRAINT ck_membership_roles_revoke CHECK ((revoked_at IS NULL) = (revoked_by_user_id IS NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE auth_sessions (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id  BIGINT UNSIGNED NOT NULL,
  membership_id    BIGINT UNSIGNED NOT NULL,
  user_id          BIGINT UNSIGNED NOT NULL,
  token_hash       BINARY(32)   NOT NULL,             -- SHA-256 of the refresh token; raw token never stored
  device_label     VARCHAR(100) NULL,
  created_at       DATETIME(3)  NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  last_seen_at     DATETIME(3)  NULL,
  expires_at       DATETIME(3)  NOT NULL,
  revoked_at       DATETIME(3)  NULL,
  revoke_reason    VARCHAR(30)  CHARACTER SET ascii COLLATE ascii_bin NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_auth_sessions_token (token_hash),
  KEY fx_auth_sessions_user (user_id),                 -- exact FK index declared before wider ones (MySQL 9.7.2 FK-skip, see doc 07)
  KEY ix_auth_sessions_user (user_id, revoked_at),
  KEY ix_auth_sessions_expires (expires_at),
  KEY ix_auth_sessions_org_membership (organization_id, membership_id),
  CONSTRAINT fk_auth_sessions_membership FOREIGN KEY (organization_id, membership_id) REFERENCES memberships (organization_id, id),
  CONSTRAINT fk_auth_sessions_user FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT ck_auth_sessions_expiry CHECK (expires_at > created_at),
  CONSTRAINT ck_auth_sessions_revoke CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =====================================================================
-- B. VENUE & PHYSICAL RESOURCES
-- =====================================================================

CREATE TABLE floors (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id  BIGINT UNSIGNED NOT NULL,
  venue_id         BIGINT UNSIGNED NOT NULL,
  code             VARCHAR(20)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name             VARCHAR(100) NOT NULL,
  sort_order       SMALLINT     NOT NULL DEFAULT 0,
  is_active        TINYINT(1)   NOT NULL DEFAULT 1,
  version          INT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_floors_venue_code (venue_id, code),
  UNIQUE KEY uq_floors_venue_id (venue_id, id),
  KEY ix_floors_org_venue (organization_id, venue_id),
  CONSTRAINT fk_floors_venue FOREIGN KEY (organization_id, venue_id) REFERENCES venues (organization_id, id),
  CONSTRAINT ck_floors_active CHECK (is_active IN (0,1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE zones (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id  BIGINT UNSIGNED NOT NULL,
  venue_id         BIGINT UNSIGNED NOT NULL,
  floor_id         BIGINT UNSIGNED NULL,
  code             VARCHAR(20)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name             VARCHAR(100) NOT NULL,
  is_bookable      TINYINT(1)   NOT NULL DEFAULT 1,
  is_waiting_area  TINYINT(1)   NOT NULL DEFAULT 0,
  sort_order       SMALLINT     NOT NULL DEFAULT 0,
  is_active        TINYINT(1)   NOT NULL DEFAULT 1,
  version          INT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_zones_venue_code (venue_id, code),
  UNIQUE KEY uq_zones_venue_id (venue_id, id),
  KEY ix_zones_org_venue (organization_id, venue_id),
  KEY ix_zones_floor (venue_id, floor_id),
  CONSTRAINT fk_zones_venue FOREIGN KEY (organization_id, venue_id) REFERENCES venues (organization_id, id),
  CONSTRAINT fk_zones_floor FOREIGN KEY (venue_id, floor_id) REFERENCES floors (venue_id, id),
  CONSTRAINT ck_zones_flags CHECK (is_bookable IN (0,1) AND is_waiting_area IN (0,1) AND is_active IN (0,1)),
  CONSTRAINT ck_zones_waiting_not_bookable CHECK (NOT (is_waiting_area = 1 AND is_bookable = 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE dining_tables (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id  BIGINT UNSIGNED NOT NULL,
  venue_id         BIGINT UNSIGNED NOT NULL,
  zone_id          BIGINT UNSIGNED NOT NULL,
  code             VARCHAR(20)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_name     VARCHAR(40)  NOT NULL,
  kind             VARCHAR(20)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  capacity         TINYINT UNSIGNED NOT NULL,
  seq_no           SMALLINT UNSIGNED NULL,
  is_spare         TINYINT(1)   NOT NULL DEFAULT 0,
  status           VARCHAR(20)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
  pos_x            SMALLINT     NULL,
  pos_y            SMALLINT     NULL,
  width            SMALLINT UNSIGNED NULL,
  height           SMALLINT UNSIGNED NULL,
  rotation_deg     SMALLINT     NOT NULL DEFAULT 0,
  created_at       DATETIME(3)  NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  updated_at       DATETIME(3)  NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  version          INT UNSIGNED NOT NULL DEFAULT 1,
  bar_seq_key      SMALLINT UNSIGNED AS (IF(kind = 'BAR_SEAT', seq_no, NULL)) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_dining_tables_venue_code (venue_id, code),
  UNIQUE KEY uq_dining_tables_venue_id (venue_id, id),
  UNIQUE KEY uq_dining_tables_bar_seq (venue_id, bar_seq_key),
  KEY ix_dining_tables_org_venue (organization_id, venue_id),
  KEY ix_dining_tables_zone (venue_id, zone_id),
  CONSTRAINT fk_dining_tables_venue FOREIGN KEY (organization_id, venue_id) REFERENCES venues (organization_id, id),
  CONSTRAINT fk_dining_tables_zone FOREIGN KEY (venue_id, zone_id) REFERENCES zones (venue_id, id),
  CONSTRAINT ck_dining_tables_kind CHECK (kind IN ('TABLE','BAR_SEAT')),
  CONSTRAINT ck_dining_tables_status CHECK (status IN ('ACTIVE','OUT_OF_SERVICE','RETIRED')),
  CONSTRAINT ck_dining_tables_capacity CHECK (capacity BETWEEN 1 AND 50),
  CONSTRAINT ck_dining_tables_bar_seat CHECK (kind <> 'BAR_SEAT' OR (capacity = 1 AND seq_no IS NOT NULL)),
  CONSTRAINT ck_dining_tables_spare CHECK (is_spare IN (0,1)),
  CONSTRAINT ck_dining_tables_rotation CHECK (rotation_deg BETWEEN 0 AND 359)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Conditional on BQ3: named preset configurations such as B1 = B11 + B12. Not a bookable resource.
CREATE TABLE table_combinations (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id  BIGINT UNSIGNED NOT NULL,
  venue_id         BIGINT UNSIGNED NOT NULL,
  code             VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_name     VARCHAR(40) NOT NULL,
  is_active        TINYINT(1)  NOT NULL DEFAULT 1,
  version          INT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_table_combinations_venue_code (venue_id, code),
  UNIQUE KEY uq_table_combinations_venue_id (venue_id, id),
  KEY ix_table_combinations_org_venue (organization_id, venue_id),
  CONSTRAINT fk_table_combinations_venue FOREIGN KEY (organization_id, venue_id) REFERENCES venues (organization_id, id),
  CONSTRAINT ck_table_combinations_active CHECK (is_active IN (0,1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE table_combination_members (
  venue_id        BIGINT UNSIGNED NOT NULL,
  combination_id  BIGINT UNSIGNED NOT NULL,
  table_id        BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (combination_id, table_id),
  KEY ix_tcm_venue_combination (venue_id, combination_id),
  KEY ix_tcm_venue_table (venue_id, table_id),
  CONSTRAINT fk_tcm_combination FOREIGN KEY (venue_id, combination_id) REFERENCES table_combinations (venue_id, id),
  CONSTRAINT fk_tcm_table FOREIGN KEY (venue_id, table_id) REFERENCES dining_tables (venue_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =====================================================================
-- C. CUSTOMERS (organization scope)
-- =====================================================================

CREATE TABLE customers (
  id                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id          BIGINT UNSIGNED NOT NULL,
  display_name             VARCHAR(120) NULL,
  name_search              VARCHAR(120) NULL,          -- app-normalized: lowercase, no diacritics, d for đ
  phone_ciphertext         VARBINARY(128) NULL,        -- AES-256-GCM: nonce(12) || ciphertext || tag(16)
  phone_key_id             SMALLINT UNSIGNED NULL,
  phone_hmac               BINARY(32) NULL,            -- HMAC-SHA256(E.164) for exact lookup and dedupe
  phone_hmac_key_id        SMALLINT UNSIGNED NULL,
  phone_last3              CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NULL,
  status                   VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
  merged_into_customer_id  BIGINT UNSIGNED NULL,
  anonymized_at            DATETIME(3) NULL,
  anonymized_by_user_id    BIGINT UNSIGNED NULL,
  created_by_user_id       BIGINT UNSIGNED NULL,
  created_at               DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  updated_at               DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  version                  INT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_customers_org_id (organization_id, id),
  UNIQUE KEY uq_customers_org_phone (organization_id, phone_hmac),
  KEY ix_customers_org_last3 (organization_id, phone_last3),
  KEY ix_customers_org_name (organization_id, name_search),
  KEY ix_customers_org_merged (organization_id, merged_into_customer_id),
  CONSTRAINT fk_customers_org FOREIGN KEY (organization_id) REFERENCES organizations (id),
  CONSTRAINT fk_customers_merged FOREIGN KEY (organization_id, merged_into_customer_id) REFERENCES customers (organization_id, id),
  CONSTRAINT fk_customers_anonymized_by FOREIGN KEY (anonymized_by_user_id) REFERENCES users (id),
  CONSTRAINT fk_customers_created_by FOREIGN KEY (created_by_user_id) REFERENCES users (id),
  CONSTRAINT ck_customers_status CHECK (status IN ('ACTIVE','MERGED','ANONYMIZED')),
  CONSTRAINT ck_customers_phone_all_or_none CHECK (
    (phone_ciphertext IS NULL AND phone_key_id IS NULL AND phone_hmac IS NULL AND phone_hmac_key_id IS NULL AND phone_last3 IS NULL) OR
    (phone_ciphertext IS NOT NULL AND phone_key_id IS NOT NULL AND phone_hmac IS NOT NULL AND phone_hmac_key_id IS NOT NULL AND phone_last3 IS NOT NULL)),
  CONSTRAINT ck_customers_last3 CHECK (phone_last3 IS NULL OR phone_last3 REGEXP '^[0-9]{3}$'),
  CONSTRAINT ck_customers_merged CHECK ((status = 'MERGED') = (merged_into_customer_id IS NOT NULL)),
  CONSTRAINT ck_customers_anonymized CHECK (
    (status = 'ANONYMIZED') = (anonymized_at IS NOT NULL) AND
    (status <> 'ANONYMIZED' OR (display_name IS NULL AND name_search IS NULL AND phone_hmac IS NULL))),
  CONSTRAINT ck_customers_identifiable CHECK (status <> 'ACTIVE' OR display_name IS NOT NULL OR phone_hmac IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =====================================================================
-- D. BOOKING & WAITLIST
-- =====================================================================

CREATE TABLE booking_sources (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id  BIGINT UNSIGNED NOT NULL,
  code             VARCHAR(30)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name             VARCHAR(100) NOT NULL,
  is_active        TINYINT(1)   NOT NULL DEFAULT 1,
  sort_order       SMALLINT     NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_booking_sources_org_code (organization_id, code),
  UNIQUE KEY uq_booking_sources_org_id (organization_id, id),
  CONSTRAINT fk_booking_sources_org FOREIGN KEY (organization_id) REFERENCES organizations (id),
  CONSTRAINT ck_booking_sources_active CHECK (is_active IN (0,1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE visits (
  id                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id        BIGINT UNSIGNED NOT NULL,
  venue_id               BIGINT UNSIGNED NOT NULL,
  origin                 VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  customer_id            BIGINT UNSIGNED NULL,
  contact_name           VARCHAR(120) NULL,
  guest_count            SMALLINT UNSIGNED NOT NULL,
  started_at             DATETIME(3) NOT NULL,
  business_date          DATE NOT NULL,
  ended_at               DATETIME(3) NULL,
  ended_by_user_id       BIGINT UNSIGNED NULL,
  end_reason             VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NULL,
  merged_into_visit_id   BIGINT UNSIGNED NULL,
  paid_marked_at         DATETIME(3) NULL,
  paid_marked_by_user_id BIGINT UNSIGNED NULL,
  note                   VARCHAR(500) NULL,
  created_by_user_id     BIGINT UNSIGNED NOT NULL,
  created_at             DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  updated_at             DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  version                INT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_visits_venue_id (venue_id, id),
  KEY ix_visits_org_venue (organization_id, venue_id),
  KEY ix_visits_venue_date (venue_id, business_date),
  KEY ix_visits_venue_open (venue_id, ended_at),
  KEY ix_visits_org_customer (organization_id, customer_id, started_at),
  KEY ix_visits_merged (venue_id, merged_into_visit_id),
  CONSTRAINT fk_visits_venue FOREIGN KEY (organization_id, venue_id) REFERENCES venues (organization_id, id),
  CONSTRAINT fk_visits_customer FOREIGN KEY (organization_id, customer_id) REFERENCES customers (organization_id, id),
  CONSTRAINT fk_visits_merged FOREIGN KEY (venue_id, merged_into_visit_id) REFERENCES visits (venue_id, id),
  CONSTRAINT fk_visits_ended_by FOREIGN KEY (ended_by_user_id) REFERENCES users (id),
  CONSTRAINT fk_visits_paid_by FOREIGN KEY (paid_marked_by_user_id) REFERENCES users (id),
  CONSTRAINT fk_visits_created_by FOREIGN KEY (created_by_user_id) REFERENCES users (id),
  CONSTRAINT ck_visits_origin CHECK (origin IN ('RESERVATION','WALK_IN','WAITLIST')),
  CONSTRAINT ck_visits_guests CHECK (guest_count BETWEEN 1 AND 500),
  CONSTRAINT ck_visits_end_reason CHECK (end_reason IS NULL OR end_reason IN ('GUEST_LEFT','MERGED','ENTRY_ERROR')),
  CONSTRAINT ck_visits_end CHECK (
    (ended_at IS NULL AND ended_by_user_id IS NULL AND end_reason IS NULL) OR
    (ended_at IS NOT NULL AND ended_by_user_id IS NOT NULL AND end_reason IS NOT NULL AND ended_at >= started_at)),
  CONSTRAINT ck_visits_merged CHECK ((merged_into_visit_id IS NOT NULL) = (IFNULL(end_reason, '') = 'MERGED')),
  CONSTRAINT ck_visits_paid CHECK ((paid_marked_at IS NULL) = (paid_marked_by_user_id IS NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE reservations (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id       BIGINT UNSIGNED NOT NULL,
  venue_id              BIGINT UNSIGNED NOT NULL,
  customer_id           BIGINT UNSIGNED NULL,
  contact_name          VARCHAR(120) NULL,
  contact_name_search   VARCHAR(120) NULL,
  source_id             BIGINT UNSIGNED NOT NULL,
  party_size            SMALLINT UNSIGNED NOT NULL,
  expected_at           DATETIME(3) NOT NULL,
  business_date         DATE NOT NULL,
  status                VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'BOOKED',
  note                  VARCHAR(500) NULL,
  visit_id              BIGINT UNSIGNED NULL,
  checked_in_at         DATETIME(3) NULL,
  checked_in_by_user_id BIGINT UNSIGNED NULL,
  closed_at             DATETIME(3) NULL,
  closed_by_user_id     BIGINT UNSIGNED NULL,
  close_reason_code     VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NULL,
  close_reason_note     VARCHAR(300) NULL,
  late_warned_at        DATETIME(3) NULL,
  no_show_warned_at     DATETIME(3) NULL,
  created_by_user_id    BIGINT UNSIGNED NOT NULL,
  created_at            DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  updated_by_user_id    BIGINT UNSIGNED NULL,
  updated_at            DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  version               INT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_reservations_venue_id (venue_id, id),
  KEY ix_reservations_org_venue (organization_id, venue_id),
  KEY ix_reservations_venue_date_status (venue_id, business_date, status),
  KEY ix_reservations_venue_name (venue_id, contact_name_search),
  KEY ix_reservations_org_customer (organization_id, customer_id, expected_at),
  KEY ix_reservations_org_source (organization_id, source_id),
  KEY ix_reservations_visit (venue_id, visit_id),
  CONSTRAINT fk_reservations_venue FOREIGN KEY (organization_id, venue_id) REFERENCES venues (organization_id, id),
  CONSTRAINT fk_reservations_customer FOREIGN KEY (organization_id, customer_id) REFERENCES customers (organization_id, id),
  CONSTRAINT fk_reservations_source FOREIGN KEY (organization_id, source_id) REFERENCES booking_sources (organization_id, id),
  CONSTRAINT fk_reservations_visit FOREIGN KEY (venue_id, visit_id) REFERENCES visits (venue_id, id),
  CONSTRAINT fk_reservations_checked_in_by FOREIGN KEY (checked_in_by_user_id) REFERENCES users (id),
  CONSTRAINT fk_reservations_closed_by FOREIGN KEY (closed_by_user_id) REFERENCES users (id),
  CONSTRAINT fk_reservations_created_by FOREIGN KEY (created_by_user_id) REFERENCES users (id),
  CONSTRAINT fk_reservations_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users (id),
  CONSTRAINT ck_reservations_status CHECK (status IN ('BOOKED','CHECKED_IN','CANCELLED','NO_SHOW')),
  CONSTRAINT ck_reservations_contact CHECK (customer_id IS NOT NULL OR contact_name IS NOT NULL),
  CONSTRAINT ck_reservations_party CHECK (party_size BETWEEN 1 AND 500),
  CONSTRAINT ck_reservations_checked_in CHECK (
    (status = 'CHECKED_IN') = (visit_id IS NOT NULL AND checked_in_at IS NOT NULL AND checked_in_by_user_id IS NOT NULL)),
  CONSTRAINT ck_reservations_closed CHECK (
    (status IN ('CANCELLED','NO_SHOW')) = (closed_at IS NOT NULL AND closed_by_user_id IS NOT NULL AND close_reason_code IS NOT NULL)),
  CONSTRAINT ck_reservations_close_reason CHECK (close_reason_code IS NULL OR close_reason_code IN
    ('CUSTOMER_REQUEST','NO_SHOW_CONFIRMED','DUPLICATE','ENTRY_ERROR','VENUE_DECISION','OTHER')),
  CONSTRAINT ck_reservations_no_show_reason CHECK (status <> 'NO_SHOW' OR close_reason_code = 'NO_SHOW_CONFIRMED')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE waitlist_entries (
  id                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id        BIGINT UNSIGNED NOT NULL,
  venue_id               BIGINT UNSIGNED NOT NULL,
  kind                   VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  priority_class         TINYINT UNSIGNED AS (IF(kind = 'ADVANCE_RESERVATION', 1, 2)) STORED,
  reservation_id         BIGINT UNSIGNED NULL,     -- ADVANCE_RESERVATION: contact, party size, time come from here
  customer_id            BIGINT UNSIGNED NULL,     -- WALK_IN only
  contact_name           VARCHAR(120) NULL,        -- WALK_IN only
  party_size             SMALLINT UNSIGNED NULL,   -- WALK_IN only
  preference_mode        VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ANY',
  contact_channel        VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  business_date          DATE NOT NULL,
  queued_at              DATETIME(3) NOT NULL,
  status                 VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'WAITING',
  claimed_by_user_id     BIGINT UNSIGNED NULL,
  claimed_at             DATETIME(3) NULL,
  claim_expires_at       DATETIME(3) NULL,
  offered_at             DATETIME(3) NULL,
  visit_id               BIGINT UNSIGNED NULL,
  closed_at              DATETIME(3) NULL,
  closed_by_user_id      BIGINT UNSIGNED NULL,
  close_reason_code      VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NULL,
  close_reason_note      VARCHAR(300) NULL,
  note                   VARCHAR(500) NULL,
  created_by_user_id     BIGINT UNSIGNED NOT NULL,
  created_at             DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  updated_at             DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  version                INT UNSIGNED NOT NULL DEFAULT 1,
  active_reservation_key BIGINT UNSIGNED AS (IF(status IN ('WAITING','CONTACTING','OFFERED','HOLD_ACTIVE'), reservation_id, NULL)) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_waitlist_entries_venue_id (venue_id, id),
  UNIQUE KEY uq_waitlist_entries_active_reservation (venue_id, active_reservation_key),
  KEY ix_waitlist_entries_org_venue (organization_id, venue_id),
  KEY ix_waitlist_entries_queue (venue_id, status, priority_class, queued_at),
  KEY ix_waitlist_entries_reservation (venue_id, reservation_id),
  KEY ix_waitlist_entries_visit (venue_id, visit_id),
  KEY ix_waitlist_entries_org_customer (organization_id, customer_id),
  CONSTRAINT fk_waitlist_entries_venue FOREIGN KEY (organization_id, venue_id) REFERENCES venues (organization_id, id),
  CONSTRAINT fk_waitlist_entries_reservation FOREIGN KEY (venue_id, reservation_id) REFERENCES reservations (venue_id, id),
  CONSTRAINT fk_waitlist_entries_customer FOREIGN KEY (organization_id, customer_id) REFERENCES customers (organization_id, id),
  CONSTRAINT fk_waitlist_entries_visit FOREIGN KEY (venue_id, visit_id) REFERENCES visits (venue_id, id),
  CONSTRAINT fk_waitlist_entries_claimed_by FOREIGN KEY (claimed_by_user_id) REFERENCES users (id),
  CONSTRAINT fk_waitlist_entries_closed_by FOREIGN KEY (closed_by_user_id) REFERENCES users (id),
  CONSTRAINT fk_waitlist_entries_created_by FOREIGN KEY (created_by_user_id) REFERENCES users (id),
  CONSTRAINT ck_waitlist_entries_kind CHECK (kind IN ('ADVANCE_RESERVATION','WALK_IN')),
  CONSTRAINT ck_waitlist_entries_kind_shape CHECK (
    (kind = 'ADVANCE_RESERVATION' AND reservation_id IS NOT NULL AND customer_id IS NULL AND contact_name IS NULL AND party_size IS NULL) OR
    (kind = 'WALK_IN' AND reservation_id IS NULL AND party_size IS NOT NULL AND (customer_id IS NOT NULL OR contact_name IS NOT NULL))),
  CONSTRAINT ck_waitlist_entries_party CHECK (party_size IS NULL OR party_size BETWEEN 1 AND 500),
  CONSTRAINT ck_waitlist_entries_pref CHECK (preference_mode IN ('ANY','PREFERRED_FIRST','PREFERRED_ONLY')),
  CONSTRAINT ck_waitlist_entries_channel CHECK (contact_channel IN ('IN_PERSON','PHONE_CALLBACK','ZALO_THREAD','FANPAGE_THREAD','OTHER')),
  CONSTRAINT ck_waitlist_entries_status CHECK (status IN ('WAITING','CONTACTING','OFFERED','HOLD_ACTIVE','SEATED','DECLINED','CANCELLED')),
  CONSTRAINT ck_waitlist_entries_claim CHECK (
    (status = 'CONTACTING') = (claimed_by_user_id IS NOT NULL AND claimed_at IS NOT NULL AND claim_expires_at IS NOT NULL)),
  CONSTRAINT ck_waitlist_entries_offered CHECK (status <> 'OFFERED' OR offered_at IS NOT NULL),
  CONSTRAINT ck_waitlist_entries_seated CHECK ((status = 'SEATED') = (visit_id IS NOT NULL)),
  CONSTRAINT ck_waitlist_entries_closed CHECK ((status IN ('SEATED','DECLINED','CANCELLED')) = (closed_at IS NOT NULL)),
  CONSTRAINT ck_waitlist_entries_close_reason CHECK (
    (status NOT IN ('DECLINED','CANCELLED') OR (close_reason_code IS NOT NULL AND closed_by_user_id IS NOT NULL)) AND
    (close_reason_code IS NULL OR close_reason_code IN
      ('CUSTOMER_DECLINED','CUSTOMER_WITHDREW','NO_SHOW_AFTER_ACCEPT','RESERVATION_CANCELLED','SEATED_OTHERWISE','DUPLICATE','ENTRY_ERROR','OTHER')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE waitlist_table_preferences (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id  BIGINT UNSIGNED NOT NULL,
  venue_id         BIGINT UNSIGNED NOT NULL,
  entry_id         BIGINT UNSIGNED NOT NULL,
  pref_rank        TINYINT UNSIGNED NOT NULL,
  table_id         BIGINT UNSIGNED NULL,
  combination_id   BIGINT UNSIGNED NULL,
  zone_id          BIGINT UNSIGNED NULL,
  created_at       DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (id),
  UNIQUE KEY uq_wtp_entry_rank (entry_id, pref_rank),
  KEY ix_wtp_org_venue (organization_id, venue_id),
  KEY ix_wtp_venue_entry (venue_id, entry_id),
  KEY ix_wtp_venue_table (venue_id, table_id),
  KEY ix_wtp_venue_combination (venue_id, combination_id),
  KEY ix_wtp_venue_zone (venue_id, zone_id),
  CONSTRAINT fk_wtp_venue FOREIGN KEY (organization_id, venue_id) REFERENCES venues (organization_id, id),
  CONSTRAINT fk_wtp_entry FOREIGN KEY (venue_id, entry_id) REFERENCES waitlist_entries (venue_id, id),
  CONSTRAINT fk_wtp_table FOREIGN KEY (venue_id, table_id) REFERENCES dining_tables (venue_id, id),
  CONSTRAINT fk_wtp_combination FOREIGN KEY (venue_id, combination_id) REFERENCES table_combinations (venue_id, id),
  CONSTRAINT fk_wtp_zone FOREIGN KEY (venue_id, zone_id) REFERENCES zones (venue_id, id),
  CONSTRAINT ck_wtp_exactly_one CHECK (
    (table_id IS NOT NULL) + (combination_id IS NOT NULL) + (zone_id IS NOT NULL) = 1),
  CONSTRAINT ck_wtp_rank CHECK (pref_rank BETWEEN 1 AND 20)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE waitlist_contact_attempts (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id       BIGINT UNSIGNED NOT NULL,
  venue_id              BIGINT UNSIGNED NOT NULL,
  entry_id              BIGINT UNSIGNED NOT NULL,
  attempt_no            SMALLINT UNSIGNED NOT NULL,
  attempted_by_user_id  BIGINT UNSIGNED NOT NULL,
  channel               VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  started_at            DATETIME(3) NOT NULL,
  ended_at              DATETIME(3) NULL,
  outcome               VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  offered_table_ids     JSON NULL,
  note                  VARCHAR(300) NULL,
  created_at            DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (id),
  UNIQUE KEY uq_wca_entry_attempt (entry_id, attempt_no),
  KEY ix_wca_org_venue (organization_id, venue_id),
  KEY ix_wca_venue_entry (venue_id, entry_id),
  KEY ix_wca_venue_started (venue_id, started_at),
  CONSTRAINT fk_wca_venue FOREIGN KEY (organization_id, venue_id) REFERENCES venues (organization_id, id),
  CONSTRAINT fk_wca_entry FOREIGN KEY (venue_id, entry_id) REFERENCES waitlist_entries (venue_id, id),
  CONSTRAINT fk_wca_user FOREIGN KEY (attempted_by_user_id) REFERENCES users (id),
  CONSTRAINT ck_wca_channel CHECK (channel IN ('IN_PERSON','PHONE_BY_AUTHORIZED','ZALO_THREAD','FANPAGE_THREAD','OTHER')),
  CONSTRAINT ck_wca_outcome CHECK (outcome IN
    ('NO_ANSWER','CALLBACK_REQUESTED','OFFER_PENDING','ACCEPTED','DECLINED_OFFER','KEEP_WAITING','WITHDREW','WRONG_CONTACT')),
  CONSTRAINT ck_wca_times CHECK (ended_at IS NULL OR ended_at >= started_at),
  CONSTRAINT ck_wca_offer_json CHECK (offered_table_ids IS NULL OR JSON_TYPE(offered_table_ids) = 'ARRAY')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE table_holds (
  id                        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id           BIGINT UNSIGNED NOT NULL,
  venue_id                  BIGINT UNSIGNED NOT NULL,
  hold_kind                 VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reservation_id            BIGINT UNSIGNED NULL,
  waitlist_entry_id         BIGINT UNSIGNED NULL,
  status                    VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
  starts_at                 DATETIME(3) NOT NULL,
  customer_confirmed_at     DATETIME(3) NULL,
  deadline_at               DATETIME(3) NULL,          -- warning threshold only; NEVER used to free the table
  deadline_basis            VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NULL,
  default_minutes_snapshot  SMALLINT UNSIGNED NULL,
  deadline_set_by_user_id   BIGINT UNSIGNED NULL,
  deadline_reason           VARCHAR(300) NULL,
  deadline_warned_at        DATETIME(3) NULL,
  converted_at              DATETIME(3) NULL,
  converted_visit_id        BIGINT UNSIGNED NULL,
  released_at               DATETIME(3) NULL,
  released_by_user_id       BIGINT UNSIGNED NULL,
  release_reason_code       VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NULL,
  release_reason_note       VARCHAR(300) NULL,
  created_by_user_id        BIGINT UNSIGNED NOT NULL,
  created_at                DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  updated_at                DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  version                   INT UNSIGNED NOT NULL DEFAULT 1,
  active_entry_key          BIGINT UNSIGNED AS (IF(status = 'ACTIVE', waitlist_entry_id, NULL)) STORED,
  active_reservation_key    BIGINT UNSIGNED AS (IF(status = 'ACTIVE', reservation_id, NULL)) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_table_holds_venue_id (venue_id, id),
  UNIQUE KEY uq_table_holds_active_entry (venue_id, active_entry_key),
  UNIQUE KEY uq_table_holds_active_reservation (venue_id, active_reservation_key),
  KEY ix_table_holds_org_venue (organization_id, venue_id),
  KEY ix_table_holds_deadline (venue_id, status, deadline_at),
  KEY ix_table_holds_reservation (venue_id, reservation_id),
  KEY ix_table_holds_entry (venue_id, waitlist_entry_id),
  KEY ix_table_holds_visit (venue_id, converted_visit_id),
  CONSTRAINT fk_table_holds_venue FOREIGN KEY (organization_id, venue_id) REFERENCES venues (organization_id, id),
  CONSTRAINT fk_table_holds_reservation FOREIGN KEY (venue_id, reservation_id) REFERENCES reservations (venue_id, id),
  CONSTRAINT fk_table_holds_entry FOREIGN KEY (venue_id, waitlist_entry_id) REFERENCES waitlist_entries (venue_id, id),
  CONSTRAINT fk_table_holds_visit FOREIGN KEY (venue_id, converted_visit_id) REFERENCES visits (venue_id, id),
  CONSTRAINT fk_table_holds_deadline_by FOREIGN KEY (deadline_set_by_user_id) REFERENCES users (id),
  CONSTRAINT fk_table_holds_released_by FOREIGN KEY (released_by_user_id) REFERENCES users (id),
  CONSTRAINT fk_table_holds_created_by FOREIGN KEY (created_by_user_id) REFERENCES users (id),
  CONSTRAINT ck_table_holds_kind CHECK (hold_kind IN ('RESERVATION','WAITLIST_OFFER')),
  CONSTRAINT ck_table_holds_status CHECK (status IN ('ACTIVE','CONVERTED','RELEASED')),
  CONSTRAINT ck_table_holds_kind_shape CHECK (
    (hold_kind = 'RESERVATION' AND reservation_id IS NOT NULL AND waitlist_entry_id IS NULL
       AND customer_confirmed_at IS NULL AND deadline_at IS NULL AND deadline_basis IS NULL) OR
    (hold_kind = 'WAITLIST_OFFER' AND waitlist_entry_id IS NOT NULL
       AND customer_confirmed_at IS NOT NULL AND deadline_at IS NOT NULL AND deadline_basis IS NOT NULL)),
  CONSTRAINT ck_table_holds_basis CHECK (deadline_basis IS NULL OR deadline_basis IN ('DEFAULT','NEGOTIATED')),
  CONSTRAINT ck_table_holds_default_deadline CHECK (
    deadline_basis IS NULL OR deadline_basis <> 'DEFAULT' OR
    (default_minutes_snapshot IS NOT NULL AND deadline_at = customer_confirmed_at + INTERVAL default_minutes_snapshot MINUTE)),
  CONSTRAINT ck_table_holds_negotiated CHECK (
    deadline_basis IS NULL OR deadline_basis <> 'NEGOTIATED' OR
    (deadline_set_by_user_id IS NOT NULL AND deadline_reason IS NOT NULL AND deadline_at > customer_confirmed_at)),
  CONSTRAINT ck_table_holds_converted CHECK ((status = 'CONVERTED') = (converted_at IS NOT NULL AND converted_visit_id IS NOT NULL)),
  CONSTRAINT ck_table_holds_released CHECK (
    (status = 'RELEASED') = (released_at IS NOT NULL AND released_by_user_id IS NOT NULL AND release_reason_code IS NOT NULL)),
  CONSTRAINT ck_table_holds_release_reason CHECK (release_reason_code IS NULL OR release_reason_code IN
    ('CUSTOMER_NO_SHOW','CUSTOMER_CANCELLED','RESERVATION_CANCELLED','STAFF_REASSIGNED','ENTRY_ERROR','UNDO','OTHER'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE table_groups (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id      BIGINT UNSIGNED NOT NULL,
  venue_id             BIGINT UNSIGNED NOT NULL,
  business_date        DATE NOT NULL,
  symbol_no            TINYINT UNSIGNED NOT NULL,
  formed_at            DATETIME(3) NOT NULL,
  formed_by_user_id    BIGINT UNSIGNED NOT NULL,
  dissolved_at         DATETIME(3) NULL,
  dissolved_by_user_id BIGINT UNSIGNED NULL,
  active_symbol        TINYINT UNSIGNED AS (IF(dissolved_at IS NULL, symbol_no, NULL)) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_table_groups_venue_id (venue_id, id),
  UNIQUE KEY uq_table_groups_active_symbol (venue_id, business_date, active_symbol),
  KEY ix_table_groups_org_venue (organization_id, venue_id),
  CONSTRAINT fk_table_groups_venue FOREIGN KEY (organization_id, venue_id) REFERENCES venues (organization_id, id),
  CONSTRAINT fk_table_groups_formed_by FOREIGN KEY (formed_by_user_id) REFERENCES users (id),
  CONSTRAINT fk_table_groups_dissolved_by FOREIGN KEY (dissolved_by_user_id) REFERENCES users (id),
  CONSTRAINT ck_table_groups_symbol CHECK (symbol_no BETWEEN 1 AND 50),
  CONSTRAINT ck_table_groups_dissolve CHECK (
    (dissolved_at IS NULL AND dissolved_by_user_id IS NULL) OR
    (dissolved_at IS NOT NULL AND dissolved_by_user_id IS NOT NULL AND dissolved_at >= formed_at))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE table_allocations (
  id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id         BIGINT UNSIGNED NOT NULL,
  venue_id                BIGINT UNSIGNED NOT NULL,
  table_id                BIGINT UNSIGNED NOT NULL,
  kind                    VARCHAR(10) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  hold_id                 BIGINT UNSIGNED NULL,
  visit_id                BIGINT UNSIGNED NULL,
  group_id                BIGINT UNSIGNED NULL,
  starts_at               DATETIME(3) NOT NULL,
  planned_until           DATETIME(3) NULL,     -- NULL = open-ended (until manual release). Only WINDOWED reservation holds set it.
  business_date           DATE NOT NULL,
  released_at             DATETIME(3) NULL,     -- the ONLY thing that frees the table
  released_by_user_id     BIGINT UNSIGNED NULL,
  release_reason          VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_by_user_id      BIGINT UNSIGNED NOT NULL,
  created_at              DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  active_usage_table_key  BIGINT UNSIGNED AS (IF(kind = 'USAGE' AND released_at IS NULL, table_id, NULL)) STORED,
  open_claim_table_key    BIGINT UNSIGNED AS (IF(released_at IS NULL AND planned_until IS NULL, table_id, NULL)) STORED,
  PRIMARY KEY (id),
  KEY fx_alloc_table (venue_id, table_id),             -- exact FK index declared before wider ones (MySQL 9.7.2 FK-skip, see doc 07)
  UNIQUE KEY uq_alloc_one_active_usage (venue_id, active_usage_table_key),
  UNIQUE KEY uq_alloc_one_open_claim (venue_id, business_date, open_claim_table_key),
  KEY ix_alloc_org_venue (organization_id, venue_id),
  KEY ix_alloc_table_active (venue_id, table_id, released_at, starts_at),
  KEY ix_alloc_venue_active (venue_id, released_at, business_date),
  KEY ix_alloc_report (venue_id, business_date, kind, table_id),
  KEY ix_alloc_hold (venue_id, hold_id),
  KEY ix_alloc_visit (venue_id, visit_id),
  KEY ix_alloc_group (venue_id, group_id),
  CONSTRAINT fk_alloc_venue FOREIGN KEY (organization_id, venue_id) REFERENCES venues (organization_id, id),
  CONSTRAINT fk_alloc_table FOREIGN KEY (venue_id, table_id) REFERENCES dining_tables (venue_id, id),
  CONSTRAINT fk_alloc_hold FOREIGN KEY (venue_id, hold_id) REFERENCES table_holds (venue_id, id),
  CONSTRAINT fk_alloc_visit FOREIGN KEY (venue_id, visit_id) REFERENCES visits (venue_id, id),
  CONSTRAINT fk_alloc_group FOREIGN KEY (venue_id, group_id) REFERENCES table_groups (venue_id, id),
  CONSTRAINT fk_alloc_released_by FOREIGN KEY (released_by_user_id) REFERENCES users (id),
  CONSTRAINT fk_alloc_created_by FOREIGN KEY (created_by_user_id) REFERENCES users (id),
  CONSTRAINT ck_alloc_kind CHECK (kind IN ('HOLD','USAGE')),
  CONSTRAINT ck_alloc_owner CHECK (
    (kind = 'HOLD'  AND hold_id IS NOT NULL AND visit_id IS NULL) OR
    (kind = 'USAGE' AND visit_id IS NOT NULL AND hold_id IS NULL)),
  CONSTRAINT ck_alloc_usage_open CHECK (kind <> 'USAGE' OR planned_until IS NULL),
  CONSTRAINT ck_alloc_planned CHECK (planned_until IS NULL OR planned_until > starts_at),
  CONSTRAINT ck_alloc_release CHECK (
    (released_at IS NULL AND released_by_user_id IS NULL AND release_reason IS NULL) OR
    (released_at IS NOT NULL AND released_by_user_id IS NOT NULL AND release_reason IS NOT NULL)),
  CONSTRAINT ck_alloc_usage_release_order CHECK (kind <> 'USAGE' OR released_at IS NULL OR released_at >= starts_at),
  CONSTRAINT ck_alloc_release_reason CHECK (release_reason IS NULL OR release_reason IN
    ('CONVERTED_TO_USAGE','MOVED','REGROUPED','SPLIT','MERGED','GUEST_LEFT','HOLD_RELEASED','RESERVATION_CANCELLED','NO_SHOW','ENTRY_ERROR','UNDO'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =====================================================================
-- E. RELIABILITY & AUDIT
-- =====================================================================

CREATE TABLE operation_log (
  id                        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id           BIGINT UNSIGNED NOT NULL,
  venue_id                  BIGINT UNSIGNED NULL,
  change_seq                BIGINT UNSIGNED NULL,     -- set only for venue state changes; realtime cursor
  occurred_at               DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  actor_kind                VARCHAR(10) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  actor_user_id             BIGINT UNSIGNED NULL,
  actor_membership_id       BIGINT UNSIGNED NULL,
  auth_session_id           BIGINT UNSIGNED NULL,
  request_id                CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  idempotency_key           VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  action                    VARCHAR(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  entity_type               VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  entity_id                 BIGINT UNSIGNED NOT NULL,
  entity_version_before     INT UNSIGNED NULL,
  entity_version_after      INT UNSIGNED NULL,
  changes                   JSON NULL,                -- [{type,id,v_before,v_after,before,after}], PII-redacted
  reason_code               VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NULL,
  reason_note               VARCHAR(500) NULL,
  is_undoable               TINYINT(1) NOT NULL DEFAULT 0,
  compensates_operation_id  BIGINT UNSIGNED NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_oplog_venue_seq (venue_id, change_seq),
  UNIQUE KEY uq_oplog_compensates (compensates_operation_id),
  KEY ix_oplog_org_entity (organization_id, entity_type, entity_id, id),
  KEY ix_oplog_venue_time (venue_id, occurred_at),
  KEY ix_oplog_actor_time (actor_user_id, occurred_at),
  KEY ix_oplog_org_action_time (organization_id, action, occurred_at),
  CONSTRAINT fk_oplog_org FOREIGN KEY (organization_id) REFERENCES organizations (id),
  CONSTRAINT fk_oplog_venue FOREIGN KEY (organization_id, venue_id) REFERENCES venues (organization_id, id),
  CONSTRAINT fk_oplog_actor FOREIGN KEY (actor_user_id) REFERENCES users (id),
  CONSTRAINT fk_oplog_compensates FOREIGN KEY (compensates_operation_id) REFERENCES operation_log (id),
  CONSTRAINT ck_oplog_actor CHECK (
    (actor_kind = 'USER' AND actor_user_id IS NOT NULL) OR (actor_kind = 'SYSTEM' AND actor_user_id IS NULL)),
  CONSTRAINT ck_oplog_seq_needs_venue CHECK (change_seq IS NULL OR venue_id IS NOT NULL),
  CONSTRAINT ck_oplog_undoable CHECK (is_undoable IN (0,1)),
  CONSTRAINT ck_oplog_changes_json CHECK (changes IS NULL OR JSON_TYPE(changes) = 'ARRAY')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE idempotency_keys (
  organization_id   BIGINT UNSIGNED NOT NULL,
  idem_key          VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id           BIGINT UNSIGNED NOT NULL,
  endpoint          VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_hash      BINARY(32) NOT NULL,
  response_status   SMALLINT UNSIGNED NULL,
  response_body     JSON NULL,
  operation_id      BIGINT UNSIGNED NULL,
  created_at        DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  expires_at        DATETIME(3) NOT NULL,
  PRIMARY KEY (organization_id, idem_key),
  KEY ix_idempotency_expires (expires_at),
  CONSTRAINT fk_idempotency_org FOREIGN KEY (organization_id) REFERENCES organizations (id),
  CONSTRAINT fk_idempotency_user FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT ck_idempotency_expiry CHECK (expires_at > created_at),
  CONSTRAINT ck_idempotency_response CHECK ((response_status IS NULL) = (response_body IS NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =====================================================================
-- F. REFERENCE DATA: system roles and permissions (doc 08 §3, TECH_PROPOSED, role mapping awaits PO)
-- =====================================================================

INSERT INTO roles (code, name, is_system) VALUES
  ('OWNER_ADMIN',   'Chủ quán / Admin', 1),
  ('RECEPTIONIST',  'Lễ tân',           1),
  ('CUSTOMER_CARE', 'CSKH',             1),
  ('CASHIER',       'Thu ngân',         1);

INSERT INTO permissions (code, description, is_sensitive) VALUES
  ('reservation.create',       'Tạo booking', 0),
  ('reservation.update',       'Sửa booking', 0),
  ('reservation.cancel',       'Hủy booking', 0),
  ('reservation.mark_no_show', 'Xác nhận không đến', 0),
  ('table.assign',             'Gán / đổi bàn', 0),
  ('table.assign_override',    'Gán vượt sức chứa, dùng bàn sơ cua, ngoại lệ (bắt buộc lý do)', 0),
  ('visit.checkin',            'Nhận bàn', 0),
  ('visit.walkin',             'Mở bàn Walk-in', 0),
  ('visit.move',               'Đổi bàn', 0),
  ('visit.combine',            'Ghép bàn', 0),
  ('visit.split',              'Tách bàn', 0),
  ('visit.end',                'Nhả bàn khi khách rời', 0),
  ('visit.mark_paid',          'Đánh dấu đã thanh toán', 0),
  ('waitlist.create',          'Thêm entry chờ', 0),
  ('waitlist.cancel',          'Hủy entry chờ', 0),
  ('waitlist.claim',           'Nhận xử lý entry chờ', 0),
  ('waitlist.record_contact',  'Ghi lần liên hệ khách', 0),
  ('waitlist.accept_offer',    'Ghi nhận khách đồng ý, tạo hold', 0),
  ('hold.set_deadline',        'Ghi nhận giờ giữ thỏa thuận', 0),
  ('hold.release',             'Nhả hold thủ công', 0),
  ('customer.view_masked',     'Xem tên + 3 số cuối SĐT', 0),
  ('customer.phone.reveal',    'Xem SĐT gốc', 1),
  ('customer.anonymize',       'Ẩn danh khách', 1),
  ('operation.undo',           'Undo/Redo thao tác', 0),
  ('audit.read',               'Đọc nhật ký thao tác', 1),
  ('report.read',              'Xem thống kê', 0),
  ('venue.configure',          'Cấu hình sơ đồ, bàn, mốc thời gian', 0),
  ('user.manage',              'Quản lý nhân viên, gán role', 1);

-- OWNER_ADMIN: every permission. Only OWNER_ADMIN gets customer.phone.reveal (BD-07).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.code = 'OWNER_ADMIN';

-- RECEPTIONIST: operation.undo is limited to the user's own operations by the API.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
  'reservation.create','reservation.update','reservation.cancel','reservation.mark_no_show',
  'table.assign','visit.checkin','visit.walkin','visit.move','visit.combine','visit.split','visit.end',
  'waitlist.create','waitlist.cancel','waitlist.claim','waitlist.record_contact','waitlist.accept_offer',
  'hold.set_deadline','hold.release','customer.view_masked','operation.undo')
WHERE r.code = 'RECEPTIONIST';

-- CUSTOMER_CARE: has hold.set_deadline but NOT customer.phone.reveal (R-25).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
  'waitlist.create','waitlist.cancel','waitlist.claim','waitlist.record_contact','waitlist.accept_offer',
  'hold.set_deadline','customer.view_masked')
WHERE r.code = 'CUSTOMER_CARE';

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN ('visit.end','visit.mark_paid','customer.view_masked')
WHERE r.code = 'CASHIER';

-- migrate:down
-- irreversible: migrations are forward-only (doc 10 §2). Fix forward or restore a backup.

