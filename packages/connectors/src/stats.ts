import { RuntimeError } from "@repo/runtime";
import { graphBase, type PublishTarget } from "./publish";

/**
 * How a post has done.
 *
 * Engagement counts, not reach. That is a deliberate line rather than an
 * omission — see `fetchPostStats` for why reach is absent.
 */
export type PostStats = {
  postId: string;
  createdAt: string;
  /** A trimmed snippet, so a person can tell which post this is. */
  message: string | null;
  likes: number;
  comments: number;
  shares: number;
  url: string;
};

const SNIPPET_LENGTH = 120;

/**
 * Read how recent posts have done.
 *
 * Engagement counts come off the post object itself and work on any Page.
 * Reach and views do not: Meta withholds Page Insights below a follower
 * threshold, and the metric names changed underneath everyone — `page_impressions`
 * and `post_impressions` were removed outright on 15 June 2026 in favour of
 * `page_media_view` and `post_media_view`.
 *
 * Reach is not read here on purpose. The replacement metrics are accepted by
 * Graph but every response available to test against came back empty, so the
 * code that parses them could not be verified against a single real answer.
 * A reader that quietly returns zeros looks exactly like a Page nobody saw,
 * which is a worse thing to ship than an honest gap.
 */
export async function fetchPostStats(
  target: PublishTarget,
  options: {
    limit?: number;
    env?: NodeJS.ProcessEnv;
    fetch?: typeof globalThis.fetch;
  } = {},
): Promise<PostStats[]> {
  const call = options.fetch ?? globalThis.fetch;
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 50);

  // `.limit(0)` asks for the count without the rows. Without it Graph returns
  // every like and comment, which is a great deal of other people's data to
  // move around in order to display a number.
  const url =
    `${graphBase(options.env)}/${target.externalId}/feed` +
    `?fields=id,created_time,message,` +
    `likes.summary(true).limit(0),comments.summary(true).limit(0),shares` +
    `&limit=${limit}`;

  let response: Response;
  try {
    response = await call(url, {
      headers: { authorization: `Bearer ${target.accessToken}` },
    });
  } catch (error: unknown) {
    throw new RuntimeError("NETWORK", "Không đọc được số liệu bài đăng.", {
      retryable: true,
      cause: error,
    });
  }

  const text = await response.text();
  if (!response.ok) {
    throw new RuntimeError(
      "PROVIDER",
      `Facebook không cho đọc số liệu: ${errorOf(text)}`,
      { retryable: response.status >= 500 || response.status === 429 },
    );
  }

  const payload = JSON.parse(text) as {
    data?: {
      id?: string;
      created_time?: string;
      message?: string;
      likes?: { summary?: { total_count?: number } };
      comments?: { summary?: { total_count?: number } };
      shares?: { count?: number };
    }[];
  };

  return (payload.data ?? []).map((post) => {
    const postId = String(post.id ?? "");
    return {
      postId,
      createdAt: String(post.created_time ?? ""),
      message: snippet(post.message),
      // Absent means zero. Graph omits `shares` entirely on a post nobody
      // shared, and reading that as "unknown" would put a dash where a real
      // zero belongs.
      likes: post.likes?.summary?.total_count ?? 0,
      comments: post.comments?.summary?.total_count ?? 0,
      shares: post.shares?.count ?? 0,
      url: `https://www.facebook.com/${postId.replace("_", "/posts/")}`,
    };
  });
}

function snippet(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed === "") return null;

  return trimmed.length > SNIPPET_LENGTH
    ? `${trimmed.slice(0, SNIPPET_LENGTH)}…`
    : trimmed;
}

function errorOf(text: string): string {
  try {
    return (
      (JSON.parse(text) as { error?: { message?: string } }).error?.message ??
      "không rõ lý do"
    );
  } catch {
    return "phản hồi không đọc được";
  }
}
