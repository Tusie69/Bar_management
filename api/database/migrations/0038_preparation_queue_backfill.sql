-- migrate:up transaction:false
-- Backfill ticket Module 3 đã tồn tại trước khi 0037 được triển khai.
-- Tách migration vì 0037 đã được áp dụng; không sửa checksum lịch sử.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

INSERT INTO preparation_ticket_events
  (organization_id, venue_id, ticket_id, station, from_status, to_status,
   ticket_version, actor_user_id, actor_membership_id, idempotency_key, occurred_at)
SELECT t.organization_id, t.venue_id, t.id, t.station, NULL, 'SUBMITTED',
       t.version, o.ordered_by_user_id, o.ordered_by_membership_id, o.idempotency_key, t.created_at
  FROM preparation_tickets t
  JOIN sales_orders o ON o.venue_id = t.venue_id AND o.id = t.order_id
  LEFT JOIN preparation_ticket_events e ON e.ticket_id = t.id AND e.ticket_version = t.version
 WHERE e.id IS NULL;

INSERT INTO preparation_print_outbox
  (organization_id, venue_id, ticket_id, station, created_at, updated_at)
SELECT t.organization_id, t.venue_id, t.id, t.station, t.created_at, UTC_TIMESTAMP(3)
  FROM preparation_tickets t
  LEFT JOIN preparation_print_outbox o ON o.ticket_id = t.id AND o.event_type = 'PRINT_TICKET'
 WHERE o.id IS NULL;

-- migrate:down
-- irreversible: migrations are forward-only. Restore a backup or fix forward.
