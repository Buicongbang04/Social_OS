import { Inject, Injectable } from "@nestjs/common";
import {
  CONNECTORS,
  credentialsFor,
  exchangeCode,
  fetchIdentity,
  findConnector,
  startAuthorization,
  tokenSecretName,
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
