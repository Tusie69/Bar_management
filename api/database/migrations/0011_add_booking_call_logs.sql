CREATE TABLE booking_call_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id BIGINT UNSIGNED NOT NULL,
  venue_id BIGINT UNSIGNED NOT NULL,
  reservation_id BIGINT UNSIGNED NOT NULL,
  initiated_by_user_id BIGINT UNSIGNED NOT NULL,
  initiated_at DATETIME(3) NOT NULL,
  outcome VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NULL,
  outcome_by_user_id BIGINT UNSIGNED NULL,
  outcome_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY ix_booking_call_logs_reservation (organization_id, venue_id, reservation_id, initiated_at),
  KEY ix_booking_call_logs_initiated_by (initiated_by_user_id),
  KEY ix_booking_call_logs_outcome_by (outcome_by_user_id),
  CONSTRAINT fk_booking_call_logs_venue FOREIGN KEY (organization_id, venue_id)
    REFERENCES venues (organization_id, id),
  CONSTRAINT fk_booking_call_logs_reservation FOREIGN KEY (reservation_id)
    REFERENCES reservations (id),
  CONSTRAINT fk_booking_call_logs_initiated_by FOREIGN KEY (initiated_by_user_id)
    REFERENCES users (id),
  CONSTRAINT fk_booking_call_logs_outcome_by FOREIGN KEY (outcome_by_user_id)
    REFERENCES users (id),
  CONSTRAINT ck_booking_call_logs_outcome CHECK (
    outcome IS NULL OR outcome IN ('CONTACTED','NO_ANSWER','LATE_CONFIRMED')
  ),
  CONSTRAINT ck_booking_call_logs_outcome_fields CHECK (
    (outcome IS NULL AND outcome_by_user_id IS NULL AND outcome_at IS NULL)
    OR (outcome IS NOT NULL AND outcome_by_user_id IS NOT NULL AND outcome_at IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
