-- TU-07/TU-08/TU-09: OWNER plus ADMIN access levels.
-- The OWNER_ADMIN row is renamed in place so its id, role grants and every
-- membership_roles foreign key remain unchanged.
UPDATE roles
SET code = 'OWNER', name = 'Chủ sở hữu'
WHERE code = 'OWNER_ADMIN';

ALTER TABLE membership_roles
  ADD COLUMN access_level VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER venue_id,
  ADD CONSTRAINT ck_membership_roles_access_level
    CHECK (access_level IS NULL OR access_level IN ('WRITE', 'READ_ONLY'));

INSERT INTO roles (code, name, is_system)
VALUES ('ADMIN', 'Quản trị viên', 1);

INSERT INTO permissions (code, description, is_sensitive)
VALUES ('user.read', 'Xem danh sách tài khoản trong phạm vi quản lý', 1);

-- OWNER keeps the complete historical permission set and gains account read.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles AS r
JOIN permissions AS p ON p.code = 'user.read'
WHERE r.code = 'OWNER';

-- ADMIN WRITE receives business write/read capabilities and delegated account
-- management, but never owner-only venue configuration or anonymization.
-- READ_ONLY uses the same role grants; the API filters mutation permissions by
-- membership_roles.access_level on every request.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles AS r
CROSS JOIN permissions AS p
WHERE r.code = 'ADMIN'
  AND p.code NOT IN ('venue.configure', 'customer.anonymize');

-- migrate:down
-- irreversible: migrations are forward-only. Restore a backup or fix forward.
