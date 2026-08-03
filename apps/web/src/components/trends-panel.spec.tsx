import type { TrendItem } from "@repo/sdk";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrendsPanel } from "./trends-panel";

const client = { listTrends: vi.fn() };
vi.mock("../lib/api", () => ({ getClient: () => client }));

const trend = (overrides: Partial<TrendItem> = {}): TrendItem => ({
  source: "google",
  title: "sân bay",
  volume: "200+",
  url: "https://tin.example/bai-viet",
  at: "2026-08-03T05:10:00.000Z",
  context: "Hành khách phải đi đâu để bắt xe công nghệ?",
  ...overrides,
});

beforeEach(() => {
  client.listTrends.mockResolvedValue([trend()]);
});

describe("TrendsPanel", () => {
  it("shows what is trending, with its source's own unit", async () => {
    // "184392" beside "20K+" with nothing to tell them apart invites reading
    // one as bigger than the other.
    client.listTrends.mockResolvedValue([
      trend(),
      trend({ source: "youtube", title: "Video", volume: "184392" }),
    ]);
    render(<TrendsPanel />);

    expect(await screen.findByText("200+ lượt tìm")).toBeVisible();
    expect(screen.getByText("184.392 lượt xem")).toBeVisible();
  });

  it("asks the source that was picked", async () => {
    render(<TrendsPanel />);
    await screen.findByText("sân bay");

    await userEvent.click(screen.getByRole("button", { name: "YouTube" }));

    await waitFor(() =>
      expect(client.listTrends).toHaveBeenCalledWith(
        expect.objectContaining({ source: "youtube" }),
      ),
    );
  });

  it("builds a brief out of the term and the headline that explains it", async () => {
    // The term on its own tells a model nothing about what to write; the
    // headline under it is the whole reason the term is trending.
    const used = vi.fn();
    render(<TrendsPanel onUseAsBrief={used} />);
    await screen.findByText("sân bay");

    await userEvent.click(screen.getByRole("button", { name: "Viết bài" }));

    expect(used).toHaveBeenCalledWith(
      'Người Việt đang tìm nhiều về "sân bay". Bối cảnh: Hành khách phải đi đâu để bắt xe công nghệ?',
    );
  });

  it("still builds a brief when there is no headline", async () => {
    const used = vi.fn();
    client.listTrends.mockResolvedValue([trend({ context: null })]);
    render(<TrendsPanel onUseAsBrief={used} />);
    await screen.findByText("sân bay");

    await userEvent.click(screen.getByRole("button", { name: "Viết bài" }));

    expect(used).toHaveBeenCalledWith(
      'Người Việt đang tìm nhiều về "sân bay".',
    );
  });

  it("says a YouTube trend is a video, not a search", async () => {
    const used = vi.fn();
    client.listTrends.mockResolvedValue([
      trend({ source: "youtube", title: "Đi chợ Nhật", context: "Tiximax" }),
    ]);
    render(<TrendsPanel onUseAsBrief={used} />);
    await screen.findByText("Đi chợ Nhật");

    await userEvent.click(screen.getByRole("button", { name: "Viết bài" }));

    expect(used).toHaveBeenCalledWith(
      'Video đang thịnh hành trên YouTube: "Đi chợ Nhật". Bối cảnh: Tiximax',
    );
  });

  it("offers no write button where there is nowhere to write to", async () => {
    render(<TrendsPanel />);
    await screen.findByText("sân bay");

    expect(screen.queryByRole("button", { name: "Viết bài" })).toBeNull();
  });

  it("opens the source in a new tab, without handing it this page", async () => {
    render(<TrendsPanel />);

    const link = await screen.findByRole("link", { name: "sân bay" });
    expect(link).toHaveAttribute("href", "https://tin.example/bai-viet");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("says a source is empty rather than looking like it is still loading", async () => {
    client.listTrends.mockResolvedValue([]);
    render(<TrendsPanel />);

    expect(
      await screen.findByText("Nguồn này chưa có gì cho hôm nay."),
    ).toBeVisible();
  });

  it("surfaces a missing YouTube key instead of an empty list", async () => {
    // The one failure a person can act on: it names the key to set.
    client.listTrends.mockRejectedValue(
      new Error('Chưa có khoá YouTube. Lưu một khoá tên "sources/youtube"'),
    );
    render(<TrendsPanel />);

    expect(await screen.findByText(/sources\/youtube/)).toBeVisible();
  });
});
