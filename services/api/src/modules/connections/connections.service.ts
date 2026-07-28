import { Inject, Injectable } from "@nestjs/common";
import {
  CONNECTORS,
  credentialsFor,
  exchangeCode,
  fetchIdentity,
  findConnector,
  startAuthorization,
  tokenSecretName,
  verifyPageToken,
  type ConnectorDescriptor,
} from "@repo/connectors";
import {
  NotFoundError,
  ValidationError,
  type SocialAccountId,
  type UserId,
  type WorkspaceId,
} from "@repo/core";
import type { SocialAccount, SocialAccountRepository } from "@repo/domain";
import { RuntimeError } from "@repo/runtime";
import { SOCIAL_ACCOUNT_REPOSITORY } from "../../infra/database/database.module";
import { SecretsService } from "../secrets/secrets.service";
import { PendingAuthorizations } from "./pending-authorizations";

/** A platform as the connect screen needs to see it. */
export type ConnectorSummary = {
  id: string;
  name: string;
  scopes: readonly string[];
  /** False when the operator has not registered an app for it. */
  configured: boolean;
};

@Injectable()
export class ConnectionsService {
  constructor(
    @Inject(SOCIAL_ACCOUNT_REPOSITORY)
    private readonly accounts: SocialAccountRepository,
    private readonly secrets: SecretsService,
    private readonly pending: PendingAuthorizations,
  ) {}

  /**
   * The platforms on offer, and whether each can actually be connected.
   *
   * `configured` is shown rather than the unconfigured ones being hidden: a
   * platform that silently disappears from the list looks like a platform the
   * product does not support, and the operator never finds out they forgot to
   * set the credentials.
   */
  catalog(): ConnectorSummary[] {
    return CONNECTORS.map((connector) => ({
      id: connector.id,
      name: connector.name,
      scopes: connector.scopes,
      configured: credentialsFor(connector.id) !== null,
    }));
  }

  async list(workspaceId: WorkspaceId): Promise<SocialAccount[]> {
    return this.accounts.list(workspaceId);
  }

  /**
   * Begin connecting a platform.
   *
   * Returns the URL to send the person to. The workspace and the user are
   * written into a server-side record keyed by `state` and deliberately do not
   * travel in that URL — anyone can hit a callback, and a flow that carried the
   * workspace in the redirect would let anyone attach an account to a workspace
   * of their choosing.
   */
  async start(
    workspaceId: WorkspaceId,
    userId: UserId,
    connectorId: string,
  ): Promise<{ url: string }> {
    const connector = this.requireConnector(connectorId);
    const credentials = credentialsFor(connector.id);
    if (!credentials) {
      throw new ValidationError(
        `Chưa cấu hình ứng dụng ${connector.name}. Đặt ${connector.id.toUpperCase()}_CLIENT_ID và _CLIENT_SECRET.`,
      );
    }

    const { url, pending } = startAuthorization(connector, credentials, {
      workspaceId,
      userId,
      redirectUri: redirectUri(connector.id),
    });

    await this.pending.put(pending);
    return { url };
  }

  /**
   * Finish connecting, from the platform's redirect.
   *
   * This runs unauthenticated — the browser arriving here carries no token of
   * ours, because it has just come back from Facebook. Every bit of authority
   * comes from `state` resolving to a record this server wrote, which is why
   * that record is single-use and why an unknown state is refused outright
   * rather than treated as a new flow.
   */
  async complete(input: {
    state: string;
    code: string;
  }): Promise<{ connectorId: string; account: SocialAccount }> {
    const pending = await this.pending.take(input.state);
    if (!pending) {
      throw new ValidationError(
        "Phiên kết nối không còn hiệu lực. Hãy bấm kết nối lại.",
      );
    }

    const connector = this.requireConnector(pending.connectorId);
    const credentials = credentialsFor(connector.id);
    if (!credentials) {
      throw new ValidationError(`Chưa cấu hình ứng dụng ${connector.name}.`);
    }

    const tokens = await exchangeCode(connector, credentials, {
      code: input.code,
      redirectUri: pending.redirectUri,
      codeVerifier: pending.codeVerifier,
    });

    // Asked before anything is stored. A token that works but cannot say who it
    // belongs to gives no stable key, and every reconnection would add a row
    // beside the last rather than replacing it.
    const identity = await fetchIdentity(connector, tokens.accessToken);

    const workspaceId = pending.workspaceId as WorkspaceId;
    const userId = pending.userId as UserId;
    const secretName = tokenSecretName(connector.id, identity.externalId);

    // Sealed first, then the row. The other order would leave a connection
    // pointing at a credential that is not there, which reads as connected and
    // fails at publish time.
    await this.secrets.put(workspaceId, userId, {
      name: secretName,
      value: JSON.stringify({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      }),
      description: `${connector.name} — ${identity.displayName}`,
    });

    const account = await this.accounts.connect(
      {
        workspaceId,
        connectorId: connector.id,
        externalId: identity.externalId,
        displayName: identity.displayName,
        avatarUrl: identity.avatarUrl,
        // What was granted, which can be less than what was asked for.
        scopes: tokens.scopes,
        secretName,
        expiresAt: tokens.expiresAt,
      },
      userId,
    );

    return { connectorId: connector.id, account };
  }

  /**
   * Attach a Page directly, with a token the operator already holds.
   *
   * Beside the OAuth flow rather than instead of it. OAuth is what a tenant
   * should use — they never hand over a credential and can revoke from the
   * platform's own settings. This exists because getting an app through review
   * takes weeks, and until then someone with a Page token should not be blocked
   * from using the product on their own Page.
   *
   * The token is checked against the Page **before** anything is stored. Saving
   * it unasked would produce a connection that looks healthy on screen and
   * fails at publish time, by which point whoever pasted it has moved on and
   * the failure reads as a bug in the platform.
   */
  async attachToken(
    workspaceId: WorkspaceId,
    userId: UserId,
    connectorId: string,
    input: { externalId: string; accessToken: string },
  ): Promise<SocialAccount> {
    const connector = this.requireConnector(connectorId);
    if (connector.id !== "facebook") {
      throw new ValidationError(
        `${connector.name} chưa hỗ trợ nối bằng token dán tay.`,
      );
    }

    // Translated rather than allowed to propagate. A RuntimeError carries no
    // HTTP status, so a mistyped token would surface as a 500 and page whoever
    // is on call for what is a wrong value in a form. A dropped connection is
    // genuinely our problem and is left alone.
    const identity = await verifyPageToken(
      input.externalId,
      input.accessToken,
    ).catch((error: unknown) => {
      if (error instanceof RuntimeError && error.errorClass === "PROVIDER") {
        throw new ValidationError(error.message);
      }
      throw error;
    });
    const secretName = tokenSecretName(connector.id, identity.externalId);

    await this.secrets.put(workspaceId, userId, {
      name: secretName,
      // The same shape the OAuth path writes, so everything downstream reads
      // one thing. A second shape would mean every reader has to know which
      // way the connection was made.
      value: JSON.stringify({
        accessToken: input.accessToken,
        refreshToken: null,
      }),
      description: `${connector.name} — ${identity.displayName}`,
    });

    return this.accounts.connect(
      {
        workspaceId,
        connectorId: connector.id,
        externalId: identity.externalId,
        displayName: identity.displayName,
        avatarUrl: null,
        // Not asked for and not granted through any flow this server ran, so
        // claiming a scope list would be inventing one. What the token can
        // actually do is whatever Facebook decided when it was minted.
        scopes: [],
        secretName,
        // A Page token from a long-lived user token does not expire, and the
        // ones that do give no hint here. Guessing a date would disconnect a
        // working Page on a schedule.
        expiresAt: null,
        metadata: { source: "manual" },
      },
      userId,
    );
  }

  /**
   * Disconnect an account.
   *
   * The stored tokens go too. Leaving them would keep a working credential for
   * an audience the workspace has said it no longer publishes to, and "remove"
   * that leaves the credential behind is not what the button says.
   */
  async disconnect(
    workspaceId: WorkspaceId,
    id: SocialAccountId,
    userId: UserId,
  ): Promise<void> {
    const account = await this.accounts.find(workspaceId, id);
    if (!account) throw new NotFoundError("Không tìm thấy kết nối.");

    // The credential first, then the row. If the second step fails the user is
    // left with a connection that no longer works, which they can see and press
    // again; the other order would leave a live token for an audience they have
    // just said they no longer publish to, with the row that named it gone.
    const stored = await this.secrets.list(workspaceId);
    const secret = stored.find((entry) => entry.name === account.secretName);
    if (secret) await this.secrets.remove(workspaceId, secret.id, userId);

    await this.accounts.disconnect(workspaceId, id, userId);
  }

  private requireConnector(connectorId: string): ConnectorDescriptor {
    const connector = findConnector(connectorId);
    if (!connector) {
      throw new NotFoundError(`Không hỗ trợ nền tảng ${connectorId}.`);
    }
    return connector;
  }
}

/**
 * The callback URL the platform redirects back to.
 *
 * One per platform, because these vendors require every redirect URI to be
 * registered in their app settings ahead of time, and a single shared path with
 * the platform in a query parameter is not something they will accept.
 */
export function redirectUri(connectorId: string): string {
  const base = (
    process.env.API_PUBLIC_URL?.trim() || "http://localhost:3100"
  ).replace(/\/+$/, "");
  const prefix = process.env.API_PREFIX?.trim() || "api/v1";

  return `${base}/${prefix}/connections/${connectorId}/callback`;
}

/** Where to send the browser once the dance is over. */
export function returnUrl(query: Record<string, string>): string {
  const base = (
    process.env.WEB_APP_URL?.trim() ||
    process.env.CORS_ORIGINS?.split(",")[0]?.trim() ||
    "http://localhost:3200"
  ).replace(/\/+$/, "");

  return `${base}/?${new URLSearchParams(query).toString()}`;
}
