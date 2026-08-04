import type { ContentPiece, SocialConnection } from "@repo/sdk";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AlertBanner } from "./alert-banner";

const client = { listConnections: vi.fn(), listContentPieces: vi.fn() };
vi.mock("../lib/api", () => ({ getClient: () => client }));

const connection = (
  overrides: Partial<SocialConnection> = {},
): SocialConnection => ({
  id: "sac_1",
  connectorId: "facebook",
  externalId: "page-1",
  displayName: "Trang một",
  avatarUrl: null,
  scopes: [],
  status: "ACTIVE",
  expiresAt: null,
  connectedAt: "2026-08-01T00:00:00.000Z",
  ...overrides,
});

const piece = (overrides: Partial<ContentPiece> = {}): ContentPiece => ({
  id: "cnt_1",
  campaignId: null,
  socialAccountId: null,
  imageKey: null,
  title: "Mua hộ hàng Nhật",
  body: "Nội dung",
  hashtags: [],
  channel: "facebook",
  scheduledAt: null,
  status: "DRAFT",
  publishedPostId: null,
  publishedAt: null,
  lastError: null,
  ...overrides,
});

const show = async (
  connections: SocialConnection[] = [],
  pieces: ContentPiece[] = [],
) => {
  client.listConnections.mockResolvedValue(connections);
  client.listContentPieces.mockResolvedValue(pieces);
  render(<AlertBanner />);
  await waitFor(() => expect(client.listConnections).toHaveBeenCalled());
};

beforeEach(() => {
  client.listConnections.mockResolvedValue([]);
  client.listContentPieces.mockResolvedValue([]);
});

describe("AlertBanner", () => {
  it("shows nothing at all when nothing is broken", async () => {
    // A banner that is always there is a banner nobody reads.
    const { container } = render(<AlertBanner />);
    await waitFor(() => expect(client.listConnections).toHaveBeenCalled());

    expect(container).toBeEmptyDOMElement();
  });

  it("warns that an expired channel stops everything scheduled on it", async () => {
    await show([connection({ status: "EXPIRED" })]);

    expect(
      await screen.findByText(/Kênh "Trang một" đã hết hạn/),
    ).toBeVisible();
    expect(screen.getByText(/sẽ không đăng được/)).toBeVisible();
  });

  it("says something different when the permission was revoked", async () => {
    // Reconnecting fixes an expired token and does nothing for a revoked one
    // until the permission is granted again on the platform.
    await show([connection({ status: "REVOKED" })]);

    expect(await screen.findByText(/bị thu hồi quyền/)).toBeVisible();
    expect(screen.getByText(/Cấp lại quyền bên nền tảng/)).toBeVisible();
  });

  it("says nothing about a healthy channel", async () => {
    await show([connection({ status: "ACTIVE" })]);

    expect(screen.queryByText(/Kênh/)).toBeNull();
  });

  it("names the post when exactly one failed", async () => {
    await show([], [piece({ status: "FAILED" })]);

    expect(
      await screen.findByText(/Bài "Mua hộ hàng Nhật" không đăng được/),
    ).toBeVisible();
  });

  it("counts them instead when several failed", async () => {
    // Ten failures from one expired token is one problem, and ten identical
    // banners buries the channel warning that explains them.
    await show(
      [],
      [
        piece({ id: "cnt_1", status: "FAILED" }),
        piece({ id: "cnt_2", status: "FAILED" }),
        piece({ id: "cnt_3", status: "FAILED" }),
      ],
    );

    expect(await screen.findByText(/3 bài không đăng được/)).toBeVisible();
  });

  it("asks the server for the failures instead of filtering a whole calendar", async () => {
    // This runs every minute in every open tab. Fetching the whole calendar to
    // find the broken ones ships a year of post bodies to answer a question
    // about a number.
    await show();

    expect(client.listContentPieces).toHaveBeenCalledWith(
      expect.objectContaining({ status: "FAILED" }),
    );
  });

  it("says more-than rather than a number it does not have", async () => {
    // The read is capped. Stating the cap as the count would be a wrong number
    // said with total confidence.
    const many = Array.from({ length: 21 }, (_, i) =>
      piece({ id: `cnt_${i}`, status: "FAILED" }),
    );
    await show([], many);

    expect(await screen.findByText(/Hơn 20 bài không đăng được/)).toBeVisible();
  });

  it("puts the dead channel above the failed posts", async () => {
    // The channel is why the posts failed. Reading the consequence first sends
    // somebody to re-approve posts that will fail again.
    await show(
      [connection({ status: "EXPIRED" })],
      [piece({ status: "FAILED" })],
    );

    const messages = await screen.findAllByRole("status");
    const text = messages[0]!.textContent ?? "";
    expect(text.indexOf("Kênh")).toBeLessThan(text.indexOf("không đăng được"));
  });

  it("stays quiet when it cannot read anything", async () => {
    // A banner that cannot load must not become a banner about itself: every
    // panel below says what went wrong with its own read.
    client.listConnections.mockRejectedValue(new Error("mạng hỏng"));
    const { container } = render(<AlertBanner />);

    await waitFor(() => expect(client.listConnections).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("looks again on its own, without anybody touching the page", async () => {
    // A token expires and a post fails while nobody is interacting.
    vi.useFakeTimers();
    try {
      client.listConnections.mockResolvedValue([]);
      client.listContentPieces.mockResolvedValue([]);
      render(<AlertBanner />);
      await vi.advanceTimersByTimeAsync(0);
      client.listConnections.mockClear();

      await vi.advanceTimersByTimeAsync(61_000);

      expect(client.listConnections).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
