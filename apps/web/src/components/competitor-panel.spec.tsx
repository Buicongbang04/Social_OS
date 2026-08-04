import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CompetitorPanel } from "./competitor-panel";

const client = { analyseCompetitor: vi.fn() };
vi.mock("../lib/api", () => ({ getClient: () => client }));

const result = (overrides: Record<string, unknown> = {}) => ({
  object: {
    positioning: "Mua hộ hàng Nhật, phí rõ ràng",
    audience: "Người mua lẻ ở Việt Nam",
    offers: ["Mua hộ", "Vận chuyển"],
    topics: ["Phí", "Thời gian giao"],
    tone: "Thân thiện",
    gaps: ["Không nói chính sách đổi trả"],
    ...(overrides.object as object),
  },
  page: {
    url: "https://doithu.com/",
    title: "Đối thủ",
    description: null,
    headings: [],
    text: "…",
  },
  model: "qwen2.5:7b",
  costUsd: "0.00021",
});

const analyse = async (value = "https://doithu.com/") => {
  render(<CompetitorPanel />);
  await userEvent.type(screen.getByPlaceholderText(/https:\/\/doithu/), value);
  await userEvent.click(screen.getByRole("button", { name: "Đọc trang" }));
};

beforeEach(() => {
  client.analyseCompetitor.mockResolvedValue(result());
});

describe("CompetitorPanel", () => {
  it("shows what the page says", async () => {
    await analyse();

    expect(
      await screen.findByText("Mua hộ hàng Nhật, phí rõ ràng"),
    ).toBeVisible();
    expect(screen.getByText("Mua hộ")).toBeVisible();
    expect(screen.getByText(/Thân thiện/)).toBeVisible();
  });

  it("keeps what the page did not say visually apart", async () => {
    // The gaps are the useful half and the one a model is most tempted to
    // invent. Mixed in with the rest, they read as something the competitor
    // claimed.
    await analyse();

    const heading = await screen.findByText("Trang này không nói gì về");
    expect(heading).toBeVisible();
    expect(heading.closest("div")).toHaveClass("bg-amber-50");
  });

  it("says nothing about gaps when the model found none", async () => {
    client.analyseCompetitor.mockResolvedValue(
      result({ object: { gaps: [] } }),
    );
    await analyse();

    await screen.findByText("Mua hộ hàng Nhật, phí rõ ràng");
    expect(screen.queryByText("Trang này không nói gì về")).toBeNull();
  });

  it("shows what the read cost", async () => {
    await analyse();

    expect(await screen.findByText(/qwen2\.5:7b · \$0\.00021/)).toBeVisible();
  });

  it("says plainly when a site refuses to be read", async () => {
    // robots.txt refusing is the expected case, not an error to bury: the
    // person needs to know the platform did not read it, and why.
    client.analyseCompetitor.mockRejectedValue(
      new Error("doithu.com không cho phép đọc /gia (robots.txt)."),
    );
    await analyse();

    // Matched on the site's own words, not on "robots.txt" alone: the panel
    // says that word up front too, and a query that matched both would pass
    // whether or not the error ever appeared.
    expect(await screen.findByText(/không cho phép đọc \/gia/)).toBeVisible();
  });

  it("drops a stale result when the next read fails", async () => {
    // Leaving the previous competitor's analysis on screen under a new URL's
    // error is how somebody reads one company's page as another's.
    await analyse();
    await screen.findByText("Mua hộ hàng Nhật, phí rõ ràng");

    client.analyseCompetitor.mockRejectedValue(new Error("mạng hỏng"));
    await userEvent.click(screen.getByRole("button", { name: "Đọc trang" }));

    expect(await screen.findByText(/mạng hỏng/)).toBeVisible();
    expect(screen.queryByText("Mua hộ hàng Nhật, phí rõ ràng")).toBeNull();
  });

  it("will not read an empty address", async () => {
    render(<CompetitorPanel />);

    expect(screen.getByRole("button", { name: "Đọc trang" })).toBeDisabled();
  });

  it("says up front that it respects robots.txt", async () => {
    // On screen rather than only in a commit message: somebody pasting a
    // competitor's URL should be able to see what the platform will and will
    // not do with it.
    render(<CompetitorPanel />);

    expect(screen.getByText(/robots\.txt/)).toBeVisible();
  });
});
