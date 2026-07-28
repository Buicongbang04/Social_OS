import { RuntimeError } from "@repo/runtime";
import type { ConnectorDescriptor } from "./oauth";

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

const GRAPH_VERSION = "v21.0";

function graphBase(env: NodeJS.ProcessEnv = process.env): string {
  return (
    env.FACEBOOK_GRAPH_URL?.trim() ||
    `https://graph.facebook.com/${GRAPH_VERSION}`
  ).replace(/\/+$/, "");
}

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

  let response: Response;
  try {
    response = await call(`${graphBase(deps.env)}/${target.externalId}/feed`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${target.accessToken}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
    });
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
        context: { status: response.status },
      },
    );
  }

  const payload = JSON.parse(text) as { id?: string };
  if (typeof payload.id !== "string" || payload.id === "") {
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
    externalId: payload.id,
    // Graph returns `{page-id}_{post-id}`; the permalink is built from it.
    url: `https://www.facebook.com/${payload.id.replace("_", "/posts/")}`,
  };
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
