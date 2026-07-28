import type {
  Metadata,
  SocialAccountId,
  SoftDeletableEntity,
  WorkspaceId,
} from "@repo/core";

/**
 * Whether a connection can currently be used.
 *
 * `EXPIRED` and `REVOKED` are kept apart on purpose. Expired is the platform's
 * clock running out and is fixed by reconnecting; revoked is somebody having
 * taken the permission away, and reconnecting will fail again until they put it
 * back. Collapsing the two would send people round a loop that cannot work.
 */
export const SOCIAL_ACCOUNT_STATUSES = [
  "ACTIVE",
  "EXPIRED",
  "REVOKED",
] as const;
export type SocialAccountStatus = (typeof SOCIAL_ACCOUNT_STATUSES)[number];

/**
 * A social platform account a workspace has connected
 * (docs/03_DOMAIN_MODEL.md, Integration Domain).
 *
 * The tokens are not here. They are sealed in the vault and this row holds only
 * the reference — same reasoning as `Secret`: a type that carried a live access
 * token would leak it into every log line that ever serialised a connection,
 * and those lines get written by people who did not know they were handling
 * one.
 */
export type SocialAccount = SoftDeletableEntity<SocialAccountId> & {
  workspaceId: WorkspaceId;
  /** Which platform, e.g. `facebook`. Matches a connector in @repo/connectors. */
  connectorId: string;
  /**
   * The platform's own id for the account.
   *
   * Theirs, not ours, because it is the only thing that stays the same when a
   * page is renamed — and reconnecting a renamed page has to update the
   * existing connection rather than create a second one beside it.
   */
  externalId: string;
  displayName: string;
  avatarUrl: string | null;
  /**
   * What the platform actually granted, which can be less than was asked for.
   *
   * Stored because the difference is what the workspace can really do, and
   * finding out at publish time is finding out too late.
   */
  scopes: readonly string[];
  status: SocialAccountStatus;
  /** Where the sealed tokens live. See `tokenSecretName` in @repo/connectors. */
  secretName: string;
  /** When the access token stops working, if the platform said. */
  expiresAt: Date | null;
  connectedAt: Date;
  metadata: Metadata;
};

export type ConnectSocialAccountInput = {
  workspaceId: WorkspaceId;
  connectorId: string;
  externalId: string;
  displayName: string;
  avatarUrl?: string | null;
  scopes: readonly string[];
  secretName: string;
  expiresAt?: Date | null;
  metadata?: Metadata;
};

export type SocialAccountRepository = {
  list(workspaceId: WorkspaceId): Promise<SocialAccount[]>;
  find(
    workspaceId: WorkspaceId,
    id: SocialAccountId,
  ): Promise<SocialAccount | null>;
  findByExternalId(
    workspaceId: WorkspaceId,
    connectorId: string,
    externalId: string,
  ): Promise<SocialAccount | null>;
  /**
   * Connect, or reconnect.
   *
   * One call for both because from the user's side they are the same act: they
   * pressed connect. Reconnecting an account that is already there has to
   * update it — a second row for the same page would leave the platform with
   * two tokens for one audience and no way to say which is live.
   */
  connect(
    input: ConnectSocialAccountInput,
    actorId: string | null,
  ): Promise<SocialAccount>;
  updateStatus(
    id: SocialAccountId,
    status: SocialAccountStatus,
    actorId: string | null,
  ): Promise<SocialAccount | null>;
  disconnect(
    workspaceId: WorkspaceId,
    id: SocialAccountId,
    actorId: string | null,
  ): Promise<SocialAccount | null>;
};
