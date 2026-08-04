import { newId, type UserId, type WorkspaceId } from "@repo/core";
import { beforeEach, describe, expect, it } from "vitest";
import { createDbClient, type DatabaseClient } from "../client";
import { organizations, users, workspaces } from "../schema";
import { truncateTenantData } from "../testing/reset";
import { DrizzleAiUsageRepository } from "./ai-usage.repository";

const DATABASE_URL = process.env.DATABASE_URL;

/** Where this platform is run from, and the clock its dashboard is read on. */
const SAIGON = "Asia/Ho_Chi_Minh";

describe.skipIf(!DATABASE_URL)(
  "DrizzleAiUsageRepository — counting by day (integration)",
  () => {
    let db: DatabaseClient;
    let repo: DrizzleAiUsageRepository;
    let workspaceId: WorkspaceId;
    let otherWorkspaceId: WorkspaceId;
    let userId: UserId;

    beforeEach(async () => {
      db ??= createDbClient(DATABASE_URL!, { maxConnections: 3 });
      repo = new DrizzleAiUsageRepository(db);
      await truncateTenantData(db);

      const organizationId = newId("organization");
      userId = newId("user");
      workspaceId = newId("workspace");
      otherWorkspaceId = newId("workspace");

      await db
        .insert(users)
        .values({ id: userId, email: "usage@test.local", status: "ACTIVE" });
      await db.insert(organizations).values({
        id: organizationId,
        name: "Test Org",
        slug: `org-${organizationId.slice(-8).toLowerCase()}`,
        ownerId: userId,
      });
      await db.insert(workspaces).values([
        {
          id: workspaceId,
          organizationId,
          name: "A",
          slug: `a-${workspaceId.slice(-8).toLowerCase()}`,
        },
        {
          id: otherWorkspaceId,
          organizationId,
          name: "B",
          slug: `b-${otherWorkspaceId.slice(-8).toLowerCase()}`,
        },
      ]);
    });

    const call = async (
      at: string,
      costUsd: number,
      target: WorkspaceId = workspaceId,
    ) => {
      await repo.record({
        id: newId("aiUsage"),
        workspaceId: target,
        userId,
        executionId: null,
        taskId: null,
        correlationId: null,
        provider: "google",
        model: "gemini-2.5-flash",
        operation: "test",
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
          cachedInputTokens: 0,
          reasoningTokens: 0,
        },
        cost: { inputUsd: 0, outputUsd: 0, totalUsd: costUsd, priced: true },
        latencyMs: 1,
        finishReason: "stop",
        metadata: {},
        timestamp: new Date(at),
      });
    };

    const window = {
      from: new Date("2026-08-01T00:00:00Z"),
      to: new Date("2026-08-10T00:00:00Z"),
    };

    it("groups calls into days on the reader's clock, not UTC", async () => {
      // 22:30 UTC on the 3rd is 05:30 on the 4th in Saigon. Bucketed in UTC it
      // would land on the previous bar, and "hôm nay" on the dashboard would
      // disagree with the clock on the wall.
      await call("2026-08-03T22:30:00Z", 0.01);
      await call("2026-08-04T02:00:00Z", 0.02);

      const days = await repo.countByDay(
        workspaceId,
        window.from,
        window.to,
        SAIGON,
      );

      expect(days).toEqual([
        { day: "2026-08-04", calls: 2, costUsd: "0.03000000" },
      ]);
    });

    it("puts the same two calls on different days when read in UTC", async () => {
      // The other half of the pair above: the zone is doing the work, not a
      // coincidence in the timestamps.
      await call("2026-08-03T22:30:00Z", 0.01);
      await call("2026-08-04T02:00:00Z", 0.02);

      const days = await repo.countByDay(
        workspaceId,
        window.from,
        window.to,
        "UTC",
      );

      expect(days.map((row) => row.day)).toEqual(["2026-08-03", "2026-08-04"]);
    });

    it("returns the days oldest first", async () => {
      await call("2026-08-06T03:00:00Z", 0.01);
      await call("2026-08-02T03:00:00Z", 0.01);
      await call("2026-08-04T03:00:00Z", 0.01);

      const days = await repo.countByDay(
        workspaceId,
        window.from,
        window.to,
        SAIGON,
      );

      expect(days.map((row) => row.day)).toEqual([
        "2026-08-02",
        "2026-08-04",
        "2026-08-06",
      ]);
    });

    it("counts this workspace only", async () => {
      await call("2026-08-04T03:00:00Z", 0.01);
      await call("2026-08-04T03:00:00Z", 0.05, otherWorkspaceId);

      const days = await repo.countByDay(
        workspaceId,
        window.from,
        window.to,
        SAIGON,
      );

      expect(days).toEqual([
        { day: "2026-08-04", calls: 1, costUsd: "0.01000000" },
      ]);
    });

    it("leaves out calls from outside the window", async () => {
      await call("2026-07-20T03:00:00Z", 0.01);
      await call("2026-08-04T03:00:00Z", 0.01);

      const days = await repo.countByDay(
        workspaceId,
        window.from,
        window.to,
        SAIGON,
      );

      expect(days.map((row) => row.day)).toEqual(["2026-08-04"]);
    });
  },
);
