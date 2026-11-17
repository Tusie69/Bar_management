-- migrate:up transaction:false
-- Let receptionists mark/unmark idle spare tables without granting venue configuration.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

INSERT INTO permissions (code, description, is_sensitive)
VALUES ('table.spare.configure', 'Đặt hoặc bỏ trạng thái bàn sơ cua', 0);

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles AS r
JOIN permissions AS p ON p.code = 'table.spare.configure'
WHERE r.code IN ('OWNER', 'ADMIN', 'RECEPTIONIST');

-- migrate:down
-- irreversible: migrations are forward-only. Restore a backup or fix forward.
