import { Controller, Get, Headers, Query } from "@nestjs/common";
import { ValidationError, isId } from "@repo/core";
import type { WorkspaceId } from "@repo/core";
import { RequirePermission } from "../../common/decorators/require-permission.decorator";
import { WORKSPACE_ID_HEADER } from "../../common/guards/permission.guard";
import { GoalsService } from "./goals.service";

/** The longest window that can be asked for in one call. */
const MAX_DAYS = 365;

/**
 * What the workspace has spent on AI.
 *
 * `workspace.execution.read` rather than a new permission: this aggregates what
 * somebody can already read one execution at a time. Inventing a separate
 * permission for the sum would let a role see every individual cost while being
 * refused the total, which protects nothing.
 */
@Controller("usage")
export class UsageController {
  constructor(private readonly goals: GoalsService) {}

  @RequirePermission("workspace.execution.read")
  @Get()
  async spend(
    @Headers(WORKSPACE_ID_HEADER) workspaceHeader: string,
    @Query("days") days?: string,
  ) {
    return this.goals.spend(requireWorkspace(workspaceHeader), parseDays(days));
  }
}

/**
 * The window, in days.
 *
 * Clamped rather than rejected: somebody typing `?days=99999` wants everything,
 * and answering with a year is more useful than an error about a number they
 * did not think about.
 */
function parseDays(raw: string | undefined): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return 30;
  return Math.min(Math.floor(parsed), MAX_DAYS);
}

function requireWorkspace(header: string | undefined): WorkspaceId {
  if (!header || !isId("workspace", header)) {
    throw new ValidationError(`Thiếu hoặc sai header ${WORKSPACE_ID_HEADER}.`);
  }
  return header;
}
