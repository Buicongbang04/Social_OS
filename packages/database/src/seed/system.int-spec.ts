import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PERMISSIONS,
  WORKSPACE_ROLES,
  WORKSPACE_ROLE_PERMISSIONS,
} from "@repo/domain";
import type { DatabaseClient } from "../client";
import { closeDbClient, createDbClient } from "../client";
import { permissions, rolePermissions, roles } from "../schema";
import { seedSystemData } from "./system";

/**
 * Drift test: the database is the runtime source of truth for authorization,
 * @repo/domain is the compile-time one. If they disagree, a permission check
 * could pass in code and fail in production (or worse, the reverse).
 *
 * Requires the local Postgres from docker/docker-compose.yml. Run with:
 *   DATABASE_URL=... pnpm --filter @repo/database test:int
 */
const connectionString = process.env.DATABASE_URL;

describe.skipIf(!connectionString)("seedSystemData (integration)", () => {
  let db: DatabaseClient;

  beforeAll(async () => {
    db = createDbClient(connectionString!, { maxConnections: 1 });
    await seedSystemData(db);
  });

  afterAll(async () => {
    if (db) await closeDbClient(db);
  });

  it("mirrors every catalog permission into the database", async () => {
    const rows = await db.select({ key: permissions.key }).from(permissions);
    const inDatabase = new Set<string>(rows.map((row) => row.key));
    const inCode = new Set<string>(
      PERMISSIONS.map((permission) => permission.key),
    );

    expect([...inCode].filter((key) => !inDatabase.has(key))).toEqual([]);
    expect([...inDatabase].filter((key) => !inCode.has(key))).toEqual([]);
  });

  it("mirrors every workspace role", async () => {
    const rows = await db.select({ key: roles.key }).from(roles);
    expect(new Set(rows.map((row) => row.key))).toEqual(
      new Set(WORKSPACE_ROLES),
    );
  });

  it("mirrors the role→permission matrix exactly", async () => {
    const rows = await db
      .select({
        roleKey: rolePermissions.roleKey,
        permissionKey: rolePermissions.permissionKey,
      })
      .from(rolePermissions);

    const inDatabase = new Set(
      rows.map((row) => `${row.roleKey}:${row.permissionKey}`),
    );
    const inCode = new Set(
      WORKSPACE_ROLES.flatMap((role) =>
        WORKSPACE_ROLE_PERMISSIONS[role].map(
          (permission) => `${role}:${permission}`,
        ),
      ),
    );

    expect(inDatabase).toEqual(inCode);
  });

  it("is idempotent — re-seeding changes nothing", async () => {
    const before = await db.select().from(rolePermissions);
    await seedSystemData(db);
    const after = await db.select().from(rolePermissions);

    expect(after.length).toBe(before.length);
  });
});
