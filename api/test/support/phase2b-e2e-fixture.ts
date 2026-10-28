import type { RowDataPacket } from "mysql2/promise";

import { hashPassword } from "../../src/auth/password.js";
import { env } from "../../src/config/env.js";
import { databasePool } from "../../src/database/pool.js";

const mode = process.argv[2];
if (!/_test$/.test(env.database.name))
  throw new Error("Refusing E2E fixture: DB_NAME must end in _test");
if (!["setup", "cleanup", "verify-clean"].includes(mode ?? ""))
  throw new Error("Expected setup, cleanup, or verify-clean");

const organizationId = 1;
const venueId = 1;
const userId = 9501;
const membershipId = 9501;

async function cleanup() {
  const statements = [
    "DELETE FROM operation_log WHERE organization_id = ?",
    "DELETE FROM table_allocations WHERE organization_id = ?",
    "DELETE FROM table_holds WHERE organization_id = ?",
    "DELETE FROM reservations WHERE organization_id = ?",
    "DELETE FROM visits WHERE organization_id = ?",
    "DELETE FROM customers WHERE organization_id = ?",
    "DELETE FROM auth_sessions WHERE user_id = ?",
    "DELETE FROM membership_roles WHERE organization_id = ?",
    "DELETE FROM memberships WHERE organization_id = ?",
    "DELETE FROM users WHERE id = ?",
    "DELETE FROM dining_tables WHERE organization_id = ?",
    "DELETE FROM zones WHERE organization_id = ?",
    "DELETE FROM floors WHERE organization_id = ?",
    "DELETE FROM booking_sources WHERE organization_id = ?",
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
      (SELECT COUNT(*) FROM reservations WHERE organization_id = ?) AS total`,
    [organizationId, userId, membershipId, userId, organizationId],
  );
  if (Number(rows[0]?.total) !== 0)
    throw new Error("E2E fixture cleanup verification failed");
  console.log("phase2b-e2e-clean=0");
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
    `INSERT INTO zones (id, organization_id, venue_id, code, name)
     VALUES (9501, ?, ?, 'A', 'Khu A')`,
    [organizationId, venueId],
  );
  await databasePool.execute(
    `INSERT INTO dining_tables
      (id, organization_id, venue_id, zone_id, code, display_name, kind, capacity, pos_x, pos_y, width, height)
     VALUES (9501, ?, ?, 9501, 'A1', 'Bàn A1', 'TABLE', 4, 100, 100, 60, 40)`,
    [organizationId, venueId],
  );
  await databasePool.execute(
    `INSERT INTO booking_sources (id, organization_id, code, name, sort_order)
     VALUES (9501, ?, 'HOTLINE', 'Hotline', 1)`,
    [organizationId],
  );
  console.log("phase2b-e2e-fixture=ready");
}

try {
  if (mode === "setup") await setup();
  else if (mode === "cleanup") await cleanup();
  else await verifyClean();
} finally {
  await databasePool.end();
}
