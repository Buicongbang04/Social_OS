import {
  newId,
  type CampaignId,
  type UserId,
  type WorkspaceId,
} from "@repo/core";
import { beforeEach, describe, expect, it } from "vitest";
import { createDbClient, type DatabaseClient } from "../client";
import { organizations, users, workspaces } from "../schema";
import { truncateTenantData } from "../testing/reset";
import {
  DrizzleCampaignRepository,
  DrizzleContentPieceRepository,
} from "./campaign.repository";

const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)("campaigns and content (integration)", () => {
  let db: DatabaseClient;
  let campaigns: DrizzleCampaignRepository;
  let pieces: DrizzleContentPieceRepository;
  let workspaceId: WorkspaceId;
  let otherWorkspaceId: WorkspaceId;
  let userId: UserId;

  const newCampaign = (name = "Chiến dịch tháng 8", ws = workspaceId) =>
    campaigns.create({ workspaceId: ws, name }, userId);

  const newPiece = (
    overrides: {
      title?: string;
      scheduledAt?: Date | null;
      campaignId?: CampaignId | null;
      workspaceId?: WorkspaceId;
    } = {},
  ) =>
    pieces.create(
      {
        workspaceId: overrides.workspaceId ?? workspaceId,
        campaignId: overrides.campaignId ?? null,
        title: overrides.title ?? "Bài viết",
        body: "Nội dung bài viết.",
        hashtags: ["muahang"],
        channel: "facebook",
        scheduledAt: overrides.scheduledAt ?? null,
      },
      userId,
    );

  beforeEach(async () => {
    db ??= createDbClient(DATABASE_URL!, { maxConnections: 3 });
    campaigns = new DrizzleCampaignRepository(db);
    pieces = new DrizzleContentPieceRepository(db);
    await truncateTenantData(db);

    const organizationId = newId("organization");
    userId = newId("user");
    workspaceId = newId("workspace");
    otherWorkspaceId = newId("workspace");

    await db
      .insert(users)
      .values({ id: userId, email: "campaign@test.local", status: "ACTIVE" });
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

  it("creates a campaign that starts as a draft", async () => {
    const campaign = await newCampaign();

    expect(campaign.status).toBe("DRAFT");
    expect(await campaigns.list(workspaceId)).toHaveLength(1);
  });

  it("keeps a piece that belongs to no campaign", async () => {
    // The order the work actually happens in: a post gets written before
    // anyone decides which campaign it belongs to. Requiring one would mean
    // inventing an empty campaign to hold a draft.
    const piece = await newPiece();

    expect(piece.campaignId).toBeNull();
    expect(await pieces.list(workspaceId)).toHaveLength(1);
  });

  it("puts what is scheduled before what is not", async () => {
    // The ordering is written out rather than left to the default, so that
    // flipping the direction later cannot silently put every undated draft
    // above the post going out in an hour.
    const soon = new Date(Date.now() + 60 * 60 * 1000);
    await newPiece({ title: "Chưa hẹn ngày" });
    await newPiece({ title: "Sắp đăng", scheduledAt: soon });

    const listed = await pieces.list(workspaceId);

    expect(listed[0]?.title).toBe("Sắp đăng");
    expect(listed[1]?.title).toBe("Chưa hẹn ngày");
  });

  it("reads a window without dragging in undated drafts", async () => {
    // A calendar showing an undated draft on some arbitrary day would be
    // lying about when it goes out.
    const inside = new Date("2026-08-15T09:00:00Z");
    await newPiece({ title: "Trong tháng", scheduledAt: inside });
    await newPiece({
      title: "Ngoài tháng",
      scheduledAt: new Date("2026-09-20T09:00:00Z"),
    });
    await newPiece({ title: "Chưa hẹn" });

    const august = await pieces.list(workspaceId, {
      from: new Date("2026-08-01T00:00:00Z"),
      to: new Date("2026-08-31T23:59:59Z"),
    });

    expect(august.map((piece) => piece.title)).toEqual(["Trong tháng"]);
  });

  it("filters to one campaign's pieces", async () => {
    const campaign = await newCampaign();
    await newPiece({ title: "Thuộc chiến dịch", campaignId: campaign.id });
    await newPiece({ title: "Rời" });

    const inCampaign = await pieces.list(workspaceId, {
      campaignId: campaign.id,
    });

    expect(inCampaign.map((piece) => piece.title)).toEqual([
      "Thuộc chiến dịch",
    ]);
  });

  it("leaves untouched fields alone on a partial update", async () => {
    // `undefined` means "leave alone" and `null` means "clear it". Collapsing
    // the two is how a rename loses a schedule.
    const when = new Date("2026-08-15T09:00:00Z");
    const piece = await newPiece({ title: "Tên cũ", scheduledAt: when });

    const renamed = await pieces.update(
      workspaceId,
      piece.id,
      { title: "Tên mới" },
      userId,
    );

    expect(renamed?.title).toBe("Tên mới");
    expect(renamed?.scheduledAt?.toISOString()).toBe(when.toISOString());
    expect(renamed?.body).toBe("Nội dung bài viết.");
  });

  it("treats an absent field differently from one set to null", async () => {
    // A partial update arriving from an API body has keys present and
    // undefined. Treating those as null is how a rename wipes a schedule —
    // and nothing catches it, because the caller never mentioned the field.
    const when = new Date("2026-08-15T09:00:00Z");
    const piece = await newPiece({ title: "Tên cũ", scheduledAt: when });

    const renamed = await pieces.update(
      workspaceId,
      piece.id,
      { title: "Tên mới", scheduledAt: undefined, campaignId: undefined },
      userId,
    );

    expect(renamed?.title).toBe("Tên mới");
    expect(renamed?.scheduledAt?.toISOString()).toBe(when.toISOString());
  });

  it("does not write at all for an update that asks for nothing", async () => {
    // A form that submits every field, all unchanged, should not bump the
    // version and the audit columns — otherwise the history fills with edits
    // nobody made.
    const piece = await newPiece();

    const same = await pieces.update(
      workspaceId,
      piece.id,
      { title: undefined, scheduledAt: undefined },
      userId,
    );

    expect(same?.version).toBe(piece.version);
    expect(same?.updatedAt.toISOString()).toBe(piece.updatedAt.toISOString());
  });

  it("clears a schedule when asked to, rather than ignoring it", async () => {
    const piece = await newPiece({ scheduledAt: new Date() });

    const cleared = await pieces.update(
      workspaceId,
      piece.id,
      { scheduledAt: null },
      userId,
    );

    expect(cleared?.scheduledAt).toBeNull();
  });

  it("does not show one workspace's campaigns or pieces to another", async () => {
    const campaign = await newCampaign();
    const piece = await newPiece();

    expect(await campaigns.list(otherWorkspaceId)).toEqual([]);
    expect(await campaigns.find(otherWorkspaceId, campaign.id)).toBeNull();
    expect(await pieces.list(otherWorkspaceId)).toEqual([]);
    expect(await pieces.find(otherWorkspaceId, piece.id)).toBeNull();
  });

  it("will not let another workspace change or archive them", async () => {
    const campaign = await newCampaign();
    const piece = await newPiece();

    expect(
      await campaigns.update(
        otherWorkspaceId,
        campaign.id,
        { name: "Đổi trộm" },
        userId,
      ),
    ).toBeNull();
    expect(await pieces.archive(otherWorkspaceId, piece.id, userId)).toBe(
      false,
    );

    expect((await campaigns.find(workspaceId, campaign.id))?.name).toBe(
      "Chiến dịch tháng 8",
    );
    expect(await pieces.list(workspaceId)).toHaveLength(1);
  });

  it("hides an archived campaign without touching its pieces", async () => {
    // Archiving the grouping must not delete the work. A campaign called off
    // still leaves posts somebody wrote and may want elsewhere.
    const campaign = await newCampaign();
    await newPiece({ campaignId: campaign.id });

    expect(await campaigns.archive(workspaceId, campaign.id, userId)).toBe(
      true,
    );

    expect(await campaigns.list(workspaceId)).toEqual([]);
    expect(await pieces.list(workspaceId)).toHaveLength(1);
  });

  it("moves a piece between campaigns, and out of one", async () => {
    const first = await newCampaign("Một");
    const second = await newCampaign("Hai");
    const piece = await newPiece({ campaignId: first.id });

    const moved = await pieces.update(
      workspaceId,
      piece.id,
      { campaignId: second.id },
      userId,
    );
    expect(moved?.campaignId).toBe(second.id);

    const loose = await pieces.update(
      workspaceId,
      piece.id,
      { campaignId: null },
      userId,
    );
    expect(loose?.campaignId).toBeNull();
  });

  it("returns nothing for something that never existed", async () => {
    expect(
      await campaigns.find(workspaceId, newId("campaign") as CampaignId),
    ).toBeNull();
  });
});
