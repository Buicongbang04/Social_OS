import {
  newId,
  type SocialAccountId,
  type UserId,
  type WorkspaceId,
} from "@repo/core";
import { beforeEach, describe, expect, it } from "vitest";
import { createDbClient, type DatabaseClient } from "../client";
import { organizations, users, workspaces } from "../schema";
import { truncateTenantData } from "../testing/reset";
import { DrizzleSocialAccountRepository } from "./social-account.repository";

const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)(
  "DrizzleSocialAccountRepository (integration)",
  () => {
    let db: DatabaseClient;
    let repo: DrizzleSocialAccountRepository;
    let workspaceId: WorkspaceId;
    let otherWorkspaceId: WorkspaceId;
    let userId: UserId;

    const connect = (
      overrides: Partial<{
        workspaceId: WorkspaceId;
        connectorId: string;
        externalId: string;
        displayName: string;
        scopes: string[];
      }> = {},
    ) =>
      repo.connect(
        {
          workspaceId: overrides.workspaceId ?? workspaceId,
          connectorId: overrides.connectorId ?? "facebook",
          externalId: overrides.externalId ?? "page-1",
          displayName: overrides.displayName ?? "Trang thử nghiệm",
          scopes: overrides.scopes ?? ["pages_manage_posts"],
          secretName: `connections/facebook/${overrides.externalId ?? "page-1"}`,
        },
        userId,
      );

    beforeEach(async () => {
      db ??= createDbClient(DATABASE_URL!, { maxConnections: 3 });
      repo = new DrizzleSocialAccountRepository(db);
      await truncateTenantData(db);

      const organizationId = newId("organization");
      userId = newId("user");
      workspaceId = newId("workspace");
      otherWorkspaceId = newId("workspace");

      await db
        .insert(users)
        .values({ id: userId, email: "social@test.local", status: "ACTIVE" });
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

    it("stores a connection without any token in the row", async () => {
      const account = await connect();

      expect(account.status).toBe("ACTIVE");
      expect(account.secretName).toBe("connections/facebook/page-1");
      // Only a reference. A row that could carry a live token would put one in
      // every log line that ever serialised a connection.
      expect(JSON.stringify(account)).not.toMatch(/access_?token/i);
    });

    it("reconnecting the same page updates it instead of adding another", async () => {
      // Two rows for one audience means two tokens and no way to say which is
      // live — disconnecting one would leave the other publishing.
      const first = await connect({ displayName: "Tên cũ" });
      const again = await connect({ displayName: "Tên mới" });

      expect(again.id).toBe(first.id);
      expect(again.displayName).toBe("Tên mới");
      expect(await repo.list(workspaceId)).toHaveLength(1);
    });

    it("keeps two pages on the same platform apart", async () => {
      await connect({ externalId: "page-1", displayName: "Trang một" });
      await connect({ externalId: "page-2", displayName: "Trang hai" });

      expect(await repo.list(workspaceId)).toHaveLength(2);
    });

    it("records what was granted, not what was asked for", async () => {
      // The difference is what the workspace can really do, and publish time is
      // too late to find out.
      const account = await connect({ scopes: ["pages_show_list"] });

      expect(account.scopes).toEqual(["pages_show_list"]);
    });

    it("does not show one workspace's connections to another", async () => {
      const mine = await connect();

      expect(await repo.list(otherWorkspaceId)).toEqual([]);
      expect(await repo.find(otherWorkspaceId, mine.id)).toBeNull();
      expect(await repo.find(workspaceId, mine.id)).not.toBeNull();
    });

    it("will not let another workspace disconnect an account", async () => {
      const mine = await connect();

      expect(
        await repo.disconnect(otherWorkspaceId, mine.id, userId),
      ).toBeNull();
      expect(await repo.list(workspaceId)).toHaveLength(1);
    });

    it("lets two workspaces connect the same page independently", async () => {
      // An agency and its client can both hold a connection to one page. The
      // unique key is per workspace, so neither displaces the other.
      const mine = await connect();
      const theirs = await connect({ workspaceId: otherWorkspaceId });

      expect(theirs.id).not.toBe(mine.id);
      expect(await repo.list(otherWorkspaceId)).toHaveLength(1);
    });

    it("hides a disconnected account and can take it back", async () => {
      const account = await connect();

      const removed = await repo.disconnect(workspaceId, account.id, userId);
      expect(removed?.status).toBe("REVOKED");
      expect(await repo.list(workspaceId)).toEqual([]);

      // The soft-deleted row still holds the unique key, so reconnecting has to
      // clear the flag or the save is a silent no-op.
      const back = await connect();
      expect(back.id).toBe(account.id);
      expect(back.status).toBe("ACTIVE");
      expect(await repo.list(workspaceId)).toHaveLength(1);
    });

    it("marks a connection expired without disconnecting it", async () => {
      // Expired is the platform's clock running out and is fixed by
      // reconnecting. It is not the same as somebody revoking the permission,
      // and the row has to stay so the user can see what needs fixing.
      const account = await connect();

      const expired = await repo.updateStatus(account.id, "EXPIRED", userId);

      expect(expired?.status).toBe("EXPIRED");
      expect(await repo.list(workspaceId)).toHaveLength(1);
    });

    it("finds an account by the platform's own id", async () => {
      // Which is how a callback recognises a page it has seen before, since
      // that id survives the page being renamed.
      const account = await connect();

      expect(
        (await repo.findByExternalId(workspaceId, "facebook", "page-1"))?.id,
      ).toBe(account.id);
      expect(
        await repo.findByExternalId(otherWorkspaceId, "facebook", "page-1"),
      ).toBeNull();
    });

    it("returns nothing for an account that never existed", async () => {
      expect(
        await repo.find(workspaceId, newId("socialAccount") as SocialAccountId),
      ).toBeNull();
    });
  },
);
