-- Centralize the pre-arrival floor threshold. Existing late/no-show values remain unchanged.
ALTER TABLE venues
  ADD COLUMN upcoming_warning_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 10
    AFTER business_day_cutoff_local,
  DROP CHECK ck_venues_warnings,
  ADD CONSTRAINT ck_venues_warnings CHECK (
    upcoming_warning_minutes BETWEEN 1 AND 240
    AND late_warning_minutes >= 1
    AND no_show_warning_minutes > late_warning_minutes
  );
