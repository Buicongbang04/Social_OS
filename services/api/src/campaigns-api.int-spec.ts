import type { WorkspaceId } from "@repo/core";
import type { SocialAccountRepository } from "@repo/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SOCIAL_ACCOUNT_REPOSITORY } from "./infra/database/database.module";
import {
  createTenant,
  createTestApp,
  registerUser,
  type RegisteredUser,
  type TestApp,
} from "./testing/test-app";

/**
 * Campaigns and the calendar, over HTTP.
 *
 * The repository tests already cover the SQL. What is only reachable from here
 * is what the HTTP layer adds and can therefore get wrong on its own: parsing
 * an instant off a query string, telling `undefined` from `null` in a PATCH
 * body, and refusing to let one workspace read or touch another's plan.
 */
const hasInfra = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);

describe.skipIf(!hasInfra)("campaigns API (integration)", () => {
  let testApp: TestApp;
  let alice: RegisteredUser;
  let bob: RegisteredUser;
  let aliceWorkspace: string;
  let bobWorkspace: string;

  const as = (user: RegisteredUser, workspaceId: string) => ({
    Authorization: `Bearer ${user.accessToken}`,
    "X-Workspace-Id": workspaceId,
  });

  const newCampaign = async (name = "Chiến dịch tháng 8") => {
    const response = await testApp
      .http()
      .post("/api/v1/campaigns")
      .set(as(alice, aliceWorkspace))
      .send({ name })
      .expect(201);
    return response.body.data;
  };

  const newPiece = async (
    overrides: Record<string, unknown> = {},
  ): Promise<Record<string, string | null>> => {
    const response = await testApp
      .http()
      .post("/api/v1/content-pieces")
      .set(as(alice, aliceWorkspace))
      .send({
        title: "Bài viết",
        body: "Nội dung bài viết.",
        channel: "facebook",
        ...overrides,
      })
      .expect(201);
    return response.body.data;
  };

  /**
   * A connected Page, written straight to the repository.
   *
   * The HTTP path verifies the token against Graph, which these tests have no
   * business calling — what is under test is whether a piece may point at a
   * connection, not how the connection got made.
   */
  const connectPage = async (workspaceId: string, externalId: string) =>
    testApp.app.get<SocialAccountRepository>(SOCIAL_ACCOUNT_REPOSITORY).connect(
      {
        workspaceId: workspaceId as WorkspaceId,
        connectorId: "facebook",
        externalId,
        displayName: externalId,
        scopes: [],
        secretName: `connections/facebook/${externalId}`,
      },
      null,
    );

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    if (testApp) await testApp.close();
  });

  beforeEach(async () => {
    await testApp.reset();
    alice = await registerUser(testApp, "alice@campaigns.test");
    bob = await registerUser(testApp, "bob@campaigns.test");
    aliceWorkspace = (await createTenant(testApp, alice, "alice")).workspaceId;
    bobWorkspace = (await createTenant(testApp, bob, "bob")).workspaceId;
  });

  it("creates a campaign and a piece inside it", async () => {
    const campaign = await newCampaign();
    const piece = await newPiece({ campaignId: campaign.id });

    expect(campaign.status).toBe("DRAFT");
    expect(piece.campaignId).toBe(campaign.id);
    expect(piece.status).toBe("DRAFT");
  });

  it("saves a piece that belongs to no campaign", async () => {
    // The common case: written first, filed later. If this needed a campaign
    // the studio would have to invent an empty one to save a draft.
    const piece = await newPiece();

    expect(piece.campaignId).toBeNull();
  });

  it("reads a window off the query string", async () => {
    await newPiece({
      title: "Trong tháng",
      scheduledAt: "2026-08-15T09:00:00.000Z",
    });
    await newPiece({
      title: "Ngoài tháng",
      scheduledAt: "2026-09-20T09:00:00.000Z",
    });
    await newPiece({ title: "Chưa hẹn" });

    const response = await testApp
      .http()
      .get(
        "/api/v1/content-pieces?from=2026-08-01T00:00:00.000Z&to=2026-08-31T23:59:59.000Z",
      )
      .set(as(alice, aliceWorkspace))
      .expect(200);

    expect(
      response.body.data.map((piece: { title: string }) => piece.title),
    ).toEqual(["Trong tháng"]);
  });

  it("refuses a window it cannot read, instead of passing it to Postgres", async () => {
    // `new Date("thứ ba")` is Invalid Date, and handing that to the driver
    // produces a message about a bind parameter naming nothing the caller sent.
    await testApp
      .http()
      .get("/api/v1/content-pieces?from=thứ ba")
      .set(as(alice, aliceWorkspace))
      .expect(422);
  });

  it("refuses a schedule that carries no timezone", async () => {
    // "2026-08-15T09:00:00" is nine o'clock somewhere. Accepting it would mean
    // the server guessing which somewhere.
    await testApp
      .http()
      .post("/api/v1/content-pieces")
      .set(as(alice, aliceWorkspace))
      .send({
        title: "Bài viết",
        body: "Nội dung.",
        channel: "facebook",
        scheduledAt: "2026-08-15T09:00:00",
      })
      .expect(422);
  });

  it("will not let a client declare a piece published", async () => {
    // PUBLISHED is a record of something that happened, not an instruction.
    // Accepting it would let the calendar claim a post exists that nobody
    // sent — and the link next to it would go nowhere.
    const piece = await newPiece();

    await testApp
      .http()
      .patch(`/api/v1/content-pieces/${piece.id}`)
      .set(as(alice, aliceWorkspace))
      .send({ status: "PUBLISHED" })
      .expect(422);

    await testApp
      .http()
      .patch(`/api/v1/content-pieces/${piece.id}`)
      .set(as(alice, aliceWorkspace))
      .send({ status: "PUBLISHING" })
      .expect(422);
  });

  it("lets a person approve, and take an approval back", async () => {
    const piece = await newPiece();

    const approved = await testApp
      .http()
      .patch(`/api/v1/content-pieces/${piece.id}`)
      .set(as(alice, aliceWorkspace))
      .send({ status: "APPROVED" })
      .expect(200);
    expect(approved.body.data.status).toBe("APPROVED");

    const withdrawn = await testApp
      .http()
      .patch(`/api/v1/content-pieces/${piece.id}`)
      .set(as(alice, aliceWorkspace))
      .send({ status: "DRAFT" })
      .expect(200);
    expect(withdrawn.body.data.status).toBe("DRAFT");
  });

  it("will not let a piece point at another workspace's channel", async () => {
    // 404, not stored-and-ignored: the sweep would never publish there, but a
    // row pointing across a tenant boundary turns into an error message about
    // a disconnected channel rather than one that was never theirs.
    const bobsAccount = await connectPage(bobWorkspace, "page-bob");

    await testApp
      .http()
      .post("/api/v1/content-pieces")
      .set(as(alice, aliceWorkspace))
      .send({
        title: "Bài viết",
        body: "Nội dung.",
        channel: "facebook",
        socialAccountId: bobsAccount.id,
      })
      .expect(404);
  });

  it("keeps a piece pointed at the channel it was given", async () => {
    const account = await connectPage(aliceWorkspace, "page-alice");

    const piece = await newPiece({ socialAccountId: account.id });
    expect(piece.socialAccountId).toBe(account.id);

    // null puts it back to "the only channel", which is a different thing from
    // leaving the field out.
    const cleared = await testApp
      .http()
      .patch(`/api/v1/content-pieces/${piece.id}`)
      .set(as(alice, aliceWorkspace))
      .send({ socialAccountId: null })
      .expect(200);
    expect(cleared.body.data.socialAccountId).toBeNull();
  });

  it("filters the calendar to one campaign", async () => {
    const campaign = await newCampaign();
    await newPiece({ title: "Thuộc chiến dịch", campaignId: campaign.id });
    await newPiece({ title: "Rời" });

    const response = await testApp
      .http()
      .get(`/api/v1/content-pieces?campaignId=${campaign.id}`)
      .set(as(alice, aliceWorkspace))
      .expect(200);

    expect(
      response.body.data.map((piece: { title: string }) => piece.title),
    ).toEqual(["Thuộc chiến dịch"]);
  });

  it("does not clobber what a PATCH did not mention", async () => {
    // A body with one key is the shape a rename actually arrives in. Reading
    // the absent keys as null is how a rename silently unschedules a post.
    const piece = await newPiece({
      title: "Tên cũ",
      scheduledAt: "2026-08-15T09:00:00.000Z",
    });

    const response = await testApp
      .http()
      .patch(`/api/v1/content-pieces/${piece.id}`)
      .set(as(alice, aliceWorkspace))
      .send({ title: "Tên mới" })
      .expect(200);

    expect(response.body.data.title).toBe("Tên mới");
    expect(response.body.data.scheduledAt).toBe("2026-08-15T09:00:00.000Z");
    expect(response.body.data.body).toBe("Nội dung bài viết.");
  });

  it("takes a piece out of its campaign when sent null", async () => {
    const campaign = await newCampaign();
    const piece = await newPiece({ campaignId: campaign.id });

    const response = await testApp
      .http()
      .patch(`/api/v1/content-pieces/${piece.id}`)
      .set(as(alice, aliceWorkspace))
      .send({ campaignId: null })
      .expect(200);

    expect(response.body.data.campaignId).toBeNull();
  });

  it("leaves the pieces behind when a campaign is archived", async () => {
    // Calling off a campaign must not delete work somebody wrote and may want
    // to run somewhere else.
    const campaign = await newCampaign();
    await newPiece({ campaignId: campaign.id });

    await testApp
      .http()
      .delete(`/api/v1/campaigns/${campaign.id}`)
      .set(as(alice, aliceWorkspace))
      .expect(204);

    const campaigns = await testApp
      .http()
      .get("/api/v1/campaigns")
      .set(as(alice, aliceWorkspace))
      .expect(200);
    const pieces = await testApp
      .http()
      .get("/api/v1/content-pieces")
      .set(as(alice, aliceWorkspace))
      .expect(200);

    expect(campaigns.body.data).toEqual([]);
    expect(pieces.body.data).toHaveLength(1);
  });

  it("hides one workspace's plan from another, and will not let it write", async () => {
    // 404 rather than 403 throughout: 403 confirms the thing exists, which is
    // itself something Bob should not learn.
    const campaign = await newCampaign();
    const piece = await newPiece();

    const bobsView = await testApp
      .http()
      .get("/api/v1/campaigns")
      .set(as(bob, bobWorkspace))
      .expect(200);
    expect(bobsView.body.data).toEqual([]);

    await testApp
      .http()
      .patch(`/api/v1/campaigns/${campaign.id}`)
      .set(as(bob, bobWorkspace))
      .send({ name: "Đổi trộm" })
      .expect(404);

    await testApp
      .http()
      .delete(`/api/v1/content-pieces/${piece.id}`)
      .set(as(bob, bobWorkspace))
      .expect(404);

    const stillThere = await testApp
      .http()
      .get("/api/v1/content-pieces")
      .set(as(alice, aliceWorkspace))
      .expect(200);
    expect(stillThere.body.data).toHaveLength(1);
  });

  it("will not let a member of another workspace borrow their own header", async () => {
    // Bob authenticating as himself but naming Alice's workspace. The header is
    // a claim, not an authorisation — and the refusal is 404, so it does not
    // even confirm the workspace is real.
    await newCampaign();

    await testApp
      .http()
      .get("/api/v1/campaigns")
      .set(as(bob, aliceWorkspace))
      .expect(404);
  });

  it("needs a signature at all", async () => {
    await testApp.http().get("/api/v1/campaigns").expect(401);
  });

  it("reports each campaign's pieces by status", async () => {
    const campaign = await newCampaign();
    await newPiece({ campaignId: campaign.id, title: "Nháp" });
    const ready = await newPiece({
      campaignId: campaign.id,
      title: "Đã duyệt",
    });
    await testApp
      .http()
      .patch(`/api/v1/content-pieces/${ready.id}`)
      .set(as(alice, aliceWorkspace))
      .send({ status: "APPROVED" })
      .expect(200);

    const response = await testApp
      .http()
      .get("/api/v1/campaigns/report")
      .set(as(alice, aliceWorkspace))
      .expect(200);

    const row = response.body.data.rows.find(
      (entry: { campaignId: string }) => entry.campaignId === campaign.id,
    );
    expect(row).toMatchObject({
      name: "Chiến dịch tháng 8",
      drafts: 1,
      approved: 1,
      published: 0,
      failed: 0,
    });
  });

  it("keeps the pieces belonging to no campaign in the report", async () => {
    // For most workspaces these are most of the posts. Dropping them would
    // show a fraction of the work and call it the total.
    await newPiece();

    const response = await testApp
      .http()
      .get("/api/v1/campaigns/report")
      .set(as(alice, aliceWorkspace))
      .expect(200);

    const loose = response.body.data.rows.find(
      (entry: { campaignId: string | null }) => entry.campaignId === null,
    );
    expect(loose).toMatchObject({
      name: "Không thuộc chiến dịch nào",
      drafts: 1,
    });
  });

  it("still names a campaign that has been archived", async () => {
    // Archiving a campaign leaves its pieces, so its row outlives it. An id
    // with no name is a row of numbers nobody can read.
    const campaign = await newCampaign();
    await newPiece({ campaignId: campaign.id });
    await testApp
      .http()
      .delete(`/api/v1/campaigns/${campaign.id}`)
      .set(as(alice, aliceWorkspace))
      .expect(204);

    const response = await testApp
      .http()
      .get("/api/v1/campaigns/report")
      .set(as(alice, aliceWorkspace))
      .expect(200);

    const row = response.body.data.rows.find(
      (entry: { campaignId: string }) => entry.campaignId === campaign.id,
    );
    expect(row.name).toBe("Chiến dịch đã lưu trữ");
  });

  it("reports the pieces even when no channel is connected", async () => {
    // The counts are ours. A workspace with nothing connected, or with an
    // expired token, should still see what it has written.
    await newPiece();

    const response = await testApp
      .http()
      .get("/api/v1/campaigns/report")
      .set(as(alice, aliceWorkspace))
      .expect(200);

    expect(response.body.data.rows).toHaveLength(1);
    expect(response.body.data.rows[0].likes).toBe(0);
    expect(response.body.data.rows[0].postsWithoutStats).toBe(0);
  });

  it("names a channel whose numbers could not be read", async () => {
    // A connection whose credential has gone is the common case, and it must
    // not silently understate the totals — the row still shows the pieces, and
    // the channel is named alongside.
    await connectPage(aliceWorkspace, "page-gone");
    await newPiece();

    const response = await testApp
      .http()
      .get("/api/v1/campaigns/report")
      .set(as(alice, aliceWorkspace))
      .expect(200);

    expect(response.body.data.rows).toHaveLength(1);
    expect(response.body.data.unreadable).toEqual([
      {
        account: "page-gone",
        reason: "Không còn credential. Hãy kết nối lại kênh này.",
      },
    ]);
  });

  it("does not report one workspace's campaigns to another", async () => {
    const campaign = await newCampaign();
    await newPiece({ campaignId: campaign.id });

    const response = await testApp
      .http()
      .get("/api/v1/campaigns/report")
      .set(as(bob, bobWorkspace))
      .expect(200);

    expect(response.body.data.rows).toEqual([]);
  });

  it("does not read /report as a campaign id", async () => {
    // Nest matches in declaration order. A `@Get(":id")` added later would
    // swallow this route and try to parse "report" as an id.
    await testApp
      .http()
      .get("/api/v1/campaigns/report")
      .set(as(alice, aliceWorkspace))
      .expect(200);
  });

  it("draws a banner for a piece and remembers where it is", async () => {
    const piece = await newPiece({ title: "Mua hộ hàng Nhật" });

    const response = await testApp
      .http()
      .post(`/api/v1/content-pieces/${piece.id}/banner`)
      .set(as(alice, aliceWorkspace))
      .send({ footer: "tiximax.vn" })
      .expect(201);

    // The key on the piece, the URL only in the response: a presigned URL
    // expires, so storing one leaves the calendar showing a picture that
    // stops loading minutes later.
    expect(response.body.data.piece.imageKey).toBe(`${piece.id}.png`);
    expect(response.body.data.url).toContain("http");
  });

  it("will not draw a banner for another workspace's piece", async () => {
    const piece = await newPiece();

    await testApp
      .http()
      .post(`/api/v1/content-pieces/${piece.id}/banner`)
      .set(as(bob, bobWorkspace))
      .send({})
      .expect(404);
  });

  it("refuses a size it does not have", async () => {
    const piece = await newPiece();

    await testApp
      .http()
      .post(`/api/v1/content-pieces/${piece.id}/banner`)
      .set(as(alice, aliceWorkspace))
      .send({ size: "billboard" })
      .expect(422);
  });
});
