CREATE TABLE customer_duplicate_dismissals (
  organization_id BIGINT UNSIGNED NOT NULL,
  source_customer_id BIGINT UNSIGNED NOT NULL,
  target_customer_id BIGINT UNSIGNED NOT NULL,
  dismissed_by_user_id BIGINT UNSIGNED NOT NULL,
  dismissed_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (organization_id, source_customer_id, target_customer_id),
  CONSTRAINT fk_duplicate_source FOREIGN KEY (organization_id, source_customer_id)
    REFERENCES customers (organization_id, id),
  CONSTRAINT fk_duplicate_target FOREIGN KEY (organization_id, target_customer_id)
    REFERENCES customers (organization_id, id),
  CONSTRAINT fk_duplicate_actor FOREIGN KEY (dismissed_by_user_id) REFERENCES users (id),
  CONSTRAINT ck_duplicate_distinct CHECK (source_customer_id <> target_customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO permissions (code, description, is_sensitive)
VALUES ('customer.history.manage', 'Gán lượt khuyết danh và xử lý hồ sơ trùng', 1);
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('OWNER', 'ADMIN') AND p.code = 'customer.history.manage';

-- migrate:down
-- Forward-only. Roll back application first; restore backup or fix forward.
-- Removing this table loses permanent dismissal decisions; preserve/export it first.
