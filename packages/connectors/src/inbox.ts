import { RuntimeError } from "@repo/runtime";
import type { PublishTarget } from "./publish";
import { graphBase } from "./version";

/**
 * One thread in a Page's inbox.
 *
 * Deliberately shallow: who wrote, when, and the last thing they said. Pulling
 * whole conversation histories would put a great deal of somebody's private
 * correspondence into places it does not need to be — a log line, a model's
 * context window, a task output stored forever.
 */
export type InboxThread = {
  id: string;
  /** Who the Page is talking to, as the platform names them. */
  participant: string;
  updatedAt: string;
  /** The most recent message, trimmed. Null when the thread is empty. */
  lastMessage: string | null;
  /** Whether anyone at the Page has read it. */
  unread: boolean;
};

/** One comment on a post. */
export type PostComment = {
  id: string;
  author: string;
  message: string;
  createdAt: string;
  /** The post it sits under, and a trimmed line of that post to recognise it by. */
  postId: string;
  postExcerpt: string | null;
};

/**
 * How much of a message to carry.
 *
 * Enough to know what a thread is about and whether it needs answering; not
 * the whole thing. Anything longer belongs where the customer wrote it.
 */
const SNIPPET_LENGTH = 200;

/**
 * Read the Page's inbox.
 *
 * Polling rather than webhooks, and that is a real limitation rather than a
 * shortcut: webhooks need an app the platform has approved and a public URL to
 * deliver to, while this needs only the token the Page already has. It means
 * messages arrive on a delay measured in minutes, not seconds.
 */
export async function fetchInbox(
  target: PublishTarget,
  options: {
    limit?: number;
    env?: NodeJS.ProcessEnv;
    fetch?: typeof globalThis.fetch;
  } = {},
): Promise<InboxThread[]> {
  const call = options.fetch ?? globalThis.fetch;
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);

  const url =
    `${graphBase(options.env)}/${target.externalId}/conversations` +
    `?fields=id,updated_time,unread_count,participants,` +
    `messages.limit(1){message,created_time}&limit=${limit}`;

  const payload = await readGraph(call, url, target.accessToken, "hộp thư");

  const threads = (payload.data ?? []) as {
    id?: string;
    updated_time?: string;
    unread_count?: number;
    participants?: { data?: { name?: string; id?: string }[] };
    messages?: { data?: { message?: string }[] };
  }[];

  return threads.map((thread) => ({
    id: String(thread.id ?? ""),
    // The Page itself is in `participants` too. Taking the last one rather
    // than the first is what usually leaves the customer, but the Page's own
    // id is filtered below where it is known.
    participant: participantOf(thread.participants?.data, target.externalId),
    updatedAt: String(thread.updated_time ?? ""),
    lastMessage: snippet(thread.messages?.data?.[0]?.message),
    // Meta counts unread messages rather than flagging the thread. Zero means
    // somebody has looked at it.
    unread: (thread.unread_count ?? 0) > 0,
  }));
}

/**
 * Every recent comment on the Page, newest first.
 *
 * One request, not one per post. Reading the feed and then each post's comments
 * separately is eleven round trips to answer one question, and eleven chances
 * for a rate limit — Graph nests the comments inside the feed read, and it
 * answers in a single call.
 *
 * This exists because for a Page that sells things, most questions arrive as
 * comments rather than messages. An inbox that only reads messages shows an
 * empty screen while customers are waiting underneath a post.
 */
export async function fetchRecentComments(
  target: PublishTarget,
  options: {
    /** How far back through the feed to look. */
    posts?: number;
    /** How many comments to take from each post. */
    perPost?: number;
    env?: NodeJS.ProcessEnv;
    fetch?: typeof globalThis.fetch;
  } = {},
): Promise<PostComment[]> {
  const call = options.fetch ?? globalThis.fetch;
  const posts = Math.min(Math.max(options.posts ?? 10, 1), 50);
  const perPost = Math.min(Math.max(options.perPost ?? 10, 1), 50);

  const fields = [
    "id",
    "message",
    `comments.limit(${perPost}){id,from,message,created_time}`,
  ].join(",");

  const payload = await readGraph(
    call,
    `${graphBase(options.env)}/${target.externalId}/feed?fields=${fields}&limit=${posts}`,
    target.accessToken,
    "bình luận",
  );

  const found: PostComment[] = [];

  for (const raw of (payload.data ?? []) as {
    id?: string;
    message?: string;
    comments?: { data?: unknown[] };
  }[]) {
    for (const item of raw.comments?.data ?? []) {
      const comment = item as {
        id?: string;
        from?: { name?: string };
        message?: string;
        created_time?: string;
      };

      found.push({
        id: String(comment.id ?? ""),
        // Facebook omits `from` for people who have not granted the app
        // anything, which is most of them. A name we do not have is said as
        // such rather than guessed at.
        author: comment.from?.name ?? "Người dùng",
        message: snippet(comment.message) ?? "",
        createdAt: String(comment.created_time ?? ""),
        postId: String(raw.id ?? ""),
        postExcerpt: snippet(raw.message),
      });
    }
  }

  // Newest first. A comment from an hour ago matters more than one from last
  // week, and the feed's own order is by post, not by comment.
  return found.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Read the comments on one post. */
export async function fetchComments(
  target: PublishTarget,
  postId: string,
  options: {
    limit?: number;
    env?: NodeJS.ProcessEnv;
    fetch?: typeof globalThis.fetch;
  } = {},
): Promise<PostComment[]> {
  const call = options.fetch ?? globalThis.fetch;
  const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);

  const payload = await readGraph(
    call,
    `${graphBase(options.env)}/${postId}/comments?fields=id,from,message,created_time&limit=${limit}`,
    target.accessToken,
    "bình luận",
  );

  return (
    (payload.data ?? []) as {
      id?: string;
      from?: { name?: string };
      message?: string;
      created_time?: string;
    }[]
  ).map((comment) => ({
    id: String(comment.id ?? ""),
    author: comment.from?.name ?? "Người dùng",
    message: snippet(comment.message) ?? "",
    createdAt: String(comment.created_time ?? ""),
    postId,
    postExcerpt: null,
  }));
}

/**
 * One GET against Graph, with the failures named.
 *
 * Shared because the two reads above fail in exactly the same ways, and a
 * second copy would be a second place for the credential verdict to be
 * forgotten.
 */
async function readGraph(
  call: typeof globalThis.fetch,
  url: string,
  accessToken: string,
  what: string,
): Promise<{ data?: unknown[] }> {
  let response: Response;
  try {
    response = await call(url, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
  } catch (error: unknown) {
    throw new RuntimeError("NETWORK", `Không đọc được ${what} từ Facebook.`, {
      retryable: true,
      cause: error,
    });
  }

  const text = await response.text();
  if (!response.ok) {
    throw new RuntimeError(
      "PROVIDER",
      `Facebook không cho đọc ${what}: ${describeGraphError(text)}`,
      { retryable: response.status >= 500 || response.status === 429 },
    );
  }

  return JSON.parse(text) as { data?: unknown[] };
}

/** The other party in a thread, given that the Page is in the list too. */
function participantOf(
  participants: { name?: string; id?: string }[] | undefined,
  pageId: string,
): string {
  const other = (participants ?? []).find((person) => person.id !== pageId);
  return other?.name ?? "Người dùng";
}

function snippet(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;

  return trimmed.length > SNIPPET_LENGTH
    ? `${trimmed.slice(0, SNIPPET_LENGTH)}…`
    : trimmed;
}

/** The message only. Graph error bodies quote back what was sent. */
function describeGraphError(text: string): string {
  try {
    const error = (JSON.parse(text) as { error?: { message?: string } }).error;
    return error?.message ?? "không rõ lý do";
  } catch {
    return "phản hồi không đọc được";
  }
}
