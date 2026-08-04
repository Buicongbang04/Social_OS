import type { DashboardReport } from "@repo/sdk";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardPanel } from "./dashboard-panel";

const client = { dashboard: vi.fn() };

vi.mock("../lib/api", () => ({ getClient: () => client }));

const report = (overrides: Partial<DashboardReport> = {}): DashboardReport => ({
  from: "2026-07-22T17:00:00.000Z",
  to: "2026-08-04T10:00:00.000Z",
  timeZone: "Asia/Ho_Chi_Minh",
  requestsByDay: [
    { day: "2026-08-02", calls: 4, costUsd: "0.04" },
    { day: "2026-08-03", calls: 0, costUsd: "0" },
    { day: "2026-08-04", calls: 12, costUsd: "0.31" },
  ],
  spend: {
    calls: 16,
    costUsd: "0.35",
    unpricedCalls: 0,
    todayUsd: "0.31",
    todayCalls: 12,
  },
  queue: { unfinished: 3, awaitingApproval: 1, running: 2, failed: 0 },
  content: {
    drafts: 5,
    approved: 2,
    publishing: 0,
    published: 9,
    failed: 0,
  },
  ...overrides,
});

const show = async (given: DashboardReport = report()) => {
  client.dashboard.mockResolvedValue(given);
  render(<DashboardPanel />);
  await screen.findByText("Request mỗi ngày");
};

beforeEach(() => {
  client.dashboard.mockReset();
});

describe("DashboardPanel", () => {
  it("answers the three questions the overview is for", async () => {
    await show();

    expect(screen.getByText("Request hôm nay").nextSibling).toHaveTextContent(
      "12",
    );
    expect(screen.getByText("Tiền đã dùng").nextSibling).toHaveTextContent(
      "$0.35",
    );
    expect(screen.getByText("Việc đang chờ").nextSibling).toHaveTextContent(
      "3",
    );
  });

  it("draws a bar for every day, including the days with nothing", async () => {
    // A chart drawn only from the busy days compresses a quiet week into two
    // bars side by side, which reads as steady use.
    await show();

    expect(screen.getAllByTestId("bar")).toHaveLength(3);
  });

  it("scales the bars against the busiest day", async () => {
    await show();

    const [first, quiet, busiest] = screen.getAllByTestId("bar");
    expect(busiest).toHaveStyle({ height: "100%" });
    expect(first).toHaveStyle({ height: `${(4 / 12) * 100}%` });
    // A day with nothing on it draws nothing, rather than the minimum sliver a
    // day with one request gets.
    expect(quiet).toHaveStyle({ height: "0%" });
  });

  it("says how short the total is when some calls had no price", async () => {
    // A model with no price contributes nothing to the sum, so the figure is
    // understated by an unknown amount — said beside the number, not in a
    // footnote nobody reads.
    await show(
      report({
        spend: {
          calls: 16,
          costUsd: "0.35",
          unpricedCalls: 4,
          todayUsd: "0.31",
          todayCalls: 12,
        },
      }),
    );

    expect(
      screen.getByText(/Chưa tính 4 lượt không có bảng giá/),
    ).toBeVisible();
  });

  it("says when a post failed to go out, in words and not only in colour", async () => {
    await show(
      report({
        content: {
          drafts: 5,
          approved: 2,
          publishing: 0,
          published: 9,
          failed: 3,
        },
      }),
    );

    expect(screen.getByText(/3 bài đăng hỏng/)).toBeVisible();
  });

  it("shows the same numbers as text for anyone who cannot hover", async () => {
    await show();
    await userEvent.click(screen.getByText("Xem dạng bảng"));

    const table = screen.getByRole("table");
    expect(within(table).getByText("04/08")).toBeVisible();
    expect(within(table).getAllByText("12").length).toBeGreaterThan(0);
  });

  it("reloads when the window changes, and asks for the window chosen", async () => {
    await show();

    await userEvent.click(screen.getByRole("button", { name: "30 ngày" }));

    await waitFor(() => expect(client.dashboard).toHaveBeenCalledWith(30));
  });

  it("says so rather than showing an empty chart when nothing has run", async () => {
    await show(
      report({
        requestsByDay: [
          { day: "2026-08-03", calls: 0, costUsd: "0" },
          { day: "2026-08-04", calls: 0, costUsd: "0" },
        ],
      }),
    );

    expect(screen.getByText(/Chưa có request nào/)).toBeVisible();
  });

  it("reports a failure instead of leaving the numbers at zero", async () => {
    // Zeroes on a broken load read as a quiet week, which is the one wrong
    // answer this panel must never give.
    client.dashboard.mockRejectedValue(new Error("mất mạng"));
    render(<DashboardPanel />);

    expect(await screen.findByText(/mất mạng/)).toBeVisible();
    expect(screen.queryByText("Request hôm nay")).toBeNull();
  });
});
