-- Additive only; existing reservations and legacy classification remain intact.
ALTER TABLE reservations
  ADD COLUMN guest_type VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'NEW',
  ADD COLUMN is_birthday TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN late_confirmed_at DATETIME(3) NULL DEFAULT NULL,
  ADD CONSTRAINT ck_reservations_guest_type CHECK (guest_type IN ('REGULAR','NEW')),
  ADD CONSTRAINT ck_reservations_birthday CHECK (is_birthday IN (0,1));

UPDATE reservations
SET guest_type = CASE WHEN customer_classification = 'RETURNING' THEN 'REGULAR' ELSE 'NEW' END;

-- Legacy classification is the storage authority; API writes both in the same statement.
ALTER TABLE reservations ADD CONSTRAINT ck_reservations_guest_classification CHECK (
  guest_type = CASE WHEN customer_classification = 'RETURNING' THEN 'REGULAR' ELSE 'NEW' END);

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

-- Preserve each venue's existing no-show policy, including a customized threshold.
INSERT INTO venue_settings (organization_id, venue_id, `key`, `value`)
SELECT organization_id, id, 'quick_times', JSON_ARRAY('21:00','21:30','22:00','22:30') FROM venues
ON DUPLICATE KEY UPDATE `value` = venue_settings.`value`;
INSERT INTO venue_settings (organization_id, venue_id, `key`, `value`)
SELECT organization_id, id, 'upcoming_minutes', CAST('10' AS JSON) FROM venues
ON DUPLICATE KEY UPDATE `value` = venue_settings.`value`;
INSERT INTO venue_settings (organization_id, venue_id, `key`, `value`)
SELECT organization_id, id, 'no_show_minutes', CAST(no_show_warning_minutes AS JSON) FROM venues
ON DUPLICATE KEY UPDATE `value` = venue_settings.`value`;
