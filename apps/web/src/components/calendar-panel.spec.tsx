import type { ContentPiece, SocialConnection } from "@repo/sdk";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CalendarPanel } from "./calendar-panel";

/**
 * The calendar, as somebody sees it.
 *
 * These cover the decisions the screen makes on its own and nowhere else: which
 * button appears for which status, whether a Page picker is offered at all, and
 * what an approval sends. Getting those wrong shows up as a post that cannot be
 * approved or one sent to the wrong audience, and until now nothing caught it.
 */
const client = {
  listContentPieces: vi.fn(),
  listCampaigns: vi.fn(),
  listConnections: vi.fn(),
  createCampaign: vi.fn(),
  updateContentPiece: vi.fn(),
  archiveContentPiece: vi.fn(),
  renderBanner: vi.fn(),
};

vi.mock("../lib/api", () => ({ getClient: () => client }));

const piece = (overrides: Partial<ContentPiece> = {}): ContentPiece => ({
  id: "cnt_1",
  campaignId: null,
  socialAccountId: null,
  imageKey: null,
  title: "Bài viết",
  body: "Nội dung",
  hashtags: [],
  channel: "facebook",
  scheduledAt: "2026-08-15T02:00:00.000Z",
  status: "DRAFT",
  publishedPostId: null,
  publishedAt: null,
  lastError: null,
  ...overrides,
});

const connection = (
  id: string,
  displayName: string,
  connectorId = "facebook",
): SocialConnection => ({
  id,
  connectorId,
  externalId: id,
  displayName,
  avatarUrl: null,
  scopes: [],
  status: "ACTIVE",
  expiresAt: null,
  connectedAt: "2026-08-01T00:00:00.000Z",
});

const show = async (
  pieces: ContentPiece[],
  connections: SocialConnection[] = [],
) => {
  client.listContentPieces.mockResolvedValue(pieces);
  client.listCampaigns.mockResolvedValue([]);
  client.listConnections.mockResolvedValue(connections);
  render(<CalendarPanel />);
  await screen.findByText("Bài viết");
};

beforeEach(() => {
  client.renderBanner.mockResolvedValue({ piece: piece(), url: "http://x/y" });
  client.updateContentPiece.mockResolvedValue(piece());
  client.archiveContentPiece.mockResolvedValue(undefined);
});

describe("CalendarPanel", () => {
  it("offers approval on a draft", async () => {
    await show([piece({ status: "DRAFT" })]);

    await userEvent.click(screen.getByRole("button", { name: "Duyệt" }));

    expect(client.updateContentPiece).toHaveBeenCalledWith("cnt_1", {
      status: "APPROVED",
    });
  });

  it("never offers approval on something already published", async () => {
    // Approving a published piece would send it a second time — the one
    // mistake in this whole feature that cannot be undone.
    await show([piece({ status: "PUBLISHED", publishedPostId: "p_1" })]);

    expect(screen.queryByRole("button", { name: /Duyệt/ })).toBeNull();
  });

  it("offers a way back after a failure", async () => {
    // A post that failed for a reason somebody has since fixed needs a route
    // back without being rewritten.
    await show([piece({ status: "FAILED", lastError: "token hết hạn" })]);

    expect(screen.getByRole("button", { name: "Duyệt lại" })).toBeVisible();
    expect(screen.getByText("token hết hạn")).toBeVisible();
  });

  it("does not offer approval while a piece is going out", async () => {
    await show([piece({ status: "PUBLISHING" })]);

    expect(screen.queryByRole("button", { name: /Duyệt/ })).toBeNull();
    expect(screen.getByText("đang đăng")).toBeVisible();
  });

  it("links to the post once there is one", async () => {
    // A calendar that says "đã đăng" with no way to go and look is asking to
    // be taken on trust.
    await show([piece({ status: "PUBLISHED", publishedPostId: "page_1_99" })]);

    expect(screen.getByRole("link", { name: "Xem bài" })).toHaveAttribute(
      "href",
      "https://www.facebook.com/page_1_99",
    );
  });

  it("offers no Page picker when there is nothing to choose", async () => {
    // A select with one option is a decision the screen is pretending to
    // offer.
    await show([piece()], [connection("sac_1", "Trang một")]);

    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("offers a Page picker once a second Page is connected", async () => {
    await show(
      [piece()],
      [connection("sac_1", "Trang một"), connection("sac_2", "Trang hai")],
    );

    const picker = screen.getByRole("combobox", {
      name: 'Trang đăng cho "Bài viết"',
    });
    await userEvent.selectOptions(picker, "sac_2");

    expect(client.updateContentPiece).toHaveBeenCalledWith("cnt_1", {
      socialAccountId: "sac_2",
    });
  });

  it("sends null, not an empty string, when the Page is cleared", async () => {
    // "" is an account id that matches nothing. null is what the server reads
    // as "the only account on this channel".
    await show(
      [piece({ socialAccountId: "sac_2" })],
      [connection("sac_1", "Trang một"), connection("sac_2", "Trang hai")],
    );

    await userEvent.selectOptions(screen.getByRole("combobox"), "");

    expect(client.updateContentPiece).toHaveBeenCalledWith("cnt_1", {
      socialAccountId: null,
    });
  });

  it("shows the Page as text once the post is out, not as a picker", async () => {
    // Which Page a published post went to is a fact. A dropdown over a fact
    // invites somebody to think they can move it.
    await show(
      [
        piece({
          status: "PUBLISHED",
          publishedPostId: "p_1",
          socialAccountId: "sac_2",
        }),
      ],
      [connection("sac_1", "Trang một"), connection("sac_2", "Trang hai")],
    );

    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText("Trang hai")).toBeVisible();
  });

  it("ignores Pages on other channels when deciding to offer a picker", async () => {
    // Two connections, one Facebook and one TikTok, is not a choice for a
    // Facebook post.
    await show(
      [piece({ channel: "facebook" })],
      [
        connection("sac_1", "Trang một"),
        connection("sac_9", "Kênh TikTok", "tiktok"),
      ],
    );

    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("keeps undated pieces out of the days, at the end", async () => {
    // A draft with no date shown on some arbitrary day would be lying about
    // when it goes out.
    await show([
      piece({ id: "cnt_1", title: "Bài viết", scheduledAt: null }),
      piece({
        id: "cnt_2",
        title: "Đã hẹn",
        scheduledAt: "2026-08-15T02:00:00.000Z",
      }),
    ]);

    const undated = screen.getByText("Chưa hẹn ngày").closest("div")!;
    expect(within(undated).getByText("Bài viết")).toBeVisible();
    expect(within(undated).queryByText("Đã hẹn")).toBeNull();
  });

  it("reloads after a change, so the row shows what the server stored", async () => {
    await show([piece({ status: "DRAFT" })]);
    client.listContentPieces.mockClear();

    await userEvent.click(screen.getByRole("button", { name: "Duyệt" }));

    await waitFor(() => expect(client.listContentPieces).toHaveBeenCalled());
  });

  it("offers to draw a banner, and says so once there is one", async () => {
    await show([piece()]);
    expect(screen.getByRole("button", { name: "Vẽ ảnh" })).toBeVisible();

    cleanup();
    await show([piece({ imageKey: "cnt_1.png" })]);
    expect(screen.getByRole("button", { name: "Vẽ lại ảnh" })).toBeVisible();
    expect(screen.getByText("có ảnh")).toBeVisible();
  });

  it("does not offer a banner once the post is out", async () => {
    // Drawing one then would store a picture nobody will ever see attached to
    // it.
    await show([piece({ status: "PUBLISHED", publishedPostId: "p_1" })]);

    expect(screen.queryByRole("button", { name: /Vẽ/ })).toBeNull();
  });

  it("reloads after drawing, so the row shows the piece has a picture", async () => {
    await show([piece()]);
    client.listContentPieces.mockClear();

    await userEvent.click(screen.getByRole("button", { name: "Vẽ ảnh" }));

    await waitFor(() => expect(client.listContentPieces).toHaveBeenCalled());
  });

  it("says what went wrong instead of failing silently", async () => {
    await show([piece({ status: "DRAFT" })]);
    client.updateContentPiece.mockRejectedValue(new Error("mạng hỏng"));

    await userEvent.click(screen.getByRole("button", { name: "Duyệt" }));

    expect(await screen.findByText(/mạng hỏng/)).toBeVisible();
  });
});
