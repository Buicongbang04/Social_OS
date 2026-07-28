import type { ConnectorDescriptor } from "./oauth";

/**
 * The platforms this build can connect to.
 *
 * `docs/ROADMAP.md` Phase 3 lists ten. Three are here. The other seven are
 * absent rather than stubbed, because a platform listed in a picker that cannot
 * actually be connected is a worse thing to ship than a shorter list — the user
 * finds out after granting permissions.
 *
 * URLs are written out per platform rather than derived. They do not follow a
 * pattern, and a template that happened to work for two of them would fail on
 * the third in a way that only shows up against the live vendor.
 */
export const CONNECTORS: readonly ConnectorDescriptor[] = [
  {
    id: "facebook",
    name: "Facebook",
    authorizeUrl: "https://www.facebook.com/v21.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v21.0/oauth/access_token",
    // Only what publishing and reading engagement needs. `pages_manage_posts`
    // is the one that writes; the rest are read.
    scopes: [
      "pages_show_list",
      "pages_read_engagement",
      "pages_manage_posts",
      "business_management",
    ],
    // Facebook's token endpoint ignores code_verifier. Sending it would be
    // harmless but misleading — it would read as protection that is not there.
    pkce: false,
    // Comma, not space. Facebook is the reason this field exists.
    scopeSeparator: ",",
    // The person, not their pages. Choosing which page to publish from is a
    // second step against `/me/accounts`, which returns a list rather than one
    // account — a genuinely different shape, and not in this build.
    identityUrl: "https://graph.facebook.com/v21.0/me?fields=id,name,picture",
    identityFields: { id: "id", name: "name", avatar: "picture.data.url" },
  },
  {
    id: "tiktok",
    name: "TikTok",
    authorizeUrl: "https://www.tiktok.com/v2/auth/authorize/",
    tokenUrl: "https://open.tiktokapis.com/v2/oauth/token/",
    scopes: ["user.info.basic", "video.publish", "video.list"],
    pkce: true,
    scopeSeparator: ",",
    identityUrl:
      "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url",
    identityFields: {
      id: "data.user.open_id",
      name: "data.user.display_name",
      avatar: "data.user.avatar_url",
    },
  },
  {
    id: "threads",
    name: "Threads",
    authorizeUrl: "https://threads.net/oauth/authorize",
    tokenUrl: "https://graph.threads.net/oauth/access_token",
    scopes: ["threads_basic", "threads_content_publish"],
    pkce: false,
    scopeSeparator: ",",
    identityUrl:
      "https://graph.threads.net/v1.0/me?fields=id,username,threads_profile_picture_url",
    identityFields: {
      id: "id",
      name: "username",
      avatar: "threads_profile_picture_url",
    },
  },
];

/**
 * A connector, with any endpoint the operator has overridden.
 *
 * Overridable because these vendors version their APIs and run separate sandbox
 * hosts, and pinning the URLs in code means a version bump is a release. It is
 * also what makes the whole flow testable against a server that behaves like
 * the real one rather than against a mock that agrees with the code.
 *
 * Scopes are deliberately NOT overridable: widening what the platform may do to
 * someone's audience should be a code change under review, not an environment
 * variable.
 */
export function findConnector(
  id: string,
  env: NodeJS.ProcessEnv = process.env,
): ConnectorDescriptor | null {
  const base = CONNECTORS.find((connector) => connector.id === id);
  if (!base) return null;

  const prefix = id.toUpperCase();
  return {
    ...base,
    authorizeUrl: env[`${prefix}_AUTHORIZE_URL`]?.trim() || base.authorizeUrl,
    tokenUrl: env[`${prefix}_TOKEN_URL`]?.trim() || base.tokenUrl,
    identityUrl: env[`${prefix}_IDENTITY_URL`]?.trim() || base.identityUrl,
  };
}

/**
 * Where a platform's client credentials live in the environment.
 *
 * The operator registers one app per platform and the whole installation shares
 * it — that is how these platforms work, since the app is what they review and
 * approve. What is per-workspace is the *user token* the flow produces, and that
 * goes in the vault.
 */
export function credentialsFor(
  connectorId: string,
  env: NodeJS.ProcessEnv = process.env,
): { clientId: string; clientSecret: string } | null {
  const prefix = connectorId.toUpperCase();
  const clientId = env[`${prefix}_CLIENT_ID`]?.trim();
  const clientSecret = env[`${prefix}_CLIENT_SECRET`]?.trim();

  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/**
 * Where a connection's tokens are kept in the vault.
 *
 * Namespaced by account as well as platform, because one workspace can connect
 * several pages on the same platform and a single name per platform would have
 * each new connection quietly replace the last.
 */
export function tokenSecretName(
  connectorId: string,
  externalId: string,
): string {
  return `connections/${connectorId}/${externalId}`;
}
