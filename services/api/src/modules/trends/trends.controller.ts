import { Controller, Get, Headers, Query } from "@nestjs/common";
import { ValidationError, isId } from "@repo/core";
import type { WorkspaceId } from "@repo/core";
import { TREND_SOURCES } from "@repo/trends";
import { z } from "zod";
import { RequirePermission } from "../../common/decorators/require-permission.decorator";
import { WORKSPACE_ID_HEADER } from "../../common/guards/permission.guard";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { TrendsService } from "./trends.service";

const trendQuerySchema = z.object({
  source: z.enum(TREND_SOURCES).default("google"),
  /**
   * ISO 3166-1 alpha-2, two letters.
   *
   * Not validated against a list of real countries: both sources answer an
   * unknown one with an empty list, and a list kept here would go stale on
   * the day a country changes and be wrong in a way nobody notices.
   */
  geo: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/, "Mã quốc gia phải là hai chữ cái, ví dụ VN.")
    .default("VN"),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/**
 * What people are searching for and watching.
 *
 * `workspace.workflow.read` rather than the studio's `execute`: reading a
 * trend costs nothing a workspace is billed for. Google's feed is free and
 * YouTube's chart is one quota unit against a daily ten thousand — treating it
 * like spending would keep it from the people it is for.
 */
@Controller("trends")
export class TrendsController {
  constructor(private readonly trends: TrendsService) {}

  @RequirePermission("workspace.workflow.read")
  @Get()
  async list(
    @Headers(WORKSPACE_ID_HEADER) header: string,
    @Query(new ZodValidationPipe(trendQuerySchema))
    query: z.infer<typeof trendQuerySchema>,
  ) {
    return this.trends.read(
      requireWorkspace(header),
      query.source,
      query.geo,
      query.limit,
    );
  }
}

function requireWorkspace(header: string | undefined): WorkspaceId {
  if (!header || !isId("workspace", header)) {
    throw new ValidationError(`Thiếu hoặc sai header ${WORKSPACE_ID_HEADER}.`);
  }
  return header;
}
