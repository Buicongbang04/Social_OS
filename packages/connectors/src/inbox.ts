import { RuntimeError } from "@repo/runtime";
import { graphBase, type PublishTarget } from "./publish";

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
