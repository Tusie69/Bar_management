import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";

import { hashPassword } from "../../src/auth/password.js";
import "dotenv/config";

// This fixture truncates and deletes rows, so it must never touch a database
// that is not disposable: the name must carry the `_test` suffix the whole repo
// uses for throwaway databases, and the server must be this machine.
//
// The port is deliberately not checked. It says nothing about whether a
// database is disposable, and pinning one (33306) made the guard reject the
// very targets this suite and its own F11 case pass in on the default port
// (3306), so no run could get past the fixture. Read from `process.env` rather
// than the env config so this guard throws before config validation does.
const databaseName = process.env.DB_NAME ?? "";
const databaseHost = process.env.DB_HOST ?? "";
const mode = process.argv[2];
if (!/_test$/.test(databaseName) || databaseHost !== "127.0.0.1")
  throw new Error(`Refusing E2E fixture: "${databaseName}" on "${databaseHost}" is not a disposable local test database`);
if (!["setup", "cleanup", "verify-clean", "verify-phone-audit", "inject-historical-note", "verify-historical-note", "set-quick-times", "revoke-permissions", "restore-permissions", "setup-case2-pure-hold", "cleanup-case2-pure-hold", "cleanup-today-arrival", "snapshot-entities", "cleanup-entities", "verify-target", "set-booking-time"].includes(mode ?? ""))
  throw new Error("Unsupported E2E fixture command");

const { databasePool } = await import("../../src/database/pool.js");

const organizationId = 1;
const venueId = 1;
const userId = 9501;
const membershipId = 9501;
const historicalNote = "Khách dặn gọi 0987 654 321 khi tới";

type EntityIds = { bookingIds?: number[]; entryIds?: number[]; holdIds?: number[]; visitIds?: number[] };
const entityIdKeys = ["bookingIds", "entryIds", "holdIds", "visitIds"] as const;
function entityIds(raw: string | undefined): EntityIds {
  const parsed: unknown = JSON.parse(raw ?? "{}");
  const reject = () => {
    throw new Error("Explicit case entity IDs are required");
  };
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) reject();
  const source = parsed as Record<string, unknown>;
  const ids: EntityIds = {};
  for (const key of Object.keys(source)) {
    const known = entityIdKeys.find((candidate) => candidate === key);
    const value = source[key];
    if (!known || !Array.isArray(value) ||
        (value as unknown[]).some((id) => typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0))
      reject();
    ids[known as (typeof entityIdKeys)[number]] = value as number[];
  }
  if (!entityIdKeys.some((key) => ids[key]?.length)) reject();
  return ids;
}
const inIds = (ids: number[] = []) => (ids.length ? ids : [0]).map(() => "?").join(",");
const values = (ids: number[] = []) => ids.length ? ids : [0];
async function snapshotEntities(ids: EntityIds) {
  const scope = [organizationId, venueId];
  const [bookings] = await databasePool.execute<RowDataPacket[]>(
    `SELECT id, status, version, visit_id, business_date FROM reservations WHERE organization_id=? AND venue_id=? AND id IN (${inIds(ids.bookingIds)})`,
    [...scope, ...values(ids.bookingIds)]);
  const [entries] = await databasePool.execute<RowDataPacket[]>(
    `SELECT id, status, version, reservation_id, visit_id, business_date FROM waitlist_entries WHERE organization_id=? AND venue_id=? AND (id IN (${inIds(ids.entryIds)}) OR reservation_id IN (${inIds(ids.bookingIds)}))`,
    [...scope, ...values(ids.entryIds), ...values(ids.bookingIds)]);
  const entryIds = entries.map((row) => Number(row.id));
  const [holds] = await databasePool.execute<RowDataPacket[]>(
    `SELECT id, hold_kind, status, version, reservation_id, waitlist_entry_id, converted_visit_id FROM table_holds WHERE organization_id=? AND venue_id=? AND (id IN (${inIds(ids.holdIds)}) OR reservation_id IN (${inIds(ids.bookingIds)}) OR waitlist_entry_id IN (${inIds(entryIds)}))`,
    [...scope, ...values(ids.holdIds), ...values(ids.bookingIds), ...values(entryIds)]);
  const holdIds = holds.map((row) => Number(row.id));
  const visitIds = [...new Set([...(ids.visitIds ?? []), ...bookings.map((r) => Number(r.visit_id)), ...entries.map((r) => Number(r.visit_id)), ...holds.map((r) => Number(r.converted_visit_id))].filter(Boolean))];
  const [visits] = await databasePool.execute<RowDataPacket[]>(
    `SELECT id, version, ended_at FROM visits WHERE organization_id=? AND venue_id=? AND id IN (${inIds(visitIds)})`, [...scope, ...values(visitIds)]);
  const [allocations] = await databasePool.execute<RowDataPacket[]>(
    `SELECT id, table_id, kind, hold_id, visit_id, group_id, released_at FROM table_allocations WHERE organization_id=? AND venue_id=? AND (hold_id IN (${inIds(holdIds)}) OR visit_id IN (${inIds(visitIds)})) ORDER BY id`,
    [...scope, ...values(holdIds), ...values(visitIds)]);
  const groupIds = [...new Set(allocations.map((r) => Number(r.group_id)).filter(Boolean))];
  const [groups] = await databasePool.execute<RowDataPacket[]>(
    `SELECT id, symbol_no, dissolved_at FROM table_groups WHERE organization_id=? AND venue_id=? AND id IN (${inIds(groupIds)})`, [...scope, ...values(groupIds)]);
  const snapshot = { bookings, entries, holds, visits, allocations, groups };
  for (const rows of Object.values(snapshot)) for (const row of rows) for (const key of Object.keys(row))
    if ((key === "id" || key.endsWith("_id") || key === "version" || key === "symbol_no") && row[key] !== null) row[key] = Number(row[key]);
  return snapshot;
}
async function cleanupEntities(ids: EntityIds) {
  const snapshot = await snapshotEntities(ids);
  const scopedDelete = async (table: string, key: string, owned: number[]) => {
    if (owned.length) await databasePool.execute(`DELETE FROM ${table} WHERE organization_id=? AND venue_id=? AND ${key} IN (${inIds(owned)})`, [organizationId, venueId, ...owned]);
  };
  await scopedDelete("table_allocations", "id", snapshot.allocations.map((r) => Number(r.id)));
  // C1: membership rows reference the group, so they go before it.
  await scopedDelete("table_group_members", "group_id", snapshot.groups.map((r) => Number(r.id)));
  await scopedDelete("table_groups", "id", snapshot.groups.map((r) => Number(r.id)));
  await scopedDelete("table_holds", "id", snapshot.holds.map((r) => Number(r.id)));
  const entryIds = snapshot.entries.map((r) => Number(r.id));
  await scopedDelete("waitlist_table_preferences", "entry_id", entryIds);
  await scopedDelete("waitlist_contact_attempts", "entry_id", entryIds);
  await scopedDelete("waitlist_entries", "id", entryIds);
  await scopedDelete("booking_call_logs", "reservation_id", snapshot.bookings.map((r) => Number(r.id)));
  await scopedDelete("reservations", "id", snapshot.bookings.map((r) => Number(r.id)));
  await scopedDelete("visits", "id", snapshot.visits.map((r) => Number(r.id)));
}

async function injectHistoricalNote(guestName: string | undefined) {
  if (!guestName) throw new Error("Historical-note guest name is required");
  const [result] = await databasePool.execute<ResultSetHeader>(
    `UPDATE reservations SET note = ?
     WHERE organization_id = ? AND venue_id = ? AND contact_name = ?`,
    [historicalNote, organizationId, venueId, guestName],
  );
  if (result.affectedRows !== 1) throw new Error("Historical-note fixture did not match exactly one booking");
  console.log("historical-note-injected=1");
}

async function verifyHistoricalNote(guestName: string | undefined) {
  if (!guestName) throw new Error("Renamed historical-note guest is required");
  const [rows] = await databasePool.execute<(RowDataPacket & { note: string })[]>(
    `SELECT note FROM reservations
     WHERE organization_id = ? AND venue_id = ? AND contact_name = ?`,
    [organizationId, venueId, guestName],
  );
  if (rows.length !== 1 || rows[0]?.note !== historicalNote) {
    throw new Error("Editing another field overwrote the historical note");
  }
  console.log("historical-note-preserved=1");
}

async function cleanup() {
  const statements = [
    "DELETE FROM operation_log WHERE organization_id = ?",
    "DELETE FROM table_allocations WHERE organization_id = ?",
    "DELETE FROM table_group_members WHERE organization_id = ?",
    "DELETE FROM table_groups WHERE organization_id = ?",
    "DELETE FROM table_holds WHERE organization_id = ?",
    "DELETE FROM waitlist_table_preferences WHERE organization_id = ?",
    "DELETE FROM waitlist_contact_attempts WHERE organization_id = ?",
    "DELETE FROM waitlist_entries WHERE organization_id = ?",
    "DELETE FROM booking_call_logs WHERE organization_id = ?",
    "DELETE FROM reservations WHERE organization_id = ?",
    "DELETE FROM visits WHERE organization_id = ?",
    "DELETE FROM customers WHERE organization_id = ?",
    "DELETE FROM auth_sessions WHERE user_id = ?",
    "DELETE FROM membership_roles WHERE organization_id = ?",
    "DELETE FROM memberships WHERE organization_id = ?",
    "DELETE FROM idempotency_keys WHERE organization_id = ?",
    "DELETE FROM table_adjacencies WHERE organization_id = ?",
    "DELETE FROM users WHERE id = ?",
    "DELETE FROM dining_tables WHERE organization_id = ?",
    "DELETE FROM zones WHERE organization_id = ?",
    "DELETE FROM floors WHERE organization_id = ?",
    "DELETE FROM booking_sources WHERE organization_id = ?",
    "DELETE FROM venue_settings WHERE organization_id = ?",
    "DELETE FROM venues WHERE organization_id = ?",
    "DELETE FROM organizations WHERE id = ?",
  ];
  for (const statement of statements) {
    const id =
      statement.includes("user_id = ?") ||
      statement.includes("users WHERE id = ?")
        ? userId
        : organizationId;
    await databasePool.execute(statement, [id]);
  }
}

async function verifyClean() {
  const [rows] = await databasePool.execute<
    (RowDataPacket & { total: number })[]
  >(
    `SELECT
      (SELECT COUNT(*) FROM organizations WHERE id = ?) +
      (SELECT COUNT(*) FROM users WHERE id = ?) +
      (SELECT COUNT(*) FROM memberships WHERE id = ?) +
      (SELECT COUNT(*) FROM auth_sessions WHERE user_id = ?) +
      (SELECT COUNT(*) FROM waitlist_entries WHERE organization_id = ?) +
      (SELECT COUNT(*) FROM reservations WHERE organization_id = ?) +
      (SELECT COUNT(*) FROM table_groups WHERE organization_id = ?) +
      (SELECT COUNT(*) FROM table_adjacencies WHERE organization_id = ?) AS total`,
    [organizationId, userId, membershipId, userId, organizationId, organizationId, organizationId, organizationId],
  );
  if (Number(rows[0]?.total) !== 0)
    throw new Error("E2E fixture cleanup verification failed");
  console.log("phase2b-e2e-clean=0");
}

async function verifyPhoneAudit() {
  const [rows] = await databasePool.execute<
    (RowDataPacket & { total: number; unsafe: number })[]
  >(
    `SELECT COUNT(*) AS total,
       SUM(CASE WHEN JSON_SEARCH(changes, 'one', '+84987654321') IS NOT NULL THEN 1 ELSE 0 END) AS unsafe
     FROM operation_log WHERE organization_id = ? AND action = 'CUSTOMER_PHONE_REVEAL'`,
    [organizationId],
  );
  if (Number(rows[0]?.total) !== 0 || Number(rows[0]?.unsafe) !== 0)
    throw new Error("Denied phone reveal unexpectedly created an audit record");
  console.log(`phone-reveal-audit=${Number(rows[0]?.total)};plaintext=0`);
}

async function setup() {
  const username = process.env.E2E_USERNAME;
  const password = process.env.E2E_PASSWORD;
  if (!username || !password || password.length < 20)
    throw new Error("Ephemeral E2E credentials are required");
  await cleanup();
  const passwordHash = await hashPassword(password);
  await databasePool.execute(
    "INSERT INTO organizations (id, code, name) VALUES (?, ?, ?)",
    [organizationId, "E2E", "Phase 2B E2E"],
  );
  await databasePool.execute(
    `INSERT INTO venues
      (id, organization_id, code, name, timezone, business_day_start_local, business_day_cutoff_local)
     VALUES (?, ?, 'E2E', '21GAM E2E', 'Asia/Ho_Chi_Minh', '17:00:00', '05:00:00')`,
    [venueId, organizationId],
  );
  await databasePool.execute(
    `INSERT INTO users (id, username, display_name, password_hash, status)
     VALUES (?, ?, 'Lễ tân E2E', ?, 'ACTIVE')`,
    [userId, username, passwordHash],
  );
  await databasePool.execute(
    `INSERT INTO memberships (id, organization_id, user_id, status) VALUES (?, ?, ?, 'ACTIVE')`,
    [membershipId, organizationId, userId],
  );
  await databasePool.execute(
    `INSERT INTO membership_roles (organization_id, membership_id, role_id, venue_id)
     SELECT ?, ?, id, ? FROM roles WHERE code = 'RECEPTIONIST'`,
    [organizationId, membershipId, venueId],
  );
  await databasePool.execute(
    `INSERT INTO zones (id, organization_id, venue_id, code, name, sort_order)
     VALUES (9501, ?, ?, 'A', 'Khu A', 1), (9502, ?, ?, 'B', 'Khu B', 2)`,
    [organizationId, venueId, organizationId, venueId],
  );
  await databasePool.execute(
    `INSERT INTO dining_tables
      (id, organization_id, venue_id, zone_id, code, display_name, kind, capacity, seq_no, pos_x, pos_y, width, height)
     VALUES
       (9501, ?, ?, 9501, 'A1', 'Bàn A1', 'TABLE', 4, NULL, 100, 100, 60, 40),
       (9502, ?, ?, 9501, 'A2', 'Bàn A2', 'TABLE', 4, NULL, 200, 100, 60, 40),
       (9503, ?, ?, 9501, 'A10', 'Bàn A10', 'TABLE', 4, NULL, 300, 100, 60, 40),
       (9504, ?, ?, 9501, 'A3', 'Bàn A3', 'TABLE', 4, NULL, 400, 100, 60, 40),
       (9505, ?, ?, 9501, 'A4', 'Bàn A4', 'TABLE', 4, NULL, 250, 180, 60, 40),
       (9513, ?, ?, 9501, 'A5', 'Bàn A5', 'TABLE', 4, NULL, 100, 180, 60, 40),
       (9514, ?, ?, 9501, 'A6', 'Bàn A6', 'TABLE', 4, NULL, 500, 100, 60, 40),
       (9506, ?, ?, 9502, 'B3', 'Bàn B3', 'TABLE', 4, NULL, 500, 200, 60, 40),
       (9507, ?, ?, 9502, 'B4', 'Bàn B4', 'TABLE', 4, NULL, 580, 200, 60, 40),
       (9511, ?, ?, 9502, 'B5', 'Bàn B5', 'TABLE', 4, NULL, 500, 280, 60, 40),
       (9512, ?, ?, 9502, 'B6', 'Bàn B6', 'TABLE', 4, NULL, 580, 280, 60, 40),
       (9508, ?, ?, 9501, 'BAR11', 'Ghế Bar 11', 'BAR_SEAT', 1, 11, 100, 260, 32, 32),
       (9509, ?, ?, 9501, 'BAR12', 'Ghế Bar 12', 'BAR_SEAT', 1, 12, 150, 260, 32, 32),
       (9510, ?, ?, 9501, 'BAR13', 'Ghế Bar 13', 'BAR_SEAT', 1, 13, 200, 260, 32, 32)`,
    [
      organizationId,
      venueId,
      organizationId,
      venueId,
      organizationId,
      venueId,
      organizationId,
      venueId,
      organizationId,
      venueId,
      organizationId,
      venueId,
      organizationId,
      venueId,
      organizationId,
      venueId,
      organizationId,
      venueId,
      organizationId,
      venueId,
      organizationId,
      venueId,
      organizationId,
      venueId,
      organizationId,
      venueId,
      organizationId,
      venueId,
    ],
  );
  await databasePool.execute(
    "UPDATE dining_tables SET is_spare = 1 WHERE id = 9503",
  );
  await databasePool.execute(
    "UPDATE dining_tables SET status = 'OUT_OF_SERVICE' WHERE id = 9504",
  );
  await databasePool.execute(
    `INSERT INTO booking_sources (id, organization_id, code, name, sort_order)
     VALUES (9501, ?, 'HOTLINE', 'Hotline', 1), (9502, ?, 'OTHER', 'Khác', 2)`,
    [organizationId, organizationId],
  );
  console.log("phase2b-e2e-fixture=ready");
}

try {
  if (mode === "verify-target") console.log("fixture-target-approved=1");
  else if (mode === "snapshot-entities") console.log("entity-snapshot=" + JSON.stringify(await snapshotEntities(entityIds(process.argv[3]))));
  else if (mode === "cleanup-entities" || mode === "cleanup-today-arrival") {
    await cleanupEntities(entityIds(process.argv[3]));
    console.log("entities-cleaned=1");
  }
  else if (mode === "set-booking-time") {
    const id = Number(process.argv[3]);
    const expectedAt = new Date(process.argv[4] ?? "");
    if (!Number.isSafeInteger(id) || id <= 0 || !Number.isFinite(expectedAt.getTime())) throw new Error("Invalid booking time fixture");
    const [updated] = await databasePool.execute<ResultSetHeader>("UPDATE reservations SET expected_at=? WHERE organization_id=? AND venue_id=? AND id=? AND status='BOOKED'", [expectedAt, organizationId, venueId, id]);
    if (updated.affectedRows !== 1) throw new Error("Booking time fixture must match one owned booking");
  }
  else if (mode === "setup") await setup();
  else if (mode === "cleanup") await cleanup();
  else if (mode === "verify-clean") await verifyClean();
  else if (mode === "verify-phone-audit") await verifyPhoneAudit();
  else if (mode === "set-quick-times") {
    const quickTimes = process.argv[3];
    if (!quickTimes) throw new Error("Missing quick-times JSON");
    await databasePool.execute(
      "INSERT INTO venue_settings (organization_id, venue_id, `key`, value) VALUES (?, ?, 'quick_times', ?) ON DUPLICATE KEY UPDATE value = ?",
      [organizationId, venueId, quickTimes, quickTimes],
    );
  }
  else if (mode === "revoke-permissions") {
    await databasePool.execute(
      `DELETE rp FROM role_permissions AS rp
       JOIN roles AS r ON r.id = rp.role_id
       JOIN permissions AS p ON p.id = rp.permission_id
       WHERE r.code = 'RECEPTIONIST' AND p.code IN ('table.assign', 'visit.checkin')`,
    );
    console.log("permissions-revoked=1");
  } else if (mode === "restore-permissions") {
    await databasePool.execute(
      `INSERT IGNORE INTO role_permissions (role_id, permission_id)
       SELECT r.id, p.id FROM roles AS r JOIN permissions AS p
       WHERE r.code = 'RECEPTIONIST' AND p.code IN ('table.assign', 'visit.checkin')`,
    );
    console.log("permissions-restored=1");
  } else if (mode === "setup-case2-pure-hold") {
    const tableCode = process.argv[3] ?? "B3";
    const date = process.argv[4] ?? "2026-11-04";
    const [tRows] = await databasePool.execute<(RowDataPacket & { id: number })[]>(
      "SELECT id FROM dining_tables WHERE organization_id = ? AND venue_id = ? AND code = ?",
      [organizationId, venueId, tableCode],
    );
    const tableId = tRows[0]?.id;
    if (!tableId) throw new Error(`Table ${tableCode} not found`);


    await databasePool.execute(
      `INSERT INTO waitlist_entries
        (id, organization_id, venue_id, kind, contact_name, party_size, contact_channel, business_date, queued_at, status, created_by_user_id)
       VALUES
        (9988, ?, ?, 'WALK_IN', 'Khách Vãng Lai Case 2', 2, 'IN_PERSON', ?, UTC_TIMESTAMP(3), 'HOLD_ACTIVE', ?)`,
      [organizationId, venueId, date, userId],
    );
    await databasePool.execute(
      `INSERT INTO table_holds
        (id, organization_id, venue_id, hold_kind, waitlist_entry_id, status, starts_at, customer_confirmed_at, deadline_at, deadline_basis, default_minutes_snapshot, created_by_user_id)
       VALUES
        (9988, ?, ?, 'WAITLIST_OFFER', 9988, 'ACTIVE', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), UTC_TIMESTAMP(3) + INTERVAL 15 MINUTE, 'DEFAULT', 15, ?)`,
      [organizationId, venueId, userId],
    );
    await databasePool.execute(
      `INSERT INTO table_allocations
        (organization_id, venue_id, table_id, kind, hold_id, business_date, starts_at, created_by_user_id)
       VALUES
        (?, ?, ?, 'HOLD', 9988, ?, UTC_TIMESTAMP(3), ?)`,
      [organizationId, venueId, tableId, date, userId],
    );
    const linkedBookingId = Number(process.argv[5] ?? 0);
    if (linkedBookingId) {
      const [linked] = await databasePool.execute<RowDataPacket[]>("SELECT id FROM reservations WHERE organization_id=? AND venue_id=? AND id=?", [organizationId, venueId, linkedBookingId]);
      if (linked.length !== 1) throw new Error("Linked booking not found in fixture scope");
      await databasePool.execute("UPDATE waitlist_entries SET kind='ADVANCE_RESERVATION', reservation_id=?, contact_name=NULL, party_size=NULL WHERE organization_id=? AND venue_id=? AND id=9988", [linkedBookingId, organizationId, venueId]);
    }
    console.log(`case2-hold-ready=${tableCode}`);
  } else if (mode === "cleanup-case2-pure-hold") {
    await databasePool.execute("DELETE FROM table_allocations WHERE organization_id = ? AND venue_id = ? AND hold_id = 9988", [organizationId, venueId]);
    await databasePool.execute("DELETE FROM table_holds WHERE organization_id = ? AND venue_id = ? AND id = 9988", [organizationId, venueId]);
    await databasePool.execute("DELETE FROM waitlist_entries WHERE organization_id = ? AND venue_id = ? AND id = 9988", [organizationId, venueId]);
    console.log("case2-hold-cleaned=1");

  }
  else if (mode === "inject-historical-note") await injectHistoricalNote(process.argv[3]);
  else await verifyHistoricalNote(process.argv[3]);
} finally {
  await databasePool.end();
}
