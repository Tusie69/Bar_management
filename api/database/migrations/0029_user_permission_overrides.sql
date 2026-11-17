-- TU-34: quyền riêng từng tài khoản (Trang Quản trị · 02 Tài khoản & phân quyền).
--
-- Bảng này KHÔNG cấp quyền. Nó chỉ tắt bớt quyền mà vai trò đã cho:
--
--   effective = role_permissions(role, access_level) ∩ enabled_overrides
--
-- Vì sao không cho override nâng quyền: nếu một hàng trong bảng này cấp thêm
-- được, thì mọi suy luận "vai trò X làm được gì" phải đọc thêm bảng này ở mọi
-- chỗ, và một lần bấm nhầm checkbox sẽ cấp quyền thu tiền cho Lễ tân. Giao
-- điểm giữ ma trận vai trò làm trần cứng, bảng này chỉ hạ xuống.
--
-- Không có hàng nào cho một tài khoản = tài khoản đó giữ nguyên quyền vai trò.

CREATE TABLE user_permission_overrides (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id    BIGINT UNSIGNED NOT NULL,
  user_id            BIGINT UNSIGNED NOT NULL,
  permission_id      BIGINT UNSIGNED NOT NULL,
  -- 0 = tắt quyền này cho riêng tài khoản. 1 = để nguyên theo vai trò (hàng
  -- vẫn lưu để biết ai đã bật lại và lúc nào).
  is_enabled         TINYINT(1) NOT NULL DEFAULT 1,
  updated_by_user_id BIGINT UNSIGNED NULL,
  created_at         DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  updated_at         DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (id),
  UNIQUE KEY uq_user_permission_overrides (organization_id, user_id, permission_id),
  KEY ix_user_permission_overrides_user (user_id),
  CONSTRAINT fk_upo_org        FOREIGN KEY (organization_id) REFERENCES organizations (id),
  CONSTRAINT fk_upo_user       FOREIGN KEY (user_id)         REFERENCES users (id),
  CONSTRAINT fk_upo_permission FOREIGN KEY (permission_id)   REFERENCES permissions (id),
  CONSTRAINT fk_upo_actor      FOREIGN KEY (updated_by_user_id) REFERENCES users (id),
  CONSTRAINT ck_upo_is_enabled CHECK (is_enabled IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Mật khẩu tạm: tài khoản mới và tài khoản vừa được reset phải đổi mật khẩu
-- trước khi dùng được API nghiệp vụ. Mặc định 0 để mọi tài khoản đang đăng
-- nhập giữa ca không bị chặn ngay khi migration chạy.
ALTER TABLE users
  ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 0 AFTER status,
  ADD CONSTRAINT ck_users_must_change_password CHECK (must_change_password IN (0, 1));

-- migrate:down
-- irreversible: migrations are forward-only. Restore a backup or fix forward.
