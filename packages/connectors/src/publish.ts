import { RuntimeError } from "@repo/runtime";
import type { ConnectorDescriptor } from "./oauth";
import { graphBase } from "./version";

/**
 * What a post looks like before a platform gets hold of it.
 *
 * Deliberately small. Every platform supports text and a link; anything richer
 * differs enough between them that a shared shape would be a lie the caller
 * has to work around.
 */
export type PostDraft = {
  message: string;
  /** A URL to attach, if the post is about something. */
  link?: string | null;
  /**
   * A picture to post, as a URL Facebook can reach.
   *
   * A URL rather than bytes: `/photos` accepts either, and a presigned link
   * costs one round trip instead of uploading the same megabyte twice. It has
   * to be publicly reachable — a link signed for an internal host is one only
   * this network can fetch, which is a mistake this repo has already made once
   * with document downloads.
   */
  imageUrl?: string | null;
};

/** What the platform says after it has taken the post. */
export type PublishedPost = {
  /** The platform's own id, which is what a later edit or delete needs. */
  externalId: string;
  /** Where a person can go and look at it, when the platform says. */
  url: string | null;
};

/**
 * Where a platform takes a new post.
 *
 * Written per platform rather than derived: Facebook posts to
 * `/{page-id}/feed`, Threads needs a two-step create-then-publish, TikTok wants
 * a video. Only Facebook is implemented here, and the others are absent rather
 * than half-written — a publish path that looks present and silently does
 * nothing is the worst failure this system could have.
 */
export type PublishTarget = {
  /** The account this post goes to. The platform's id, not ours. */
  externalId: string;
  accessToken: string;
};

/**
 * Check that a token really works for the account it claims.
 *
 * Called before anything is stored, and that ordering is the point. A token
 * saved without asking would produce a connection that looks healthy on screen
 * and fails at publish time — by which point whoever pasted it has moved on and
 * the failure reads as a bug in the platform.
 */
export async function verifyPageToken(
  externalId: string,
  accessToken: string,
  deps: { fetch?: typeof globalThis.fetch; env?: NodeJS.ProcessEnv } = {},
): Promise<{ externalId: string; displayName: string }> {
  const call = deps.fetch ?? globalThis.fetch;
  const url = new URL(`${graphBase(deps.env)}/${externalId}`);
  url.searchParams.set("fields", "id,name");

  let response: Response;
  try {
    response = await call(url.toString(), {
      // In the header rather than a query parameter. Query strings end up in
      // access logs, browser history and error reports; this one is a live
      // credential for someone's audience.
      headers: { authorization: `Bearer ${accessToken}` },
    });
  } catch (error: unknown) {
    throw new RuntimeError(
      "NETWORK",
      "Không gọi được Facebook để kiểm tra token.",
      {
        retryable: true,
        cause: error,
      },
    );
  }

  const text = await response.text();
  if (!response.ok) {
    throw new RuntimeError(
      "PROVIDER",
      `Facebook từ chối token này cho Page ${externalId}: ${graphError(text)}`,
      {
        retryable: response.status >= 500,
        context: { status: response.status },
      },
    );
  }

  const payload = JSON.parse(text) as { id?: string; name?: string };
  if (payload.id !== externalId) {
    // A user token answers `/me` happily but will not post to a page. Catching
    // the mismatch here is the difference between a clear message now and a
    // permission error days later.
    throw new RuntimeError(
      "PROVIDER",
      `Token này thuộc về ${payload.id ?? "một đối tượng khác"}, không phải Page ${externalId}.`,
      { retryable: false },
    );
  }

  return { externalId: payload.id, displayName: payload.name ?? payload.id };
}

/**
 * Every Page a user token can manage, with the Page token for each.
 *
 * This is what makes running more than one or two Pages bearable. A Page token
 * has to be fetched per Page from Facebook's own tooling, so connecting ten
 * means hunting down ten ids and ten tokens; one user token answers for all of
 * them at once.
 *
 * The Page tokens come back with the list because they are what an attach
 * needs. Nothing is expected to hand them onwards — the caller in this build
 * seals them straight into the vault, and no HTTP response ever carries them.
 */
export async function listManageablePages(
  userAccessToken: string,
  deps: { fetch?: typeof globalThis.fetch; env?: NodeJS.ProcessEnv } = {},
): Promise<{ externalId: string; displayName: string; accessToken: string }[]> {
  const call = deps.fetch ?? globalThis.fetch;
  const url = new URL(`${graphBase(deps.env)}/me/accounts`);
  url.searchParams.set("fields", "id,name,access_token");
  // Facebook's default page size is 25. Somebody with more Pages than that
  // would silently see a subset, and the missing ones are invisible — there is
  // nothing on screen to say the list was cut.
  url.searchParams.set("limit", "100");

  let response: Response;
  try {
    response = await call(url.toString(), {
      headers: { authorization: `Bearer ${userAccessToken}` },
    });
  } catch (error: unknown) {
    throw new RuntimeError(
      "NETWORK",
      "Không gọi được Facebook để đọc danh sách Page.",
      {
        retryable: true,
        cause: error,
      },
    );
  }

  const text = await response.text();
  if (!response.ok) {
    // A Page token pasted into a user-token box is the single most likely
    // mistake here, and Facebook answers it with "Tried accessing nonexisting
    // field (accounts)" — true, and no use at all to whoever pasted it. Found
    // by trying a real Page token against the real Graph.
    const reason = graphError(text);
    throw new RuntimeError(
      "PROVIDER",
      /nonexisting field \(accounts\)/.test(reason)
        ? "Đây là Page access token, không phải user access token. Token của Page chỉ nói được về chính Page đó, không liệt kê được danh sách Page."
        : `Facebook từ chối token này: ${reason}`,
      {
        retryable: response.status >= 500,
        context: { status: response.status },
      },
    );
  }

  const payload = JSON.parse(text) as {
    data?: { id?: string; name?: string; access_token?: string }[];
  };

  return (payload.data ?? [])
    .filter(
      (page): page is { id: string; name?: string; access_token: string } =>
        typeof page.id === "string" && typeof page.access_token === "string",
    )
    .map((page) => ({
      externalId: page.id,
      displayName: page.name ?? page.id,
      accessToken: page.access_token,
    }));
}

/**
 * Post to a Facebook Page.
 *
 * The first thing in this system that reaches somebody's real audience, which
 * is why it refuses more than it accepts: an empty message, a token for the
 * wrong object, and anything the platform did not explicitly confirm.
 */
export async function publishToFacebook(
  target: PublishTarget,
  draft: PostDraft,
  deps: { fetch?: typeof globalThis.fetch; env?: NodeJS.ProcessEnv } = {},
): Promise<PublishedPost> {
  const message = draft.message.trim();
  if (message === "") {
    // Refused here rather than sent. An empty post is never what anyone meant,
    // and this is not the layer to guess what they did mean.
    throw new RuntimeError("VALIDATION", "Không đăng bài rỗng.", {
      retryable: false,
    });
  }

  const call = deps.fetch ?? globalThis.fetch;
  const body = new URLSearchParams({ message });
  if (draft.link) body.set("link", draft.link);

  // A post with a picture goes to `/photos`, not `/feed`, and the text moves
  // to `caption`. Sending `message` there produces a photo with no words under
  // it — accepted, so nothing fails, and the post is simply wrong.
  const photo = Boolean(draft.imageUrl);
  if (photo) {
    body.delete("message");
    body.set("caption", message);
    body.set("url", draft.imageUrl!);
  }
  const endpoint = photo ? "photos" : "feed";

  let response: Response;
  try {
    response = await call(
      `${graphBase(deps.env)}/${target.externalId}/${endpoint}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${target.accessToken}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body,
      },
    );
  } catch (error: unknown) {
    // Retryable, and this one genuinely matters: the request may well have
    // arrived. Whoever retries has to be prepared for a duplicate, which is
    // why the engine's retry policy is the right place to decide, not here.
    throw new RuntimeError("NETWORK", "Không gọi được Facebook để đăng bài.", {
      retryable: true,
      cause: error,
    });
  }

  const text = await response.text();
  if (!response.ok) {
    throw new RuntimeError(
      "PROVIDER",
      `Facebook không nhận bài: ${graphError(text)}`,
      {
        // A rejected permission or a malformed post fails identically however
        // many times it is sent.
        retryable: response.status >= 500 || response.status === 429,
        context: {
          status: response.status,
          // Carried on the error so the caller can mark the connection without
          // having to parse the vendor's body a second time — and without this
          // module needing to know that connections exist.
          ...(credentialVerdict(text) === null
            ? {}
            : { credential: credentialVerdict(text) }),
        },
      },
    );
  }

  const payload = JSON.parse(text) as { id?: string; post_id?: string };
  // `/photos` answers with both: `id` is the photo, `post_id` is the post it
  // appears in. The post is what a person opens and what a delete should
  // target, so it wins where both are present. `/feed` sends only `id`.
  const postId = payload.post_id ?? payload.id;

  if (typeof postId !== "string" || postId === "") {
    // A 200 with no id is not a success anyone can act on: nothing can edit,
    // delete or link to the post, and reporting it as published would be a
    // claim this code cannot support.
    throw new RuntimeError(
      "PROVIDER",
      "Facebook trả về 200 nhưng không có id bài đăng.",
      { retryable: false },
    );
  }

  return {
    externalId: postId,
    // Graph returns `{page-id}_{post-id}`; the permalink is built from it.
    url: `https://www.facebook.com/${postId.replace("_", "/posts/")}`,
  };
}

/**
 * How far back to look when checking whether a retry already went out.
 *
 * Short on purpose. Long enough to cover a request that timed out and a retry
 * that follows a backoff; short enough that a campaign legitimately posting the
 * same sentence tomorrow is not mistaken for a duplicate.
 */
const DEDUPE_WINDOW_MS = 15 * 60 * 1000;

/**
 * Find a post this Page already has with exactly this message.
 *
 * Graph has no idempotency key for a feed post, so the only way to tell a
 * dropped connection from a rejected request is to go and look. Without this a
 * timeout after Facebook accepted the post means the retry posts it twice —
 * on somebody's real audience, with no undo.
 *
 * Exact match, not fuzzy: two posts that differ at all are two posts, and
 * guessing they are the same would suppress a real one.
 */
export async function findRecentPost(
  target: PublishTarget,
  message: string,
  deps: {
    fetch?: typeof globalThis.fetch;
    env?: NodeJS.ProcessEnv;
    now?: number;
  } = {},
): Promise<PublishedPost | null> {
  const call = deps.fetch ?? globalThis.fetch;
  const since = (deps.now ?? Date.now()) - DEDUPE_WINDOW_MS;

  let response: Response;
  try {
    response = await call(
      `${graphBase(deps.env)}/${target.externalId}/feed?fields=id,message,created_time&limit=25`,
      { headers: { authorization: `Bearer ${target.accessToken}` } },
    );
  } catch {
    // Unreachable while checking. Answering "not found" would be a guess in
    // the direction of posting twice, so this says nothing and lets the caller
    // decide — which it does by refusing to publish.
    throw new RuntimeError(
      "NETWORK",
      "Không kiểm tra được bài đã đăng hay chưa.",
      { retryable: true },
    );
  }

  if (!response.ok) {
    throw new RuntimeError(
      "PROVIDER",
      "Không đọc được feed để kiểm tra bài trùng.",
      { retryable: response.status >= 500 },
    );
  }

  const payload = (await response.json()) as {
    data?: { id: string; message?: string; created_time?: string }[];
  };

  const found = (payload.data ?? []).find(
    (post) =>
      post.message === message &&
      new Date(post.created_time ?? 0).getTime() >= since,
  );

  return found
    ? {
        externalId: found.id,
        url: `https://www.facebook.com/${found.id.replace("_", "/posts/")}`,
      }
    : null;
}

/**
 * What a platform's refusal says about the credential itself.
 *
 * `null` when the refusal is about this request — a malformed post, a rate
 * limit, an outage. The other two mean the connection is finished and no amount
 * of retrying will change it, which is worth knowing because the remedies
 * differ: an expired token is fixed by reconnecting, while a revoked one will
 * refuse the reconnection too until the permission is put back on the
 * platform's own settings page.
 */
export type CredentialVerdict = "EXPIRED" | "REVOKED" | null;

/**
 * Read a Graph error for what it says about the token.
 *
 * Meta signals every credential problem as code 190 and then narrows it with a
 * subcode. The subcodes below are the ones that mean somebody took the
 * permission away rather than the clock running out; anything else under 190 is
 * treated as expired, because reconnecting is the cheaper thing to try first
 * and it is the honest default when the platform has not said which it is.
 */
export function credentialVerdict(body: string): CredentialVerdict {
  let error: { code?: number; error_subcode?: number } | undefined;
  try {
    error = (JSON.parse(body) as { error?: typeof error }).error;
  } catch {
    return null;
  }

  if (error?.code !== 190) return null;

  // 458 the app was removed, 459 the account is checkpointed, 460 the password
  // changed, 464 the account is unconfirmed. All of them need the person to go
  // and do something on the platform before a reconnection can work.
  const revoked = new Set([458, 459, 460, 464]);
  return revoked.has(error.error_subcode ?? 0) ? "REVOKED" : "EXPIRED";
}

/**
 * Take a post back down.
 *
 * Here because "undo" is the first thing anyone wants after an automated post,
 * and a platform that can publish but not retract leaves the only remedy
 * outside itself. Deleting a post that is already gone is treated as success:
 * the caller asked for it not to be there, and it is not there.
 */
export async function deleteFacebookPost(
  postId: string,
  accessToken: string,
  deps: { fetch?: typeof globalThis.fetch; env?: NodeJS.ProcessEnv } = {},
): Promise<void> {
  const call = deps.fetch ?? globalThis.fetch;

  let response: Response;
  try {
    response = await call(`${graphBase(deps.env)}/${postId}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${accessToken}` },
    });
  } catch (error: unknown) {
    throw new RuntimeError("NETWORK", "Không gọi được Facebook để xoá bài.", {
      retryable: true,
      cause: error,
    });
  }

  if (response.ok) return;

  const text = await response.text();
  // Already gone is what was wanted. Graph answers 404 for a post that is not
  // there, and failing on that would make a retry impossible to get right.
  if (response.status === 404) return;

  throw new RuntimeError(
    "PROVIDER",
    `Facebook không xoá bài: ${graphError(text)}`,
    {
      retryable: response.status >= 500,
      context: { status: response.status },
    },
  );
}

/**
 * A short description of a Graph error, without echoing the whole body.
 *
 * These bodies quote back what was sent, which can include the token, and this
 * string ends up in logs and in task output people read.
 */
function graphError(text: string): string {
  try {
    const payload = JSON.parse(text) as {
      error?: { message?: string; type?: string; code?: number };
    };
    const error = payload.error;
    if (!error) return "không rõ lý do";

    // The message only. `error_user_msg` and the full body carry more, and more
    // is exactly what should not be written down here.
    return [error.type, error.message].filter(Boolean).join(": ");
  } catch {
    return "phản hồi không đọc được";
  }
}

/** Whether this build can actually publish to a platform. */
export function canPublish(connector: ConnectorDescriptor): boolean {
  return connector.id === "facebook";
}
