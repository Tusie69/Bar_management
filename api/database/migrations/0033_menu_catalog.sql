-- migrate:up transaction:false
-- Module Phục vụ 2 — danh mục món, đơn vị bán và lịch sử giá.
--
-- Dữ liệu từ menu marketing được nhập với source_status=PENDING_VERIFICATION.
-- API phục vụ chỉ đọc VERIFIED (trừ chế độ demo development được bật rõ).

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE menu_categories (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  venue_id       BIGINT UNSIGNED NOT NULL,
  code           VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name           VARCHAR(160) NOT NULL,
  parent_id      BIGINT UNSIGNED NULL,
  display_order  SMALLINT NOT NULL DEFAULT 0,
  is_active      TINYINT(1) NOT NULL DEFAULT 1,
  created_at     DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  updated_at     DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (id),
  UNIQUE KEY uq_menu_categories_venue_code (venue_id, code),
  UNIQUE KEY uq_menu_categories_venue_id (venue_id, id),
  KEY ix_menu_categories_venue_parent_order (venue_id, parent_id, display_order, id),
  CONSTRAINT fk_menu_categories_venue FOREIGN KEY (venue_id) REFERENCES venues (id),
  CONSTRAINT fk_menu_categories_parent FOREIGN KEY (venue_id, parent_id)
    REFERENCES menu_categories (venue_id, id),
  CONSTRAINT ck_menu_categories_active CHECK (is_active IN (0,1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE menu_items (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  venue_id             BIGINT UNSIGNED NOT NULL,
  category_id          BIGINT UNSIGNED NOT NULL,
  code                 VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  import_key           CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  name                 VARCHAR(255) NOT NULL,
  normalized_name      VARCHAR(255) NOT NULL,
  description          TEXT NULL,
  note                 TEXT NULL,
  preparation_station  VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_status        VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PENDING_VERIFICATION',
  is_active            TINYINT(1) NOT NULL DEFAULT 1,
  display_order        SMALLINT NOT NULL DEFAULT 0,
  version              INT UNSIGNED NOT NULL DEFAULT 1,
  created_at           DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  updated_at           DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (id),
  UNIQUE KEY uq_menu_items_venue_code (venue_id, code),
  UNIQUE KEY uq_menu_items_venue_import_key (venue_id, import_key),
  UNIQUE KEY uq_menu_items_venue_id (venue_id, id),
  KEY ix_menu_items_category_order (venue_id, category_id, display_order, id),
  KEY ix_menu_items_search (venue_id, source_status, is_active, normalized_name),
  CONSTRAINT fk_menu_items_venue FOREIGN KEY (venue_id) REFERENCES venues (id),
  CONSTRAINT fk_menu_items_category FOREIGN KEY (venue_id, category_id)
    REFERENCES menu_categories (venue_id, id),
  CONSTRAINT ck_menu_items_station CHECK (preparation_station IN ('BAR','KITCHEN')),
  CONSTRAINT ck_menu_items_source_status CHECK (source_status IN ('PENDING_VERIFICATION','VERIFIED','REJECTED')),
  CONSTRAINT ck_menu_items_active CHECK (is_active IN (0,1)),
  CONSTRAINT ck_menu_items_version CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE menu_item_variants (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  venue_id             BIGINT UNSIGNED NOT NULL,
  menu_item_id         BIGINT UNSIGNED NOT NULL,
  code                 VARCHAR(120) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  import_key           CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  unit_code            VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_name         VARCHAR(120) NOT NULL,
  quantity_in_unit     SMALLINT UNSIGNED NULL,
  is_active            TINYINT(1) NOT NULL DEFAULT 1,
  is_sellable          TINYINT(1) NOT NULL DEFAULT 1,
  availability_status  VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'AVAILABLE',
  display_order        SMALLINT NOT NULL DEFAULT 0,
  version              INT UNSIGNED NOT NULL DEFAULT 1,
  created_at           DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  updated_at           DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (id),
  UNIQUE KEY uq_menu_variants_item_code (menu_item_id, code),
  UNIQUE KEY uq_menu_variants_item_import_key (menu_item_id, import_key),
  UNIQUE KEY uq_menu_variants_venue_id (venue_id, id),
  KEY ix_menu_variants_item_order (venue_id, menu_item_id, display_order, id),
  KEY ix_menu_variants_catalog (venue_id, is_active, is_sellable, availability_status),
  CONSTRAINT fk_menu_variants_venue FOREIGN KEY (venue_id) REFERENCES venues (id),
  CONSTRAINT fk_menu_variants_item FOREIGN KEY (venue_id, menu_item_id)
    REFERENCES menu_items (venue_id, id),
  CONSTRAINT ck_menu_variants_unit CHECK (unit_code IN (
    'GLASS','SHOT','BOTTLE','PORTION','SHARING_JUG','SHOT_COMBO_6','SHOT_COMBO_12','CAN','OTHER'
  )),
  CONSTRAINT ck_menu_variants_flags CHECK (is_active IN (0,1) AND is_sellable IN (0,1)),
  CONSTRAINT ck_menu_variants_availability CHECK (availability_status IN (
    'AVAILABLE','TEMPORARILY_UNAVAILABLE','DISCONTINUED'
  )),
  CONSTRAINT ck_menu_variants_quantity CHECK (quantity_in_unit IS NULL OR quantity_in_unit > 0),
  CONSTRAINT ck_menu_variants_version CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE menu_variant_prices (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  venue_id          BIGINT UNSIGNED NOT NULL,
  variant_id        BIGINT UNSIGNED NOT NULL,
  import_key        CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  amount_vnd        BIGINT UNSIGNED NOT NULL,
  effective_from    DATETIME(3) NOT NULL,
  effective_to      DATETIME(3) NULL,
  is_active         TINYINT(1) NOT NULL DEFAULT 1,
  source            VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_reference  VARCHAR(255) NULL,
  version           INT UNSIGNED NOT NULL DEFAULT 1,
  created_at        DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  updated_at        DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  open_active_slot  TINYINT AS (IF(is_active = 1 AND effective_to IS NULL, 1, NULL)) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_menu_prices_variant_import_key (variant_id, import_key),
  UNIQUE KEY uq_menu_prices_one_open_active (variant_id, open_active_slot),
  UNIQUE KEY uq_menu_prices_venue_id (venue_id, id),
  KEY ix_menu_prices_current (venue_id, variant_id, is_active, effective_from, effective_to),
  CONSTRAINT fk_menu_prices_venue FOREIGN KEY (venue_id) REFERENCES venues (id),
  CONSTRAINT fk_menu_prices_variant FOREIGN KEY (venue_id, variant_id)
    REFERENCES menu_item_variants (venue_id, id),
  CONSTRAINT ck_menu_prices_amount CHECK (amount_vnd >= 0),
  CONSTRAINT ck_menu_prices_window CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT ck_menu_prices_active CHECK (is_active IN (0,1)),
  CONSTRAINT ck_menu_prices_version CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- `uq_menu_prices_one_open_active` chặn hai giá mở cùng lúc ở mức database.
-- Mọi ghi lịch sử giá đi qua menu-price.repository.ts, nơi khóa các dòng của
-- biến thể và từ chối bất kỳ khoảng hiệu lực nào chồng nhau. Thiết kế này
-- không cần quyền SUPER/log_bin_trust_function_creators như trigger MySQL.

-- migrate:down
-- irreversible: migrations are forward-only. Restore a backup or fix forward.
