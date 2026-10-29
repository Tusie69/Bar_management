-- Phone belongs to the booking contact. It is intentionally not exposed by list/floor queries.
ALTER TABLE reservations
  ADD COLUMN phone_ciphertext VARBINARY(128) NULL AFTER contact_name_search,
  ADD COLUMN phone_key_id SMALLINT UNSIGNED NULL AFTER phone_ciphertext,
  ADD COLUMN phone_hmac BINARY(32) NULL AFTER phone_key_id,
  ADD COLUMN phone_hmac_key_id SMALLINT UNSIGNED NULL AFTER phone_hmac,
  ADD COLUMN phone_last3 CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER phone_hmac_key_id,
  ADD KEY ix_reservations_org_phone (organization_id, phone_hmac),
  ADD CONSTRAINT ck_reservations_phone_all_or_none CHECK (
    (phone_ciphertext IS NULL AND phone_key_id IS NULL AND phone_hmac IS NULL
      AND phone_hmac_key_id IS NULL AND phone_last3 IS NULL) OR
    (phone_ciphertext IS NOT NULL AND phone_key_id IS NOT NULL AND phone_hmac IS NOT NULL
      AND phone_hmac_key_id IS NOT NULL AND phone_last3 IS NOT NULL)),
  ADD CONSTRAINT ck_reservations_phone_last3 CHECK (phone_last3 IS NULL OR phone_last3 REGEXP '^[0-9]{3}$');

INSERT INTO permissions (code, description, is_sensitive)
VALUES ('booking.phone.reveal', 'Mở số điện thoại của booking để gọi khách', 1);

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles AS r
JOIN permissions AS p ON p.code = 'booking.phone.reveal'
WHERE r.code IN ('OWNER_ADMIN', 'RECEPTIONIST');

