-- BD-07: only OWNER_ADMIN may reveal a booking phone number.
-- Keep 0004_reservation_customer_classification.sql unchanged; this is a forward-only policy migration.
DELETE rp FROM role_permissions AS rp
JOIN roles AS r ON r.id = rp.role_id
JOIN permissions AS p ON p.id = rp.permission_id
WHERE r.code = 'RECEPTIONIST' AND p.code = 'booking.phone.reveal';
