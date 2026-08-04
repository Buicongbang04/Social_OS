"use client";

import { isApiError, type Comments, type Inbox } from "@repo/sdk";
import { useCallback, useEffect, useState } from "react";
import { getClient } from "../lib/api";
import { ErrorNote, Panel } from "./ui";

/**
 * Messages waiting on the workspace's channels.
 *
 * Read on every load rather than cached. A copy would be wrong the moment
 * somebody replies from the Facebook app, and a customer waiting for an answer
 * is the last thing that should be stale.
 *
 * There is no reply box, and that is deliberate rather than unfinished:
 * answering somebody's customers on their behalf is a much larger decision than
 * showing them who is waiting.
 *
 * Comments are here rather than on a screen of their own because they are the
 * same job: somebody asked something and is waiting. For a Page that sells
 * things most questions arrive as comments, so an inbox without them shows an
 * empty screen while customers wait underneath a post.
 */
export function InboxPanel() {
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [comments, setComments] = useState<Comments | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const client = getClient();
      // Read together. Sequentially, the comments would arrive after a round
      // trip somebody is already waiting through.
      const [messages, underPosts] = await Promise.all([
        client.inbox(),
        client.comments(),
      ]);
      setInbox(messages);
      setComments(underPosts);
      setError(null);
    } catch (caught) {
      setError(describe(caught));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const unread = inbox?.threads.filter((thread) => thread.unread).length ?? 0;
  const waiting = unread + (comments?.comments.length ?? 0);

  return (
    <Panel
      title={waiting > 0 ? `Hộp thư — ${waiting} đang chờ` : "Hộp thư"}
      subtitle="Tin nhắn và bình luận khách để lại. Chỉ xem — trả lời vẫn ở trên nền tảng."
    >
      <button
        type="button"
        onClick={() => void load()}
        disabled={busy}
        className="mb-3 text-xs text-neutral-500 underline hover:text-neutral-900 disabled:opacity-50"
      >
        {busy ? "Đang tải…" : "Tải lại"}
      </button>

      {/* A channel that could not be read is named rather than silently
          dropped. An empty inbox and an inbox nobody could open look the same
          on screen, and only one of them means there is nothing waiting. */}
      {[...(inbox?.failed ?? []), ...(comments?.failed ?? [])].map(
        (failure) => (
          <p
            key={`${failure.account}-${failure.reason}`}
            className="mb-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900"
          >
            Không đọc được {failure.account}: {failure.reason}
          </p>
        ),
      )}

      {inbox === null ? (
        <p className="text-sm text-neutral-500">Đang tải…</p>
      ) : inbox.threads.length === 0 ? (
        <p className="text-sm text-neutral-500">
          Không có tin nhắn nào. Nếu bạn vừa kết nối kênh, thử tải lại.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {inbox.threads.map((thread) => (
            <li
              key={thread.id}
              className={`rounded-md border px-3 py-2 text-sm ${
                thread.unread
                  ? "border-neutral-300 bg-white"
                  : "border-neutral-200 bg-neutral-50"
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={
                    thread.unread
                      ? "font-semibold"
                      : "font-medium text-neutral-600"
                  }
                >
                  {thread.participant}
                </span>
                {thread.unread ? (
                  <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-800">
                    chưa đọc
                  </span>
                ) : null}
                <span className="ml-auto text-xs text-neutral-400">
                  {thread.account} · {when(thread.updatedAt)}
                </span>
              </div>
              {thread.lastMessage ? (
                <p className="mt-1 text-neutral-600">{thread.lastMessage}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {/* Under the messages, in one list of its own. Interleaving them would
          mean sorting a comment against a message by time and calling that an
          order — they are answered in different places and often by different
          people. */}
      {comments !== null && comments.comments.length > 0 ? (
        <div className="mt-4">
          <p className="mb-2 text-xs font-medium text-neutral-500">
            Bình luận dưới bài đăng
          </p>
          <ul className="flex flex-col gap-1">
            {comments.comments.map((comment) => (
              <li
                key={comment.id}
                className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-neutral-700">
                    {comment.author}
                  </span>
                  <a
                    href={`https://www.facebook.com/${comment.postId}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="ml-auto text-xs text-neutral-400 underline"
                  >
                    {comment.account} · {when(comment.createdAt)}
                  </a>
                </div>
                <p className="mt-1 text-neutral-600">{comment.message}</p>
                {/* The post it sits under. Without it "còn hàng không" is a
                    question nobody can answer. */}
                {comment.postExcerpt ? (
                  <p className="mt-1 truncate text-xs text-neutral-400">
                    dưới bài: {comment.postExcerpt}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <ErrorNote message={error} />
    </Panel>
  );
}

/**
 * How long ago, in words.
 *
 * "3 ngày trước" answers the question people actually have about a waiting
 * customer; an ISO timestamp makes them do the arithmetic.
 */
function when(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return iso;

  const minutes = Math.floor((Date.now() - then) / 60_000);
  if (minutes < 1) return "vừa xong";
  if (minutes < 60) return `${minutes} phút trước`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;

  return `${Math.floor(hours / 24)} ngày trước`;
}

function describe(error: unknown): string {
  return isApiError(error) ? `${error.message} (${error.code})` : String(error);
}
