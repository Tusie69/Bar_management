-- TU-07: bind every new server-side session to the portal authorized at login.
-- Existing sessions predate portal verification, so revoke them instead of guessing a portal.
ALTER TABLE auth_sessions
  ADD COLUMN portal VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER device_label,
  ADD KEY ix_auth_sessions_portal (portal),
  ADD CONSTRAINT ck_auth_sessions_portal
    CHECK (portal IS NULL OR portal IN ('admin','receptionist','customer-care','cashier'));

UPDATE auth_sessions
SET revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP(3)),
    revoke_reason = COALESCE(revoke_reason, 'PORTAL_MIGRATION')
WHERE portal IS NULL;

-- migrate:down
-- Forward-only. Removing portal binding would weaken session authorization.
