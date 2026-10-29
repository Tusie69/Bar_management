CREATE TABLE table_adjacencies (
  organization_id BIGINT UNSIGNED NOT NULL,
  venue_id BIGINT UNSIGNED NOT NULL,
  low_table_id BIGINT UNSIGNED NOT NULL,
  high_table_id BIGINT UNSIGNED NOT NULL,
  created_by_user_id BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (venue_id, low_table_id, high_table_id),
  KEY ix_table_adjacencies_org_venue (organization_id, venue_id),
  KEY ix_table_adjacencies_high (venue_id, high_table_id, low_table_id),
  CONSTRAINT fk_table_adjacencies_venue FOREIGN KEY (organization_id, venue_id)
    REFERENCES venues (organization_id, id),
  CONSTRAINT fk_table_adjacencies_low FOREIGN KEY (venue_id, low_table_id)
    REFERENCES dining_tables (venue_id, id),
  CONSTRAINT fk_table_adjacencies_high FOREIGN KEY (venue_id, high_table_id)
    REFERENCES dining_tables (venue_id, id),
  CONSTRAINT fk_table_adjacencies_created_by FOREIGN KEY (created_by_user_id) REFERENCES users (id),
  CONSTRAINT ck_table_adjacencies_order CHECK (low_table_id < high_table_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- No operational adjacency data is inserted here. Approved edges must be configured per venue.
