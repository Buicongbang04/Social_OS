import { Controller, Get, Headers, Query } from "@nestjs/common";
import { ValidationError, isId } from "@repo/core";
import type { WorkspaceId } from "@repo/core";
import { RequirePermission } from "../../common/decorators/require-permission.decorator";
import { WORKSPACE_ID_HEADER } from "../../common/guards/permission.guard";
import { DashboardService } from "./dashboard.service";

/** The longest window one call will draw. */
const MAX_DAYS = 90;
const DEFAULT_DAYS = 14;

/**
 * The overview page's numbers.
 *
 * `workspace.execution.read`, the same permission the spend report uses: this
 * aggregates what somebody can already read one execution at a time, and a
 * separate permission for the summary would let a role see every individual
 * number while being refused their total, which protects nothing.
 */
@Controller("dashboard")
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @RequirePermission("workspace.execution.read")
  @Get()
  async overview(
    @Headers(WORKSPACE_ID_HEADER) workspaceHeader: string,
    @Query("days") days?: string,
    @Query("tz") tz?: string,
  ) {
    return this.dashboard.overview(requireWorkspace(workspaceHeader), {
      days: parseDays(days),
      timeZone: parseTimeZone(tz),
    });
  }
}

/**
 * The window, in days. Clamped rather than rejected, as on `/usage`: somebody
 * asking for 9999 wants everything, and answering with the maximum is more use
 * than an error about a number they did not think about.
 */
function parseDays(raw: string | undefined): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_DAYS;
  return Math.min(Math.floor(parsed), MAX_DAYS);
}

/**
 * Which clock decides where one day ends and the next begins.
 *
 * Validated here rather than passed through, because it reaches Postgres as a
 * time-zone name: an unknown one fails the whole query with a database error
 * about a zone, which is a strange thing for a dashboard to say. Anything
 * unrecognised falls back to the zone this platform is run from.
 */
function parseTimeZone(raw: string | undefined): string {
  if (!raw) return "Asia/Ho_Chi_Minh";
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: raw }).format(new Date());
    return raw;
  } catch {
    return "Asia/Ho_Chi_Minh";
  }
}

function requireWorkspace(header: string | undefined): WorkspaceId {
  if (!header || !isId("workspace", header)) {
    throw new ValidationError(`Thiếu hoặc sai header ${WORKSPACE_ID_HEADER}.`);
  }
  return header;
}
