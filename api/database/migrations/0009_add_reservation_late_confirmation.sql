ALTER TABLE reservations
  ADD COLUMN late_confirmed_at DATETIME(3) NULL AFTER no_show_warned_at,
  ADD COLUMN late_confirmed_by_user_id BIGINT UNSIGNED NULL AFTER late_confirmed_at,
  ADD KEY ix_reservations_late_confirmed_by (late_confirmed_by_user_id),
  ADD CONSTRAINT fk_reservations_late_confirmed_by
    FOREIGN KEY (late_confirmed_by_user_id) REFERENCES users (id),
  ADD CONSTRAINT ck_reservations_late_confirmation
    CHECK (
      (late_confirmed_at IS NULL AND late_confirmed_by_user_id IS NULL)
      OR (late_confirmed_at IS NOT NULL AND late_confirmed_by_user_id IS NOT NULL)
    );
