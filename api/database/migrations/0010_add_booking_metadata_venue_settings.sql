-- NA-14 metadata added after the existing table-state and TU-12 migrations.
-- Preserve the legacy UNCLASSIFIED default: guest_type stays NULL unless the
-- booking has an explicit NEW/RETURNING classification.
ALTER TABLE reservations
  ADD COLUMN guest_type VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NULL DEFAULT NULL
    AFTER customer_classification,
  ADD COLUMN is_birthday TINYINT(1) NOT NULL DEFAULT 0
    AFTER guest_type,
  ADD CONSTRAINT ck_reservations_guest_type
    CHECK (guest_type IS NULL OR guest_type IN ('REGULAR','NEW')),
  ADD CONSTRAINT ck_reservations_birthday
    CHECK (is_birthday IN (0,1));

UPDATE reservations
SET guest_type = CASE customer_classification
  WHEN 'RETURNING' THEN 'REGULAR'
  WHEN 'NEW' THEN 'NEW'
  ELSE NULL
END;

ALTER TABLE reservations
  ADD CONSTRAINT ck_reservations_guest_classification
  CHECK (
    (customer_classification = 'RETURNING' AND guest_type = 'REGULAR')
    OR (customer_classification = 'NEW' AND guest_type = 'NEW')
    OR (customer_classification IN ('UNCLASSIFIED') AND guest_type IS NULL)
    OR (customer_classification IS NULL AND guest_type IS NULL)
  );

-- Only UI-oriented settings live here. Timing thresholds remain authoritative
-- on venues so the table-state engine and atomic floor projection have one source.
CREATE TABLE venue_settings (
  organization_id BIGINT UNSIGNED NOT NULL,
  venue_id BIGINT UNSIGNED NOT NULL,
  `key` VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `value` JSON NOT NULL,
  PRIMARY KEY (venue_id, `key`),
  KEY ix_venue_settings_org_venue (organization_id, venue_id),
  CONSTRAINT fk_venue_settings_venue FOREIGN KEY (organization_id, venue_id)
    REFERENCES venues (organization_id, id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO venue_settings (organization_id, venue_id, `key`, `value`)
SELECT organization_id, id, 'quick_times', JSON_ARRAY('21:00','21:30','22:00','22:30')
FROM venues;
