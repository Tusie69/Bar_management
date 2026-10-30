-- migrate:up transaction:false
-- GAM-APP / 21GAM - admin portal RBAC (diagram "Luồng A: đăng nhập theo cổng vai trò",
-- "Luồng B: tạo tài khoản, đổi quyền, khóa/mở", 29/10/2026).
--
-- Adds: SUPER_ADMIN and ADMIN_VIEWER roles (OWNER_ADMIN stays the editing Admin),
-- role -> login portal mapping (TU-07), who may create/lock which role, user.read and
-- admin.access.change permissions.
-- Already covered by 0001, no schema change: lock/unlock = users.status ACTIVE/DISABLED
-- (open sessions die because session lookup requires u.status = 'ACTIVE'), logout =
-- auth_sessions.revoked_at, permission changes apply on the next request (read live).
-- Pending PO, kept as data so they change without code: SuperAdmin portal, SuperAdmin
-- lock rights, whether Admin may create an Admin "Chỉ xem", OWNER_ADMIN on RECEPTION portal.

SET NAMES utf8mb4;

INSERT INTO roles (code, name, is_system) VALUES
  ('SUPER_ADMIN',  'Super Admin',     1),
  ('ADMIN_VIEWER', 'Admin (chỉ xem)', 1);

-- A role may open several portals; login is refused when none of the user's roles has the portal.
CREATE TABLE role_portals (
  role_id      BIGINT UNSIGNED NOT NULL,
  portal_code  VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (role_id, portal_code),
  CONSTRAINT fk_role_portals_role FOREIGN KEY (role_id) REFERENCES roles (id),
  CONSTRAINT ck_role_portals_portal CHECK (portal_code IN ('ADMIN','RECEPTION','CUSTOMER_CARE','CASHIER'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- grantor role may create accounts with, and lock/unlock accounts holding, the grantee role.
CREATE TABLE role_grant_rules (
  grantor_role_id  BIGINT UNSIGNED NOT NULL,
  grantee_role_id  BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (grantor_role_id, grantee_role_id),
  KEY ix_role_grant_rules_grantee (grantee_role_id),
  CONSTRAINT fk_role_grant_rules_grantor FOREIGN KEY (grantor_role_id) REFERENCES roles (id),
  CONSTRAINT fk_role_grant_rules_grantee FOREIGN KEY (grantee_role_id) REFERENCES roles (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO role_portals (role_id, portal_code)
SELECT r.id, x.portal_code
FROM roles r
JOIN (
  SELECT 'SUPER_ADMIN' AS role_code, 'ADMIN' AS portal_code
  UNION ALL SELECT 'OWNER_ADMIN',   'ADMIN'
  UNION ALL SELECT 'OWNER_ADMIN',   'RECEPTION'
  UNION ALL SELECT 'ADMIN_VIEWER',  'ADMIN'
  UNION ALL SELECT 'RECEPTIONIST',  'RECEPTION'
  UNION ALL SELECT 'CUSTOMER_CARE', 'CUSTOMER_CARE'
  UNION ALL SELECT 'CASHIER',       'CASHIER'
) x ON x.role_code = r.code;

-- SuperAdmin -> Admin (both levels); Admin -> Admin, staff. ADMIN_VIEWER grants nothing.
INSERT INTO role_grant_rules (grantor_role_id, grantee_role_id)
SELECT g.id, e.id
FROM roles g
JOIN roles e ON e.code IN ('OWNER_ADMIN','ADMIN_VIEWER')
WHERE g.code = 'SUPER_ADMIN'
UNION ALL
SELECT g.id, e.id
FROM roles g
JOIN roles e ON e.code IN ('OWNER_ADMIN','ADMIN_VIEWER','RECEPTIONIST','CUSTOMER_CARE','CASHIER')
WHERE g.code = 'OWNER_ADMIN';

INSERT INTO permissions (code, description, is_sensitive) VALUES
  ('user.read',           'Xem tài khoản nhân viên và quyền', 0),
  ('admin.access.change', 'Đổi quyền Admin giữa Sửa và Chỉ xem', 1);

-- Only SUPER_ADMIN switches an Admin between OWNER_ADMIN (Sửa) and ADMIN_VIEWER (Chỉ xem).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN ('user.read','user.manage','admin.access.change')
WHERE r.code = 'SUPER_ADMIN';

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'user.read'
WHERE r.code = 'OWNER_ADMIN';

-- ADMIN_VIEWER: read only, no sensitive permission; the API blocks every write.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN ('user.read','report.read','customer.view_masked')
WHERE r.code = 'ADMIN_VIEWER';

-- migrate:down
-- irreversible: migrations are forward-only (doc 10 §2). Fix forward or restore a backup.
