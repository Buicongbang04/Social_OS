import { Inject, Injectable } from "@nestjs/common";
import type { WorkspaceId } from "@repo/core";
import type {
  DrizzleAiUsageRepository,
  DrizzleContentPieceRepository,
  DrizzleExecutionRepository,
} from "@repo/database";
import {
  AI_USAGE_REPOSITORY,
  CONTENT_PIECE_REPOSITORY,
  EXECUTION_REPOSITORY,
} from "../../infra/database/database.module";

/** Executions the scheduler still has work to do on. */
const UNFINISHED: readonly string[] = [
  "CREATED",
  "VALIDATING",
  "PLANNING",
  "READY",
  "SCHEDULED",
  "RUNNING",
  "WAITING",
  "RETRYING",
  "CANCELLING",
];

export type DashboardReport = {
  from: string;
  to: string;
  timeZone: string;
  /** One entry per day in the window, including the days with nothing on them. */
  requestsByDay: { day: string; calls: number; costUsd: string }[];
  spend: {
    calls: number;
    costUsd: string;
    /** Calls whose model had no price, so `costUsd` is short by their cost. */
    unpricedCalls: number;
    todayUsd: string;
    todayCalls: number;
  };
  queue: {
    /** Not finished: still somewhere between submitted and done. */
    unfinished: number;
    /** Stopped, waiting for a person to approve or reject. */
    awaitingApproval: number;
    running: number;
    failed: number;
  };
  content: {
    drafts: number;
    approved: number;
    publishing: number;
    published: number;
    failed: number;
  };
};

/**
 * The numbers the overview page is made of.
 *
 * One service and one endpoint rather than the page calling four: an overview
 * assembled from four independent responses shows four different moments, and
 * the first one to fail leaves a screen that is partly blank with nothing
 * saying which part is missing.
 */
@Injectable()
export class DashboardService {
  constructor(
    @Inject(AI_USAGE_REPOSITORY)
    private readonly aiUsage: DrizzleAiUsageRepository,
    @Inject(EXECUTION_REPOSITORY)
    private readonly executions: DrizzleExecutionRepository,
    @Inject(CONTENT_PIECE_REPOSITORY)
    private readonly pieces: DrizzleContentPieceRepository,
  ) {}

  async overview(
    workspaceId: WorkspaceId,
    options: { days: number; timeZone: string },
  ): Promise<DashboardReport> {
    const { days, timeZone } = options;
    const to = new Date();
    // From the start of the first day, not from this time of day N days ago:
    // otherwise the oldest bar covers a part-day and reads as a quiet day.
    const from = startOfDay(
      new Date(to.getTime() - (days - 1) * 86_400_000),
      timeZone,
    );

    const [total, byDay, executionStatuses, pieceStatuses] = await Promise.all([
      this.aiUsage.summarise(workspaceId, from, to),
      this.aiUsage.countByDay(workspaceId, from, to, timeZone),
      this.executions.countByStatus(workspaceId),
      this.pieces.countByStatus(workspaceId),
    ]);

    const filled = fillDays(byDay, from, days, timeZone);
    const today = filled.at(-1);

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      timeZone,
      requestsByDay: filled,
      spend: {
        calls: total.calls,
        costUsd: total.costUsd,
        unpricedCalls: total.unpricedCalls,
        todayUsd: today?.costUsd ?? "0",
        todayCalls: today?.calls ?? 0,
      },
      queue: {
        unfinished: UNFINISHED.reduce(
          (sum, status) => sum + (executionStatuses[status] ?? 0),
          0,
        ),
        awaitingApproval: executionStatuses.WAITING ?? 0,
        running: executionStatuses.RUNNING ?? 0,
        failed: executionStatuses.FAILED ?? 0,
      },
      content: {
        drafts: pieceStatuses.DRAFT ?? 0,
        approved: pieceStatuses.APPROVED ?? 0,
        publishing: pieceStatuses.PUBLISHING ?? 0,
        published: pieceStatuses.PUBLISHED ?? 0,
        failed: pieceStatuses.FAILED ?? 0,
      },
    };
  }
}

/** `YYYY-MM-DD` for a moment, as read on a clock in that time zone. */
function dayKey(at: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD, which is what Postgres returned and what sorts
  // correctly as a string. Hand-assembling the parts would do the same job with
  // more room for an off-by-one on the month.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** How far ahead of UTC the zone is at that moment, in milliseconds. */
function offsetAt(at: Date, timeZone: string): number {
  // The wall clock in that zone, then read back as if it were UTC. The gap
  // between the two is the offset — measured rather than assumed, so it is
  // right in a zone that observes daylight saving.
  const wall = new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    dateStyle: "short",
    timeStyle: "medium",
  }).format(at);
  return new Date(`${wall.replace(" ", "T")}Z`).getTime() - at.getTime();
}

function startOfDay(at: Date, timeZone: string): Date {
  const midnight = new Date(`${dayKey(at, timeZone)}T00:00:00Z`);
  return new Date(midnight.getTime() - offsetAt(midnight, timeZone));
}

/**
 * Every day in the window, whether or not anything happened on it.
 *
 * A chart drawn only from the days that have rows compresses a quiet week into
 * a couple of bars sitting next to each other, which reads as steady use. The
 * empty days are the point.
 */
function fillDays(
  rows: { day: string; calls: number; costUsd: string }[],
  from: Date,
  days: number,
  timeZone: string,
): { day: string; calls: number; costUsd: string }[] {
  const found = new Map(rows.map((row) => [row.day, row]));

  return Array.from({ length: days }, (_, index) => {
    const day = dayKey(new Date(from.getTime() + index * 86_400_000), timeZone);
    return found.get(day) ?? { day, calls: 0, costUsd: "0" };
  });
}
