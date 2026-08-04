import { canPublish, checkCredential, findConnector } from "@repo/connectors";
import type { SocialAccount } from "@repo/domain";
import { createLogger } from "@repo/logger";
import type { Alert, Notifier } from "@repo/notify";
import { openToken, type VaultAccess } from "./capabilities/social";

const logger = createLogger("connection-watch");

export type ConnectionWatchOptions = {
  /** How often to check. */
  intervalMs?: number;
  /** How many connections one sweep may check. */
  batchSize?: number;
};

const DEFAULTS = {
  /**
   * Half an hour.
   *
   * A token does not expire more precisely than that, and the point is to
   * notice on the day rather than the second. Checking every minute would
   * spend a request per connection per minute to learn the same thing.
   */
  intervalMs: 30 * 60 * 1000,
  batchSize: 50,
} as const;

export type ConnectionWatchDeps = VaultAccess & {
  notifier?: Notifier | null;
  appUrl?: string;
};

/**
 * Notices a channel has stopped working before a post does.
 *
 * Until this existed, a dead token was found the only way there was: the next
 * scheduled post failed. That is a campaign short one post, discovered by
 * losing it — and if the schedule is weekly, discovered a week late.
 *
 * It only ever marks a connection **worse**, never better — and that is the
 * query's doing, not this class's: `listActiveEverywhere` returns only ACTIVE
 * rows, so one already marked dead is never looked at again until somebody
 * reconnects it. Worth saying because the rule is real and the code enforcing
 * it is somewhere else; a test written here to prove it would pass without
 * proving anything, which is how the first one was written.
 */
export class ConnectionWatch {
  private readonly options: Required<ConnectionWatchOptions>;
  private running = false;

  constructor(
    private readonly deps: ConnectionWatchDeps,
    options: ConnectionWatchOptions = {},
  ) {
    this.options = { ...DEFAULTS, ...options };
  }

  async start(): Promise<void> {
    this.running = true;
    logger.info(
      { everyMinutes: Math.round(this.options.intervalMs / 60_000) },
      "connection watch started",
    );

    while (this.running) {
      try {
        await this.tick();
      } catch (error) {
        logger.error({ err: error }, "connection watch tick failed");
      }
      await sleep(this.options.intervalMs);
    }
  }

  stop(): void {
    this.running = false;
  }

  /** One pass. Returns how many connections were found to have gone bad. */
  async tick(): Promise<number> {
    const accounts = await this.deps.accounts.listActiveEverywhere(
      this.options.batchSize,
    );

    const alerts: Alert[] = [];

    for (const account of accounts) {
      const connector = findConnector(account.connectorId);
      // A platform this build cannot talk to has no token worth checking, and
      // the check would fail for a reason that says nothing about the token.
      if (!connector || !canPublish(connector)) continue;

      const broken = await this.check(account);
      if (broken) alerts.push(broken);
    }

    if (alerts.length > 0 && this.deps.notifier) {
      try {
        await this.deps.notifier.send(alerts);
      } catch (error) {
        // The connection has already been marked either way. A mail failure
        // must not undo that or stop the next sweep.
        logger.error({ err: error }, "could not send the connection alert");
      }
    }

    return alerts.length;
  }

  private async check(account: SocialAccount): Promise<Alert | null> {
    let token: string;
    try {
      token = await openToken(this.deps, account.workspaceId, account);
    } catch {
      // The credential is gone from the vault while the row still says ACTIVE.
      // Nothing to ask the platform about — this one is broken here.
      await this.mark(account, "EXPIRED");
      return {
        title: `Kênh "${account.displayName}" không còn credential`,
        reason: "Hãy nối lại kênh này.",
        link: this.deps.appUrl ?? null,
      };
    }

    const result = await checkCredential({
      externalId: account.externalId,
      accessToken: token,
    });
    if (result.ok) return null;

    await this.mark(account, result.verdict!);

    logger.warn(
      {
        accountId: account.id,
        workspaceId: account.workspaceId,
        verdict: result.verdict,
      },
      "connection stopped working",
    );

    return {
      title:
        result.verdict === "REVOKED"
          ? `Kênh "${account.displayName}" đã bị thu hồi quyền`
          : `Kênh "${account.displayName}" đã hết hạn`,
      // The two need different things done, so they are said differently:
      // reconnecting fixes an expired token and will not fix a revoked one
      // until the permission is granted again on the platform itself.
      reason:
        result.verdict === "REVOKED"
          ? `Cấp lại quyền bên nền tảng trước, rồi nối lại. ${result.reason ?? ""}`.trim()
          : `Nối lại kênh này là được. ${result.reason ?? ""}`.trim(),
      link: this.deps.appUrl ?? null,
    };
  }

  private async mark(
    account: SocialAccount,
    verdict: "EXPIRED" | "REVOKED",
  ): Promise<void> {
    try {
      await this.deps.accounts.updateStatus(account.id, verdict, null);
    } catch (error) {
      // Best effort, like the publish path's marking: failing to write the
      // status must not swallow the alert that says what happened.
      logger.error(
        { accountId: account.id, err: error },
        "could not mark the connection",
      );
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
