import { Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import type { Request } from "express";
import { RateLimitError } from "@repo/core";
import type { AuthenticatedUser } from "../decorators/public.decorator";

/**
 * Rate limits are per-principal, not per-IP (docs/platform/09_API_GATEWAY.md
 * lists User / Workspace / API Key dimensions). Keying by IP alone would
 * punish everyone behind a shared NAT and would let one user rotate IPs to
 * bypass the limit.
 */
@Injectable()
export class ScopedThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Request): Promise<string> {
    const user = (req as Request & { user?: AuthenticatedUser }).user;
    if (user?.userId) return `user:${user.userId}`;

    const workspaceId = req.header("x-workspace-id");
    if (workspaceId) return `ws:${workspaceId}`;

    // Unauthenticated traffic (login, register) falls back to the source IP.
    return `ip:${req.ip ?? "unknown"}`;
  }

  /** Emit our error envelope instead of Nest's default ThrottlerException. */
  protected override async throwThrottlingException(): Promise<void> {
    throw new RateLimitError();
  }
}
