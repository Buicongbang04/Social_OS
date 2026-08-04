import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { newId, type UserId, type WorkspaceId } from "@repo/core";
import {
  DrizzleCampaignRepository,
  DrizzleContentPieceRepository,
  DrizzleSecretRepository,
  DrizzleSocialAccountRepository,
  closeDbClient,
  createDbClient,
  schemaTables,
  truncateTenantData,
  type DatabaseClient,
} from "@repo/database";
import { Metrics } from "@repo/observability";
import { Keyring } from "@repo/secrets";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ContentPublisher } from "./content-publisher";

const { organizations, users, workspaces } = schemaTables;

const DATABASE_URL = process.env.DATABASE_URL;

/**
 * The calendar's publisher, against real Postgres and an HTTP server standing
 * in for Graph.
 *
 * The assertions lean the same way the publish capability's do — towards what
 * must NOT happen. This loop runs with nobody watching, so the interesting
 * cases are all refusals: a draft whose date passed, a piece already claimed,
 * a piece left mid-send by a process that died.
 */
describe.skipIf(!DATABASE_URL)("content publisher (integration)", () => {
  let db: DatabaseClient;
  let graph: Server;
  let keyring: Keyring;
  let accounts: DrizzleSocialAccountRepository;
  let secrets: DrizzleSecretRepository;
  let pieces: DrizzleContentPieceRepository;
  let campaigns: DrizzleCampaignRepository;
  let publisher: ContentPublisher;
  let metrics: Metrics;
  let workspaceId: WorkspaceId;
  let userId: UserId;

  let posted: { message: string }[];
  /** Which Page each post was addressed to, read off the request path. */
  let sentTo: string[];
  /** `feed` or `photos` — which endpoint each post went to. */
  let endpoints: string[];
  let behaviour: { status: number; body: string };

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

  /** A piece, approved and due, unless told otherwise. */
  const schedule = async (
    overrides: {
      status?: "DRAFT" | "APPROVED";
      scheduledAt?: Date | null;
      body?: string;
      hashtags?: string[];
      channel?: string;
      socialAccountId?: string | null;
    } = {},
  ) => {
    const piece = await pieces.create(
      {
        workspaceId,
        campaignId: null,
        socialAccountId: (overrides.socialAccountId ?? null) as never,
        title: "Bài kiểm tra",
        body: overrides.body ?? "Nội dung kiểm tra.",
        hashtags: overrides.hashtags ?? [],
        channel: overrides.channel ?? "facebook",
        scheduledAt:
          overrides.scheduledAt === undefined
            ? new Date(Date.now() - 60_000)
            : overrides.scheduledAt,
      },
      userId,
    );

    if ((overrides.status ?? "APPROVED") === "APPROVED") {
      await pieces.update(
        workspaceId,
        piece.id,
        { status: "APPROVED" },
        userId,
      );
    }
    return piece;
  };

  beforeAll(async () => {
    graph = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        if (request.method === "GET") {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({ data: [] }));
          return;
        }

        const body = new URLSearchParams(Buffer.concat(chunks).toString());
        // `caption` on the photo endpoint, `message` on the feed one. Reading
        // only `message` would record an empty string for every photo post and
        // hide whether the words went with the picture at all.
        posted.push({
          message: body.get("message") ?? body.get("caption") ?? "",
        });
        sentTo.push(request.url?.split("/")[2]?.split("?")[0] ?? "");
        endpoints.push(request.url?.split("/")[3]?.split("?")[0] ?? "");
        response.writeHead(behaviour.status, {
          "content-type": "application/json",
        });
        response.end(behaviour.body);
      });
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
    pieces = new DrizzleContentPieceRepository(db);
    campaigns = new DrizzleCampaignRepository(db);
  });

  afterAll(async () => {
    if (graph)
      await new Promise<void>((resolve) => graph.close(() => resolve()));
    if (db) await closeDbClient(db);
  });

  beforeEach(async () => {
    await truncateTenantData(db);
    posted = [];
    sentTo = [];
    endpoints = [];
    behaviour = {
      status: 200,
      body: JSON.stringify({ id: "page-1_777", post_id: "page-1_777" }),
    };

    const organizationId = newId("organization");
    userId = newId("user") as UserId;
    workspaceId = newId("workspace") as WorkspaceId;

    await db
      .insert(users)
      .values({ id: userId, email: "pub@test.local", status: "ACTIVE" });
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

    // Fresh per test: counters are cumulative, and one registry shared across
    // the file makes every count assertion depend on what ran before it.
    metrics = new Metrics({ defaultMetrics: false });
    publisher = new ContentPublisher({
      accounts,
      secrets,
      keyring,
      pieces,
      metrics,
    });
  });

  it("sends an approved piece that has come due", async () => {
    await connect("page-1", "Trang một");
    const piece = await schedule({ body: "Xin chào cả nhà." });

    expect(await publisher.tick()).toBe(1);

    expect(posted).toEqual([{ message: "Xin chào cả nhà." }]);
    const settled = await pieces.find(workspaceId, piece.id);
    expect(settled?.status).toBe("PUBLISHED");
    expect(settled?.publishedPostId).toBe("page-1_777");
    expect(settled?.publishedAt).not.toBeNull();
  });

  it("never sends a draft, however far past its date", async () => {
    // The whole feature rests on this. Approval is the authorisation, and a
    // date is not one — a piece nobody read must not reach an audience because
    // a timestamp on it happened to pass.
    await connect("page-1", "Trang một");
    const piece = await schedule({
      status: "DRAFT",
      scheduledAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    });

    expect(await publisher.tick()).toBe(0);

    expect(posted).toEqual([]);
    expect((await pieces.find(workspaceId, piece.id))?.status).toBe("DRAFT");
  });

  it("does not send a piece before its time", async () => {
    await connect("page-1", "Trang một");
    await schedule({ scheduledAt: new Date(Date.now() + 60 * 60 * 1000) });

    await publisher.tick();

    expect(posted).toEqual([]);
  });

  it("does not send a piece with no date at all", async () => {
    // "Approved, not scheduled" is a real state: somebody signed off on the
    // text but has not decided when. Sending it now would be deciding for them.
    await connect("page-1", "Trang một");
    const piece = await schedule({ scheduledAt: null });

    await publisher.tick();

    expect(posted).toEqual([]);
    expect((await pieces.find(workspaceId, piece.id))?.status).toBe("APPROVED");
  });

  it("puts the hashtags at the end of the post", async () => {
    await connect("page-1", "Trang một");
    await schedule({
      body: "Mua hộ hàng Nhật.",
      hashtags: ["muahang", "nhat"],
    });

    await publisher.tick();

    expect(posted[0]?.message).toBe("Mua hộ hàng Nhật.\n\n#muahang #nhat");
  });

  it("sends the same piece exactly once, even swept twice", async () => {
    await connect("page-1", "Trang một");
    await schedule();

    await publisher.tick();
    await publisher.tick();

    expect(posted).toHaveLength(1);
  });

  it("sends to the page the piece names, with several connected", async () => {
    // The whole point of naming one: a post written for this audience must not
    // land on another because it happens to be first in the list.
    const first = await connect("page-1", "Trang một");
    const second = await connect("page-2", "Trang hai");
    void first;
    const piece = await schedule({ socialAccountId: second.id });

    await publisher.tick();

    expect(posted).toHaveLength(1);
    expect(sentTo).toEqual(["page-2"]);
    expect((await pieces.find(workspaceId, piece.id))?.status).toBe(
      "PUBLISHED",
    );
  });

  it("refuses when the page a piece named has gone away", async () => {
    // Different from "nothing connected": this one was chosen and has since
    // been disconnected, and falling back to whatever is left would post to an
    // audience nobody picked.
    const account = await connect("page-1", "Trang một");
    await connect("page-2", "Trang hai");
    const piece = await schedule({ socialAccountId: account.id });
    await accounts.disconnect(workspaceId, account.id, userId);

    await publisher.tick();

    expect(posted).toEqual([]);
    const settled = await pieces.find(workspaceId, piece.id);
    expect(settled?.status).toBe("FAILED");
    expect(settled?.lastError).toContain("không còn kết nối");
  });

  it("stops rather than guessing when two pages are connected", async () => {
    // A piece names a channel, not an account. With two Pages on it, "post to
    // Facebook" is a sentence missing its object, and choosing one would be
    // the platform picking somebody's audience.
    await connect("page-1", "Trang một");
    await connect("page-2", "Trang hai");
    const piece = await schedule();

    await publisher.tick();

    expect(posted).toEqual([]);
    const settled = await pieces.find(workspaceId, piece.id);
    expect(settled?.status).toBe("FAILED");
    expect(settled?.lastError).toContain("Trang một");
    expect(settled?.lastError).toContain("Trang hai");
  });

  it("says so when nothing is connected, rather than failing silently", async () => {
    const piece = await schedule();

    await publisher.tick();

    const settled = await pieces.find(workspaceId, piece.id);
    expect(settled?.status).toBe("FAILED");
    expect(settled?.lastError).toContain("Kênh mạng xã hội");
  });

  it("records what the platform said when it refuses the post", async () => {
    await connect("page-1", "Trang một");
    behaviour = {
      status: 400,
      body: JSON.stringify({
        error: { message: "Nội dung vi phạm chính sách", code: 368 },
      }),
    };
    const piece = await schedule();

    await publisher.tick();

    const settled = await pieces.find(workspaceId, piece.id);
    expect(settled?.status).toBe("FAILED");
    expect(settled?.lastError).toContain("chính sách");
    expect(settled?.publishedPostId).toBeNull();
  });

  it("fails a piece abandoned mid-send instead of sending it again", async () => {
    // A node that died between claiming and hearing back leaves a row in
    // PUBLISHING. The call may have landed with only the answer lost, and
    // retrying is how one post becomes two on a real audience.
    await connect("page-1", "Trang một");
    const piece = await schedule();
    await pieces.claimDue(new Date(), 10);

    const eager = new ContentPublisher(
      { accounts, secrets, keyring, pieces },
      { stuckAfterMs: -1 },
    );
    await eager.tick();

    expect(posted).toEqual([]);
    const settled = await pieces.find(workspaceId, piece.id);
    expect(settled?.status).toBe("FAILED");
    expect(settled?.lastError).toContain("Không rõ bài đã lên hay chưa");
  });

  it("leaves a piece that is only briefly mid-send alone", async () => {
    // Being in PUBLISHING is normal for the second a publish takes. Failing
    // that would break the posts that are working.
    await connect("page-1", "Trang một");
    const piece = await schedule();
    await pieces.claimDue(new Date(), 10);

    await publisher.tick();

    expect((await pieces.find(workspaceId, piece.id))?.status).toBe(
      "PUBLISHING",
    );
  });

  it("posts the banner as a photo when a piece has one", async () => {
    await connect("page-1", "Trang một");
    const piece = await schedule();
    await pieces.update(
      workspaceId,
      piece.id,
      { imageKey: `${piece.id}.png` },
      userId,
    );

    const withStore = new ContentPublisher({
      accounts,
      secrets,
      keyring,
      pieces,
      store: {
        presignGet: async () => "https://cdn.test/banner.png",
      } as never,
    });
    await withStore.tick();

    expect(sentTo).toEqual(["page-1"]);
    expect(endpoints).toEqual(["photos"]);
    expect(posted[0]?.message).toBe("Nội dung kiểm tra.");
  });

  it("posts words when a piece has no banner", async () => {
    await connect("page-1", "Trang một");
    await schedule();

    await publisher.tick();

    expect(endpoints).toEqual(["feed"]);
  });

  it("still posts when the banner cannot be signed", async () => {
    // Words without a picture is a worse post; no post at all is a worse
    // outcome.
    await connect("page-1", "Trang một");
    const piece = await schedule();
    await pieces.update(
      workspaceId,
      piece.id,
      { imageKey: `${piece.id}.png` },
      userId,
    );

    const broken = new ContentPublisher({
      accounts,
      secrets,
      keyring,
      pieces,
      store: {
        presignGet: async () => {
          throw new Error("MinIO không trả lời");
        },
      } as never,
    });
    await broken.tick();

    expect(endpoints).toEqual(["feed"]);
    expect((await pieces.find(workspaceId, piece.id))?.status).toBe(
      "PUBLISHED",
    );
  });

  it("tells somebody when a post fails", async () => {
    // The whole reason this exists: the sweep runs at eight in the morning and
    // nobody is looking at the calendar then.
    const sent: { title: string; reason: string }[][] = [];
    const piece = await schedule();

    const telling = new ContentPublisher({
      accounts,
      secrets,
      keyring,
      pieces,
      notifier: {
        send: async (alerts) => {
          sent.push(alerts.map((a) => ({ title: a.title, reason: a.reason })));
        },
      },
      appUrl: "https://app.local",
    });
    await telling.tick();

    expect(sent).toHaveLength(1);
    expect(sent[0]![0]!.title).toContain(piece.title);
    expect(sent[0]![0]!.reason).toContain("Kênh mạng xã hội");
  });

  it("sends one alert for a whole sweep, not one per post", async () => {
    // A token that expires fails every post due that morning. One email per
    // post is ten identical messages nobody reads.
    await schedule({ body: "Bài một" });
    await schedule({ body: "Bài hai" });
    await schedule({ body: "Bài ba" });

    const batches: number[] = [];
    const telling = new ContentPublisher({
      accounts,
      secrets,
      keyring,
      pieces,
      notifier: { send: async (alerts) => void batches.push(alerts.length) },
    });
    await telling.tick();

    expect(batches).toEqual([3]);
  });

  it("says nothing when nothing went wrong", async () => {
    await connect("page-1", "Trang một");
    await schedule();

    const calls: number[] = [];
    const telling = new ContentPublisher({
      accounts,
      secrets,
      keyring,
      pieces,
      notifier: { send: async (alerts) => void calls.push(alerts.length) },
    });
    await telling.tick();

    expect(calls).toEqual([]);
  });

  it("keeps the post's own words out of the alert", async () => {
    // A title is what somebody recognises the post by. The body is their
    // marketing copy and does not belong sitting on a mail server.
    const secretBody = "Nội dung riêng không được rời khỏi hệ thống.";
    await schedule({ body: secretBody });

    const seen: string[] = [];
    const telling = new ContentPublisher({
      accounts,
      secrets,
      keyring,
      pieces,
      notifier: {
        send: async (alerts) => void seen.push(JSON.stringify(alerts)),
      },
    });
    await telling.tick();

    expect(seen.join()).not.toContain(secretBody);
  });

  it("still marks the piece failed when the alert cannot be sent", async () => {
    // A mail server being down must not become a second failure: the post has
    // been dealt with either way.
    const piece = await schedule();

    const broken = new ContentPublisher({
      accounts,
      secrets,
      keyring,
      pieces,
      notifier: {
        send: async () => {
          throw new Error("SMTP không trả lời");
        },
      },
    });
    await broken.tick();

    expect((await pieces.find(workspaceId, piece.id))?.status).toBe("FAILED");
  });

  it("counts what went out and what did not", async () => {
    await connect("page-1", "Trang một");
    await schedule();
    await publisher.tick();

    const scraped = await metrics.scrape();
    expect(scraped).toContain(
      'social_publishes_total{connector="facebook",outcome="ok"} 1',
    );
  });

  it("keeps one workspace's calendar out of another's sweep", async () => {
    // The sweep is not scoped to a workspace — it runs for all of them — so
    // the isolation has to come from the piece's own workspace being the one
    // whose connection is opened.
    await connect("page-1", "Trang một");
    const mine = await schedule();

    const otherWorkspaceId = newId("workspace") as WorkspaceId;
    await db.insert(workspaces).values({
      id: otherWorkspaceId,
      organizationId: (await db.select().from(organizations))[0]!.id,
      name: "B",
      slug: `b-${otherWorkspaceId.slice(-8).toLowerCase()}`,
    });
    const theirs = await pieces.create(
      {
        workspaceId: otherWorkspaceId,
        campaignId: null,
        title: "Của workspace khác",
        body: "Không được đăng bằng kênh của người khác.",
        hashtags: [],
        channel: "facebook",
        scheduledAt: new Date(Date.now() - 60_000),
      },
      userId,
    );
    await pieces.update(
      otherWorkspaceId,
      theirs.id,
      { status: "APPROVED" },
      userId,
    );

    await publisher.tick();

    expect(posted).toHaveLength(1);
    expect((await pieces.find(workspaceId, mine.id))?.status).toBe("PUBLISHED");
    const other = await pieces.find(otherWorkspaceId, theirs.id);
    expect(other?.status).toBe("FAILED");
    expect(other?.lastError).toContain("Kênh mạng xã hội");
  });

  it("sends a piece that belongs to a campaign the same as a loose one", async () => {
    await connect("page-1", "Trang một");
    const campaign = await campaigns.create(
      { workspaceId, name: "Tháng 8" },
      userId,
    );
    const piece = await schedule();
    await pieces.update(
      workspaceId,
      piece.id,
      { campaignId: campaign.id },
      userId,
    );

    await publisher.tick();

    expect((await pieces.find(workspaceId, piece.id))?.status).toBe(
      "PUBLISHED",
    );
  });
});
