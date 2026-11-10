-- The API must clear social_platform when the source is not SOCIAL;
-- a CHECK cannot read the source code through the booking_sources foreign key.
ALTER TABLE reservations
  ADD COLUMN is_boss_table TINYINT(1) NOT NULL DEFAULT 0
    AFTER is_birthday,
  ADD COLUMN is_designated TINYINT(1) NOT NULL DEFAULT 0
    AFTER is_boss_table,
  ADD COLUMN social_platform VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL DEFAULT NULL
    AFTER is_designated,
  ADD COLUMN honorific VARCHAR(2) CHARACTER SET ascii COLLATE ascii_bin NULL DEFAULT NULL
    AFTER social_platform,
  ADD CONSTRAINT ck_reservations_boss_table
    CHECK (is_boss_table IN (0,1)),
  ADD CONSTRAINT ck_reservations_designated
    CHECK (is_designated IN (0,1)),
  ADD CONSTRAINT ck_reservations_social_platform
    CHECK (social_platform IS NULL OR social_platform IN ('FB','IG','TIKTOK','THREADS','GG_REVIEW')),
  ADD CONSTRAINT ck_reservations_honorific
    CHECK (honorific IS NULL OR honorific IN ('MR','MS'));
