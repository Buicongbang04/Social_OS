import { createHash } from "node:crypto";
import { RuntimeError } from "@repo/runtime";
import { describe, expect, it } from "vitest";
import { findConnector, tokenSecretName } from "./catalog";
import {
  exchangeCode,
  fetchIdentity,
  parseTokenResponse,
  startAuthorization,
  statesMatch,
  type ConnectorDescriptor,
} from "./oauth";

const CREDENTIALS = { clientId: "app-123", clientSecret: "shh" };

const PLAIN: ConnectorDescriptor = {
  id: "plain",
  name: "Plain",
  authorizeUrl: "https://plain.test/oauth/authorize",
  tokenUrl: "https://plain.test/oauth/token",
  scopes: ["read", "write"],
  pkce: false,
  identityUrl: "https://plain.test/me",
};

const WITH_PKCE: ConnectorDescriptor = { ...PLAIN, id: "pkce", pkce: true };

const start = (connector = PLAIN) =>
  startAuthorization(connector, CREDENTIALS, {
    workspaceId: "wsp_1",
    userId: "usr_1",
    redirectUri: "https://app.test/callback",
  });

/** A fetch that answers with whatever the test says, once. */
function replyWith(
  status: number,
  body: string,
  seen: { url?: string; body?: URLSearchParams } = {},
): typeof globalThis.fetch {
  return (async (url: string, init: RequestInit) => {
    seen.url = String(url);
    seen.body = new URLSearchParams(String(init.body));
    return new Response(body, { status });
  }) as unknown as typeof globalThis.fetch;
}

describe("startAuthorization", () => {
  it("sends the user to the platform with everything it needs", () => {
    const { url } = start();
    const query = new URL(url).searchParams;

    expect(query.get("client_id")).toBe("app-123");
    expect(query.get("response_type")).toBe("code");
    expect(query.get("redirect_uri")).toBe("https://app.test/callback");
    expect(query.get("scope")).toBe("read write");
  });

  it("gives every authorization its own state", () => {
    // The state is what ties a callback back to the person who started it. Two
    // flows sharing one would let either finish the other.
    expect(start().pending.state).not.toBe(start().pending.state);
  });

  it("keeps the workspace out of the redirect entirely", () => {
    // Anyone can hit a callback URL. If the workspace travelled in it, anyone
    // could attach an account to a workspace of their choosing.
    const { url, pending } = start();

    expect(url).not.toContain("wsp_1");
    expect(pending.workspaceId).toBe("wsp_1");
  });

  it("uses the platform's own scope separator", () => {
    // Facebook is the reason: it wants commas, and answers a space-separated
    // list by silently granting nothing.
    const facebook = findConnector("facebook")!;
    const query = new URL(
      startAuthorization(facebook, CREDENTIALS, {
        workspaceId: "wsp_1",
        userId: "usr_1",
        redirectUri: "https://app.test/callback",
      }).url,
    ).searchParams;

    expect(query.get("scope")).toBe(facebook.scopes.join(","));
    expect(query.get("scope")).not.toContain(" ");
  });

  it("sends a challenge, never the verifier, when PKCE is on", () => {
    // The verifier is the secret half. Putting it in the URL that goes through
    // the browser would defeat the entire mechanism.
    const { url, pending } = start(WITH_PKCE);
    const query = new URL(url).searchParams;

    expect(pending.codeVerifier).toBeTruthy();
    expect(url).not.toContain(pending.codeVerifier!);
    expect(query.get("code_challenge_method")).toBe("S256");
    expect(query.get("code_challenge")).toBe(
      createHash("sha256").update(pending.codeVerifier!).digest("base64url"),
    );
  });

  it("asks for no challenge when the platform ignores it", () => {
    const query = new URL(start().url).searchParams;

    expect(start().pending.codeVerifier).toBeNull();
    expect(query.has("code_challenge")).toBe(false);
  });
});

describe("statesMatch", () => {
  it("accepts the same state and rejects a different one", () => {
    expect(statesMatch("abc", "abc")).toBe(true);
    expect(statesMatch("abc", "abd")).toBe(false);
  });

  it("rejects a different length without throwing", () => {
    // timingSafeEqual throws on mismatched lengths, and a thrown comparison in
    // the callback path would turn a wrong state into a 500 rather than a
    // refusal.
    expect(statesMatch("abc", "abcd")).toBe(false);
    expect(statesMatch("", "abc")).toBe(false);
  });
});

describe("exchangeCode", () => {
  it("posts the code and gets a usable token back", async () => {
    const seen: { url?: string; body?: URLSearchParams } = {};
    const tokens = await exchangeCode(
      PLAIN,
      CREDENTIALS,
      {
        code: "the-code",
        redirectUri: "https://app.test/callback",
        codeVerifier: null,
      },
      {
        fetch: replyWith(
          200,
          JSON.stringify({ access_token: "at-1", expires_in: 3600 }),
          seen,
        ),
      },
    );

    expect(seen.url).toBe(PLAIN.tokenUrl);
    expect(seen.body?.get("grant_type")).toBe("authorization_code");
    expect(seen.body?.get("code")).toBe("the-code");
    expect(tokens.accessToken).toBe("at-1");
  });

  it("sends the redirect URI again", async () => {
    // Not redundant: platforms that check it reject an exchange whose redirect
    // does not match the one that was authorized.
    const seen: { url?: string; body?: URLSearchParams } = {};
    await exchangeCode(
      PLAIN,
      CREDENTIALS,
      {
        code: "c",
        redirectUri: "https://app.test/callback",
        codeVerifier: null,
      },
      { fetch: replyWith(200, JSON.stringify({ access_token: "at" }), seen) },
    );

    expect(seen.body?.get("redirect_uri")).toBe("https://app.test/callback");
  });

  it("sends the verifier only when there is one", async () => {
    const withPkce: { body?: URLSearchParams } = {};
    await exchangeCode(
      WITH_PKCE,
      CREDENTIALS,
      { code: "c", redirectUri: "r", codeVerifier: "v-123" },
      {
        fetch: replyWith(200, JSON.stringify({ access_token: "at" }), withPkce),
      },
    );
    expect(withPkce.body?.get("code_verifier")).toBe("v-123");

    const without: { body?: URLSearchParams } = {};
    await exchangeCode(
      PLAIN,
      CREDENTIALS,
      { code: "c", redirectUri: "r", codeVerifier: null },
      {
        fetch: replyWith(200, JSON.stringify({ access_token: "at" }), without),
      },
    );
    expect(without.body?.has("code_verifier")).toBe(false);
  });

  it("does not retry a code the platform rejected", async () => {
    // A rejected or already-used code fails the same way however many times it
    // is sent. Marking it retryable would spend attempts on a certainty.
    const failure = await exchangeCode(
      PLAIN,
      CREDENTIALS,
      { code: "used", redirectUri: "r", codeVerifier: null },
      {
        fetch: replyWith(
          400,
          JSON.stringify({
            error: "invalid_grant",
            error_description: "code expired",
          }),
        ),
      },
    ).catch((error: unknown) => error as RuntimeError);

    expect(failure).toBeInstanceOf(RuntimeError);
    expect((failure as RuntimeError).retryable).toBe(false);
    expect((failure as RuntimeError).message).toContain("invalid_grant");
  });

  it("does retry when the platform itself is unwell", async () => {
    const failure = await exchangeCode(
      PLAIN,
      CREDENTIALS,
      { code: "c", redirectUri: "r", codeVerifier: null },
      { fetch: replyWith(503, "upstream unavailable") },
    ).catch((error: unknown) => error as RuntimeError);

    expect((failure as RuntimeError).retryable).toBe(true);
  });

  it("does not put the submitted code in the error message", async () => {
    // These bodies end up in logs, and some platforms echo the code back.
    const failure = await exchangeCode(
      PLAIN,
      CREDENTIALS,
      { code: "secret-code-xyz", redirectUri: "r", codeVerifier: null },
      {
        fetch: replyWith(
          400,
          JSON.stringify({ error: "invalid_grant", code: "secret-code-xyz" }),
        ),
      },
    ).catch((error: unknown) => error as RuntimeError);

    expect((failure as RuntimeError).message).not.toContain("secret-code-xyz");
  });

  it("calls a dropped connection retryable, unlike a refusal", async () => {
    const failure = await exchangeCode(
      PLAIN,
      CREDENTIALS,
      { code: "c", redirectUri: "r", codeVerifier: null },
      {
        fetch: (() => {
          throw new Error("ECONNRESET");
        }) as unknown as typeof globalThis.fetch,
      },
    ).catch((error: unknown) => error as RuntimeError);

    expect((failure as RuntimeError).retryable).toBe(true);
  });
});

describe("parseTokenResponse", () => {
  it("refuses a response with no access token", () => {
    // Otherwise it is stored as a connection that authenticates nothing, and
    // the first sign is a failed publish much later.
    expect(() =>
      parseTokenResponse(PLAIN, JSON.stringify({ ok: true })),
    ).toThrow(RuntimeError);
    expect(() =>
      parseTokenResponse(PLAIN, JSON.stringify({ access_token: "" })),
    ).toThrow(RuntimeError);
  });

  it("reads a form-encoded answer, which some platforms still send", () => {
    const tokens = parseTokenResponse(PLAIN, "access_token=at-2&expires_in=60");

    expect(tokens.accessToken).toBe("at-2");
    expect(tokens.expiresAt).toBeInstanceOf(Date);
  });

  it("turns the lifetime into a moment, not a duration", () => {
    // A duration only means anything next to when it was issued, and that is
    // exactly what gets lost when it is written to a row.
    const before = Date.now();
    const tokens = parseTokenResponse(
      PLAIN,
      JSON.stringify({ access_token: "at", expires_in: 3600 }),
    );

    expect(tokens.expiresAt!.getTime()).toBeGreaterThanOrEqual(
      before + 3_600_000,
    );
  });

  it("leaves expiry unset when the platform gives none", () => {
    // Several platforms issue long-lived tokens with no lifetime. Inventing one
    // would have the platform disconnect a working account on a schedule.
    expect(
      parseTokenResponse(PLAIN, JSON.stringify({ access_token: "at" }))
        .expiresAt,
    ).toBeNull();
  });

  it("falls back to the scopes that were asked for", () => {
    expect(
      parseTokenResponse(PLAIN, JSON.stringify({ access_token: "at" })).scopes,
    ).toEqual(PLAIN.scopes);
  });

  it("reads granted scopes however they are separated", () => {
    // Which matters: the platform may grant less than was asked for, and the
    // difference is what the workspace can actually do.
    expect(
      parseTokenResponse(
        PLAIN,
        JSON.stringify({ access_token: "at", scope: "read,write" }),
      ).scopes,
    ).toEqual(["read", "write"]);
  });
});

describe("fetchIdentity", () => {
  const answering = (
    status: number,
    body: string,
    seen: { auth?: string } = {},
  ) =>
    (async (_url: string, init: RequestInit) => {
      seen.auth = new Headers(init.headers).get("authorization") ?? undefined;
      return new Response(body, { status });
    }) as unknown as typeof globalThis.fetch;

  it("asks with the token and reads back who was connected", async () => {
    const seen: { auth?: string } = {};
    const identity = await fetchIdentity(PLAIN, "at-1", {
      fetch: answering(200, JSON.stringify({ id: "u-1", name: "Ai Đó" }), seen),
    });

    expect(seen.auth).toBe("Bearer at-1");
    expect(identity).toEqual({
      externalId: "u-1",
      displayName: "Ai Đó",
      avatarUrl: null,
    });
  });

  it("reads a nested field where the platform buries it", async () => {
    // TikTok is the reason: the id sits under data.user.open_id.
    const identity = await fetchIdentity(
      {
        ...PLAIN,
        identityFields: {
          id: "data.user.open_id",
          name: "data.user.display_name",
        },
      },
      "at",
      {
        fetch: answering(
          200,
          JSON.stringify({
            data: { user: { open_id: "o-9", display_name: "Tên" } },
          }),
        ),
      },
    );

    expect(identity.externalId).toBe("o-9");
    expect(identity.displayName).toBe("Tên");
  });

  it("refuses an answer with no account id", async () => {
    // Without a stable key every reconnection adds a row beside the last
    // instead of replacing it, and one audience ends up with two live tokens.
    await expect(
      fetchIdentity(PLAIN, "at", {
        fetch: answering(200, JSON.stringify({ name: "Ai Đó" })),
      }),
    ).rejects.toBeInstanceOf(RuntimeError);
  });

  it("falls back to the id when the platform gives no name", async () => {
    const identity = await fetchIdentity(PLAIN, "at", {
      fetch: answering(200, JSON.stringify({ id: "u-2" })),
    });

    expect(identity.displayName).toBe("u-2");
  });

  it("separates a refused read from a broken platform", async () => {
    // A perfectly good token can still be refused here because the granted
    // scopes do not cover it — retrying that is pointless.
    const refused = (await fetchIdentity(PLAIN, "at", {
      fetch: answering(403, "{}"),
    }).catch((error: unknown) => error)) as RuntimeError;
    expect(refused.retryable).toBe(false);

    const unwell = (await fetchIdentity(PLAIN, "at", {
      fetch: answering(500, "{}"),
    }).catch((error: unknown) => error)) as RuntimeError;
    expect(unwell.retryable).toBe(true);
  });
});

describe("findConnector", () => {
  it("lets the operator point a platform somewhere else", () => {
    // Versioned APIs and sandbox hosts. Pinning the URLs in code would make a
    // version bump a release.
    const overridden = findConnector("facebook", {
      FACEBOOK_TOKEN_URL: "https://sandbox.test/token",
    } as NodeJS.ProcessEnv);

    expect(overridden?.tokenUrl).toBe("https://sandbox.test/token");
    expect(overridden?.authorizeUrl).toBe(
      findConnector("facebook", {} as NodeJS.ProcessEnv)?.authorizeUrl,
    );
  });

  it("does not let the environment widen what may be done", () => {
    // Scopes decide what the platform can do to someone's audience. That is a
    // code change under review, not an environment variable.
    const overridden = findConnector("facebook", {
      FACEBOOK_SCOPES: "pages_manage_posts,ads_management,read_insights",
    } as NodeJS.ProcessEnv);

    expect(overridden?.scopes).toEqual(
      findConnector("facebook", {} as NodeJS.ProcessEnv)?.scopes,
    );
    expect(overridden?.scopes).not.toContain("ads_management");
  });

  it("returns nothing for a platform this build cannot connect", () => {
    // Rather than a half-configured descriptor. A platform in a picker that
    // cannot actually be connected is found out after permissions are granted.
    expect(findConnector("myspace")).toBeNull();
  });
});

describe("tokenSecretName", () => {
  it("gives each connected account its own place in the vault", () => {
    // One name per platform would have a second page quietly replace the first.
    expect(tokenSecretName("facebook", "page-1")).not.toBe(
      tokenSecretName("facebook", "page-2"),
    );
    expect(tokenSecretName("facebook", "page-1")).toBe(
      "connections/facebook/page-1",
    );
  });
});
