-- BA-023: calling is a separate capability from revealing a phone in normal APIs.
INSERT INTO permissions (code, description, is_sensitive)
VALUES ('booking.phone.call', 'Yêu cầu gọi khách qua trình gọi điện của thiết bị', 1);

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles AS r
JOIN permissions AS p ON p.code = 'booking.phone.call'
WHERE r.code IN ('OWNER_ADMIN', 'RECEPTIONIST');
