import type { CampaignReportRow } from "@repo/sdk";
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReportPanel } from "./report-panel";

const client = { campaignReport: vi.fn() };
vi.mock("../lib/api", () => ({ getClient: () => client }));

const row = (
  overrides: Partial<CampaignReportRow> = {},
): CampaignReportRow => ({
  campaignId: "cmp_1",
  name: "Tháng 8",
  status: "ACTIVE",
  drafts: 2,
  approved: 1,
  published: 3,
  failed: 0,
  likes: 40,
  comments: 5,
  shares: 2,
  postsWithoutStats: 0,
  ...overrides,
});

beforeEach(() => {
  client.campaignReport.mockResolvedValue({ rows: [row()], unreadable: [] });
});

describe("ReportPanel", () => {
  it("shows what each campaign wrote and what it got", async () => {
    render(<ReportPanel />);

    const line = (await screen.findByText("Tháng 8")).closest("tr")!;
    expect(within(line).getByText("3")).toBeVisible();
    expect(within(line).getByText("40")).toBeVisible();
  });

  it("warns on the row whose numbers are incomplete", async () => {
    // Said where the total is read, not once at the bottom: a number missing
    // some posts is misleading exactly at the point somebody looks at it.
    client.campaignReport.mockResolvedValue({
      rows: [row({ postsWithoutStats: 4 })],
      unreadable: [],
    });
    render(<ReportPanel />);

    expect(await screen.findByText("4 bài chưa có số liệu")).toBeVisible();
  });

  it("says nothing about missing numbers when none are missing", async () => {
    render(<ReportPanel />);
    await screen.findByText("Tháng 8");

    expect(screen.queryByText(/chưa có số liệu/)).toBeNull();
  });

  it("names a channel whose numbers could not be read", async () => {
    // Every total below is an undercount, and the reader has no other way to
    // find out.
    client.campaignReport.mockResolvedValue({
      rows: [row()],
      unreadable: [{ account: "Trang một", reason: "token hết hạn" }],
    });
    render(<ReportPanel />);

    expect(
      await screen.findByText(/Chưa đọc được số liệu của Trang một/),
    ).toBeVisible();
  });

  it("shows the loose pieces under their own name", async () => {
    client.campaignReport.mockResolvedValue({
      rows: [row({ campaignId: null, name: "Không thuộc chiến dịch nào" })],
      unreadable: [],
    });
    render(<ReportPanel />);

    expect(await screen.findByText("Không thuộc chiến dịch nào")).toBeVisible();
  });

  it("says there is nothing yet rather than showing an empty table", async () => {
    client.campaignReport.mockResolvedValue({ rows: [], unreadable: [] });
    render(<ReportPanel />);

    expect(
      await screen.findByText("Chưa có nội dung nào để tổng kết."),
    ).toBeVisible();
  });

  it("surfaces a failure instead of sitting on Đang tải", async () => {
    client.campaignReport.mockRejectedValue(new Error("mạng hỏng"));
    render(<ReportPanel />);

    expect(await screen.findByText(/mạng hỏng/)).toBeVisible();
    expect(screen.queryByText("Đang tải…")).toBeNull();
  });
});
