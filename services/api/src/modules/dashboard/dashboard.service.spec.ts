import type { WorkspaceId } from "@repo/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardService } from "./dashboard.service";

const WORKSPACE = "wsp_01J000000000000000000000" as WorkspaceId;
const TZ = "Asia/Ho_Chi_Minh";

const aiUsage = {
  summarise: vi.fn(),
  countByDay: vi.fn(),
};
const executions = { countByStatus: vi.fn() };
const pieces = { countByStatus: vi.fn() };

const service = () =>
  new DashboardService(aiUsage as never, executions as never, pieces as never);

/** `YYYY-MM-DD` for a day offset from today, on the Vietnamese clock. */
const dayKey = (offsetDays: number): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.now() + offsetDays * 86_400_000));

beforeEach(() => {
  aiUsage.summarise.mockResolvedValue({
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: "0",
    unpricedCalls: 0,
  });
  aiUsage.countByDay.mockResolvedValue([]);
  executions.countByStatus.mockResolvedValue({});
  pieces.countByStatus.mockResolvedValue({});
});

describe("DashboardService", () => {
  it("returns a bar for every day, including the empty ones", async () => {
    // A chart drawn only from the days that have rows compresses a quiet week
    // into two bars side by side, which reads as steady use.
    aiUsage.countByDay.mockResolvedValue([
      { day: dayKey(0), calls: 3, costUsd: "0.5" },
    ]);

    const report = await service().overview(WORKSPACE, {
      days: 7,
      timeZone: TZ,
    });

    expect(report.requestsByDay).toHaveLength(7);
    expect(report.requestsByDay.filter((d) => d.calls === 0)).toHaveLength(6);
  });

  it("puts the days in order, oldest first", async () => {
    const report = await service().overview(WORKSPACE, {
      days: 5,
      timeZone: TZ,
    });

    const days = report.requestsByDay.map((d) => d.day);
    expect(days).toEqual([...days].sort());
    expect(days.at(-1)).toBe(dayKey(0));
    expect(days[0]).toBe(dayKey(-4));
  });

  it("asks for the window from the start of the oldest day", async () => {
    // From this time of day N days ago instead, the oldest bar covers a part
    // day and reads as a quiet one.
    await service().overview(WORKSPACE, { days: 7, timeZone: TZ });

    const from = aiUsage.countByDay.mock.calls[0]![1] as Date;
    expect(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: TZ,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(from),
    ).toContain("00:00");
  });

  it("counts today from the clock the reader is looking at", async () => {
    // Bucketed in UTC, everything done in Vietnam before 7am lands on
    // yesterday, and "hôm nay" on the dashboard disagrees with the wall.
    aiUsage.countByDay.mockResolvedValue([
      { day: dayKey(-1), calls: 9, costUsd: "9" },
      { day: dayKey(0), calls: 2, costUsd: "0.25" },
    ]);

    const report = await service().overview(WORKSPACE, {
      days: 3,
      timeZone: TZ,
    });

    expect(report.spend.todayCalls).toBe(2);
    expect(report.spend.todayUsd).toBe("0.25");
  });

  it("adds up every status the scheduler still has work on", async () => {
    // "Đang chờ" is not one status: an execution being planned, queued or held
    // for approval is all the same thing to somebody waiting for a post.
    executions.countByStatus.mockResolvedValue({
      CREATED: 1,
      PLANNING: 2,
      WAITING: 3,
      RUNNING: 4,
      COMPLETED: 100,
      FAILED: 5,
    });

    const report = await service().overview(WORKSPACE, {
      days: 7,
      timeZone: TZ,
    });

    expect(report.queue.unfinished).toBe(10);
    expect(report.queue.awaitingApproval).toBe(3);
    expect(report.queue.running).toBe(4);
    expect(report.queue.failed).toBe(5);
  });

  it("carries the statuses raw as well, because the summed fields overlap", async () => {
    // `unfinished` contains `running` and `awaitingApproval`. A chart drawn
    // from those three would count the same Execution up to three times; these
    // do not overlap.
    const byStatus = { WAITING: 3, RUNNING: 4, COMPLETED: 100 };
    executions.countByStatus.mockResolvedValue(byStatus);

    const report = await service().overview(WORKSPACE, {
      days: 7,
      timeZone: TZ,
    });

    expect(report.queue.byStatus).toEqual(byStatus);
    expect(
      Object.values(report.queue.byStatus).reduce((a, b) => a + b, 0),
    ).toBe(107);
  });

  it("leaves finished executions out of the waiting count", async () => {
    executions.countByStatus.mockResolvedValue({
      COMPLETED: 40,
      CANCELLED: 2,
      ARCHIVED: 7,
      FAILED: 1,
    });

    const report = await service().overview(WORKSPACE, {
      days: 7,
      timeZone: TZ,
    });

    expect(report.queue.unfinished).toBe(0);
  });

  it("carries the unpriced count beside the total", async () => {
    // A model with no price contributes nothing to the sum, so a figure shown
    // without that count is quietly understated by an unknown amount.
    aiUsage.summarise.mockResolvedValue({
      calls: 12,
      inputTokens: 1,
      outputTokens: 2,
      costUsd: "1.2345",
      unpricedCalls: 4,
    });

    const report = await service().overview(WORKSPACE, {
      days: 7,
      timeZone: TZ,
    });

    expect(report.spend.costUsd).toBe("1.2345");
    expect(report.spend.unpricedCalls).toBe(4);
  });

  it("reports zero rather than nothing for a workspace that has done nothing", async () => {
    const report = await service().overview(WORKSPACE, {
      days: 7,
      timeZone: TZ,
    });

    expect(report.spend.todayUsd).toBe("0");
    expect(report.content).toEqual({
      drafts: 0,
      approved: 0,
      publishing: 0,
      published: 0,
      failed: 0,
    });
  });
});
