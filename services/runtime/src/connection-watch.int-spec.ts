import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { newId, type UserId, type WorkspaceId } from "@repo/core";
import {
  DrizzleSecretRepository,
  DrizzleSocialAccountRepository,
  closeDbClient,
  createDbClient,
  schemaTables,
  truncateTenantData,
  type DatabaseClient,
} from "@repo/database";
import type { Alert } from "@repo/notify";
import { Keyring } from "@repo/secrets";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ConnectionWatch } from "./connection-watch";

const { organizations, users, workspaces } = schemaTables;
const DATABASE_URL = process.env.DATABASE_URL;

/**
 * Watching connections, against real Postgres and a fake Graph.
 *
 * The point of the whole thing is to notice before a post does, so the tests
 * are about what it concludes from what the platform says — and, just as much,
 * what it refuses to conclude when the platform says nothing useful.
 */
describe.skipIf(!DATABASE_URL)("connection watch (integration)", () => {
  let db: DatabaseClient;
  let graph: Server;
  let keyring: Keyring;
  let accounts: DrizzleSocialAccountRepository;
  let secrets: DrizzleSecretRepository;
  let workspaceId: WorkspaceId;
  let userId: UserId;

  /** How the fake Graph answers the next credential check. */
  let behaviour: { status: number; body: string };
  let sent: Alert[][];

  const notifier = {
    check: async () => ({ ok: true }) as const,
    send: async (alerts: Alert[]) => void sent.push(alerts),
  };

  const watcher = () =>
    new ConnectionWatch({
      accounts,
      secrets,
      keyring,
      notifier,
      appUrl: "https://app.local",
    });

  const connect = async (externalId: string, displayName: string) => {
    const secretName = `connections/facebook/${externalId}`;
    const sealed = keyring.seal(
      JSON.stringify({ accessToken: `tok-${externalId}`, refreshToken: null }),
    );

    await secrets.put(
      {
        workspaceId,
        scope: "WORKSPACE",
        name: secretName,
        value: "",
        ...sealed,
        hint: "••••••••test",
      },
      userId,
    );

    return accounts.connect(
      {
        workspaceId,
        connectorId: "facebook",
        externalId,
        displayName,
        scopes: [],
        secretName,
      },
      userId,
    );
  };

  beforeAll(async () => {
    graph = createServer((_request, response) => {
      response.writeHead(behaviour.status, {
        "content-type": "application/json",
      });
      response.end(behaviour.body);
    });

    await new Promise<void>((resolve) => graph.listen(0, resolve));
    process.env.FACEBOOK_GRAPH_URL = `http://127.0.0.1:${
      (graph.address() as AddressInfo).port
    }/v21.0`;

    const key = randomBytes(32).toString("base64");
    keyring = new Keyring("test", [
      { id: "test", key: Buffer.from(key, "base64") },
    ]);

    db = createDbClient(DATABASE_URL!, { maxConnections: 3 });
    accounts = new DrizzleSocialAccountRepository(db);
    secrets = new DrizzleSecretRepository(db);
  });

  afterAll(async () => {
    if (graph)
      await new Promise<void>((resolve) => graph.close(() => resolve()));
    if (db) await closeDbClient(db);
  });

  beforeEach(async () => {
    await truncateTenantData(db);
    sent = [];
    behaviour = { status: 200, body: JSON.stringify({ id: "page-1" }) };

    const organizationId = newId("organization");
    userId = newId("user") as UserId;
    workspaceId = newId("workspace") as WorkspaceId;

    await db
      .insert(users)
      .values({ id: userId, email: "watch@test.local", status: "ACTIVE" });
    await db.insert(organizations).values({
      id: organizationId,
      name: "Test Org",
      slug: `org-${organizationId.slice(-8).toLowerCase()}`,
      ownerId: userId,
    });
    await db.insert(workspaces).values({
      id: workspaceId,
      organizationId,
      name: "A",
      slug: `a-${workspaceId.slice(-8).toLowerCase()}`,
    });
  });

  it("leaves a working connection alone and says nothing", async () => {
    const account = await connect("page-1", "Trang một");

    expect(await watcher().tick()).toBe(0);

    expect((await accounts.find(workspaceId, account.id))?.status).toBe(
      "ACTIVE",
    );
    expect(sent).toEqual([]);
  });

  it("marks an expired token and says reconnecting will fix it", async () => {
    const account = await connect("page-1", "Trang một");
    behaviour = {
      status: 401,
      body: JSON.stringify({
        error: { code: 190, message: "Session has expired" },
      }),
    };

    expect(await watcher().tick()).toBe(1);

    expect((await accounts.find(workspaceId, account.id))?.status).toBe(
      "EXPIRED",
    );
    expect(sent[0]![0]!.title).toContain("hết hạn");
    expect(sent[0]![0]!.reason).toContain("Nối lại");
  });

  it("says something different when the permission was taken away", async () => {
    // Reconnecting fixes an expired token and will not fix a revoked one until
    // the permission is granted again on the platform. Telling somebody to
    // press a button that cannot work is worse than telling them nothing.
    const account = await connect("page-1", "Trang một");
    behaviour = {
      status: 401,
      body: JSON.stringify({
        error: {
          code: 190,
          error_subcode: 458,
          message: "User has not authorized application",
        },
      }),
    };

    await watcher().tick();

    expect((await accounts.find(workspaceId, account.id))?.status).toBe(
      "REVOKED",
    );
    expect(sent[0]![0]!.reason).toContain("Cấp lại quyền bên nền tảng");
  });

  it("does not condemn a connection over a rate limit", async () => {
    // The fix a dead-token alert suggests — reconnect the channel — does
    // nothing about a rate limit, and the connection was never broken.
    const account = await connect("page-1", "Trang một");
    behaviour = {
      status: 429,
      body: JSON.stringify({ error: { code: 4, message: "rate limit" } }),
    };

    expect(await watcher().tick()).toBe(0);

    expect((await accounts.find(workspaceId, account.id))?.status).toBe(
      "ACTIVE",
    );
  });

  it("marks a connection whose credential has vanished from the vault", async () => {
    // The row says ACTIVE and there is nothing to ask the platform with. This
    // one is broken here, not there.
    const account = await connect("page-1", "Trang một");
    const secret = await secrets.findByName(
      workspaceId,
      "WORKSPACE",
      "connections/facebook/page-1",
    );
    await secrets.remove(workspaceId, secret!.id, userId);

    await watcher().tick();

    expect((await accounts.find(workspaceId, account.id))?.status).toBe(
      "EXPIRED",
    );
    expect(sent[0]![0]!.title).toContain("không còn credential");
  });

  it("checks every live connection, not just the first", async () => {
    await connect("page-1", "Trang một");
    await connect("page-2", "Trang hai");
    behaviour = {
      status: 401,
      body: JSON.stringify({ error: { code: 190, message: "expired" } }),
    };

    expect(await watcher().tick()).toBe(2);
    // One email for the sweep, both channels named in it.
    expect(sent).toHaveLength(1);
    expect(sent[0]).toHaveLength(2);
  });

  it("does not re-check something already known to be dead", async () => {
    // A second alert about the same dead channel every half hour is how
    // somebody learns to ignore the alerts.
    const account = await connect("page-1", "Trang một");
    behaviour = {
      status: 401,
      body: JSON.stringify({ error: { code: 190, message: "expired" } }),
    };
    await watcher().tick();
    sent = [];

    expect(await watcher().tick()).toBe(0);
    expect(sent).toEqual([]);
    expect((await accounts.find(workspaceId, account.id))?.status).toBe(
      "EXPIRED",
    );
  });

  it("still marks the connection when the alert cannot be sent", async () => {
    const account = await connect("page-1", "Trang một");
    behaviour = {
      status: 401,
      body: JSON.stringify({ error: { code: 190, message: "expired" } }),
    };

    const broken = new ConnectionWatch({
      accounts,
      secrets,
      keyring,
      notifier: {
        check: async () => ({ ok: true }) as const,
        send: async () => {
          throw new Error("SMTP không trả lời");
        },
      },
    });
    await broken.tick();

    expect((await accounts.find(workspaceId, account.id))?.status).toBe(
      "EXPIRED",
    );
  });
});
