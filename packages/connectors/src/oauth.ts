import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { RuntimeError } from "@repo/runtime";

/**
 * What a platform needs before its OAuth flow can run.
 *
 * Written per platform rather than discovered, because none of these vendors
 * publish a usable discovery document and half of them deviate from the spec in
 * ways discovery would not reveal anyway.
 */
export type ConnectorDescriptor = {
  /** Stable id, used in URLs and as the vault namespace. Lower case. */
  id: string;
  name: string;
  authorizeUrl: string;
  tokenUrl: string;
  /**
   * What the connection is allowed to do.
   *
   * Listed here rather than requested per call so that widening what the
   * platform can do to someone's audience is a code change under review, not a
   * parameter.
   */
  scopes: readonly string[];
  /**
   * Whether the token endpoint accepts PKCE.
   *
   * Not universal, and sending a code_verifier to a server that ignores it is
   * harmless while omitting it where it is required is not — so this is stated
   * per platform rather than assumed.
   */
  pkce: boolean;
  /** Separator between scopes. Most use a space; Facebook uses a comma. */
  scopeSeparator?: string;
  /**
   * Where to ask the platform who was just connected.
   *
   * Needed because a token on its own says nothing a person can read. Without
   * this the connections list would show rows of opaque ids, and someone
   * deciding which connection to publish from would be guessing.
   */
  identityUrl: string;
  /**
   * Which fields of that answer hold the id, the name and the picture.
   *
   * Stated per platform because they disagree — `id`/`name` for Meta,
   * `open_id`/`display_name` for TikTok — and dotted paths are supported since
   * some of them nest it.
   */
  identityFields?: { id?: string; name?: string; avatar?: string };
};

/** Who the platform says was connected. */
export type ConnectedIdentity = {
  externalId: string;
  displayName: string;
  avatarUrl: string | null;
};

/**
 * Ask the platform who this token belongs to.
 *
 * Deliberately separate from the exchange: a platform can hand back a perfectly
 * good token and then refuse this call because the granted scopes do not cover
 * it, and those two failures need different messages.
 */
export async function fetchIdentity(
  connector: ConnectorDescriptor,
  accessToken: string,
  deps: { fetch?: typeof globalThis.fetch } = {},
): Promise<ConnectedIdentity> {
  const call = deps.fetch ?? globalThis.fetch;

  let response: Response;
  try {
    response = await call(connector.identityUrl, {
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: "application/json",
      },
    });
  } catch (error: unknown) {
    throw new RuntimeError(
      "NETWORK",
      `Không hỏi được ${connector.name} xem vừa kết nối tài khoản nào.`,
      { retryable: true, context: { connector: connector.id }, cause: error },
    );
  }

  if (!response.ok) {
    throw new RuntimeError(
      "PROVIDER",
      `${connector.name} không cho đọc thông tin tài khoản (HTTP ${response.status}).`,
      {
        retryable: response.status >= 500,
        context: { connector: connector.id, status: response.status },
      },
    );
  }

  const payload = (await response.json()) as unknown;
  const fields = connector.identityFields ?? {};
  const externalId = pick(payload, fields.id ?? "id");

  if (typeof externalId !== "string" || externalId === "") {
    // Without it there is no stable key, and every reconnection would add a
    // row beside the last instead of replacing it.
    throw new RuntimeError(
      "PROVIDER",
      `${connector.name} không trả về định danh tài khoản.`,
      { retryable: false, context: { connector: connector.id } },
    );
  }

  const name = pick(payload, fields.name ?? "name");
  const avatar = pick(payload, fields.avatar ?? "picture");

  return {
    externalId,
    displayName: typeof name === "string" && name !== "" ? name : externalId,
    avatarUrl: typeof avatar === "string" && avatar !== "" ? avatar : null,
  };
}

/** Read a possibly nested field, e.g. `data.user.open_id`. */
function pick(payload: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => {
    if (typeof value !== "object" || value === null) return undefined;
    return (value as Record<string, unknown>)[key];
  }, payload);
}

export type OAuthCredentials = {
  clientId: string;
  clientSecret: string;
};

/**
 * What a platform hands back after a successful exchange.
 *
 * `refreshToken` is optional because several platforms do not issue one — they
 * hand out a long-lived access token instead, and pretending otherwise would
 * make every connection look broken.
 */
export type TokenSet = {
  accessToken: string;
  refreshToken: string | null;
  /** Absolute, not a duration: a duration is only meaningful next to the
   *  moment it was issued, and that moment is lost as soon as it is stored. */
  expiresAt: Date | null;
  scopes: readonly string[];
};

/**
 * The half-finished connection, held between sending the user to the platform
 * and their coming back.
 *
 * Kept server-side. The `state` in the URL is a lookup key, not the data — a
 * flow that carried the workspace id in the redirect would let anyone who could
 * craft a callback attach an account to a workspace of their choosing.
 */
export type PendingAuthorization = {
  state: string;
  connectorId: string;
  workspaceId: string;
  userId: string;
  redirectUri: string;
  codeVerifier: string | null;
  createdAt: Date;
};

/** Random, unguessable, and URL-safe. */
function token(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/**
 * Compare two `state` values without leaking how much of one was right.
 *
 * `state` is submitted by whoever hits the callback URL, which is to say by
 * anyone. That makes it exactly the kind of value a timing comparison leaks.
 */
export function statesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Begin an authorization.
 *
 * Returns both the URL to send the user to and the pending record to hold onto,
 * because the two must be created together — a URL without a stored state is a
 * callback that can never be validated.
 */
export function startAuthorization(
  connector: ConnectorDescriptor,
  credentials: OAuthCredentials,
  input: { workspaceId: string; userId: string; redirectUri: string },
): { url: string; pending: PendingAuthorization } {
  const state = token();
  const codeVerifier = connector.pkce ? token(48) : null;

  const url = new URL(connector.authorizeUrl);
  url.searchParams.set("client_id", credentials.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  url.searchParams.set(
    "scope",
    connector.scopes.join(connector.scopeSeparator ?? " "),
  );

  if (codeVerifier) {
    url.searchParams.set("code_challenge", challengeFor(codeVerifier));
    url.searchParams.set("code_challenge_method", "S256");
  }

  return {
    url: url.toString(),
    pending: {
      state,
      connectorId: connector.id,
      workspaceId: input.workspaceId,
      userId: input.userId,
      redirectUri: input.redirectUri,
      codeVerifier,
      createdAt: new Date(),
    },
  };
}

/** The S256 challenge for a verifier, per RFC 7636. */
function challengeFor(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/**
 * Trade the authorization code for tokens.
 *
 * The `fetch` seam is here so the exchange can be tested against a server that
 * behaves like the real one — including the ways it misbehaves — rather than
 * against a mock that agrees with whatever this function does.
 */
export async function exchangeCode(
  connector: ConnectorDescriptor,
  credentials: OAuthCredentials,
  input: {
    code: string;
    redirectUri: string;
    codeVerifier: string | null;
  },
  deps: { fetch?: typeof globalThis.fetch } = {},
): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    // Sent again on purpose. The spec requires it, and a platform that checks
    // will reject the exchange if it does not match the one used to authorize.
    redirect_uri: input.redirectUri,
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
  });
  if (input.codeVerifier) body.set("code_verifier", input.codeVerifier);

  return postForToken(connector, body, deps);
}

/** Trade a refresh token for a fresh access token. */
export async function refreshTokens(
  connector: ConnectorDescriptor,
  credentials: OAuthCredentials,
  refreshToken: string,
  deps: { fetch?: typeof globalThis.fetch } = {},
): Promise<TokenSet> {
  return postForToken(
    connector,
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
    }),
    deps,
  );
}

async function postForToken(
  connector: ConnectorDescriptor,
  body: URLSearchParams,
  deps: { fetch?: typeof globalThis.fetch },
): Promise<TokenSet> {
  const call = deps.fetch ?? globalThis.fetch;

  let response: Response;
  try {
    response = await call(connector.tokenUrl, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body,
    });
  } catch (error: unknown) {
    // The network, not the platform. Retryable, and worth distinguishing:
    // retrying a rejected code is pointless, retrying a dropped connection is
    // not.
    throw new RuntimeError(
      "NETWORK",
      `Không gọi được ${connector.name} để đổi mã.`,
      { retryable: true, context: { connector: connector.id }, cause: error },
    );
  }

  const text = await response.text();
  if (!response.ok) {
    throw new RuntimeError(
      "PROVIDER",
      `${connector.name} từ chối: ${describeFailure(text)}`,
      {
        // A rejected or expired code fails identically however many times it
        // is sent. Only the platform being unwell is worth another go.
        retryable: response.status >= 500,
        context: { connector: connector.id, status: response.status },
      },
    );
  }

  return parseTokenResponse(connector, text);
}

/**
 * Read a token response.
 *
 * Separate and exported because this is where platforms differ most, and
 * because the failure it guards against is silent: a response that parses into
 * an object with no `access_token` would otherwise be stored as a connection
 * that authenticates nothing.
 */
export function parseTokenResponse(
  connector: ConnectorDescriptor,
  text: string,
): TokenSet {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(text) as Record<string, unknown>;
  } catch (error: unknown) {
    // Some platforms answer form-encoded despite `accept: application/json`.
    // Falling back rather than failing, because the alternative is refusing a
    // response that is perfectly usable.
    const form = new URLSearchParams(text);
    if (!form.has("access_token")) {
      throw new RuntimeError(
        "PROVIDER",
        `Không đọc được phản hồi token của ${connector.name}.`,
        {
          retryable: false,
          context: { connector: connector.id },
          cause: error,
        },
      );
    }
    payload = Object.fromEntries(form.entries());
  }

  const accessToken = payload.access_token;
  if (typeof accessToken !== "string" || accessToken === "") {
    throw new RuntimeError(
      "PROVIDER",
      `${connector.name} trả về phản hồi không có access_token.`,
      { retryable: false, context: { connector: connector.id } },
    );
  }

  const expiresIn = Number(payload.expires_in);
  const scope = payload.scope;

  return {
    accessToken,
    refreshToken:
      typeof payload.refresh_token === "string" && payload.refresh_token !== ""
        ? payload.refresh_token
        : null,
    expiresAt:
      Number.isFinite(expiresIn) && expiresIn > 0
        ? new Date(Date.now() + expiresIn * 1000)
        : null,
    scopes:
      typeof scope === "string" && scope !== ""
        ? scope.split(/[\s,]+/).filter(Boolean)
        : connector.scopes,
  };
}

/**
 * A short description of a failed exchange, without echoing the whole body.
 *
 * Error bodies from these platforms sometimes contain the code that was
 * submitted, and this string ends up in logs.
 */
function describeFailure(text: string): string {
  try {
    const payload = JSON.parse(text) as Record<string, unknown>;
    const error = payload.error;
    const description =
      payload.error_description ??
      (typeof error === "object" && error !== null
        ? (error as Record<string, unknown>).message
        : null);

    const parts = [
      typeof error === "string" ? error : null,
      typeof description === "string" ? description : null,
    ].filter(Boolean);

    return parts.length > 0 ? parts.join(" — ") : "không rõ lý do";
  } catch {
    return "phản hồi không đọc được";
  }
}
