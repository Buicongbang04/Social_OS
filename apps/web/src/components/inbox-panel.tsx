"use client";

import { isApiError, type Inbox } from "@repo/sdk";
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
 */
export function InboxPanel() {
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setInbox(await getClient().inbox());
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

  return (
    <Panel
      title={unread > 0 ? `Hộp thư — ${unread} chưa đọc` : "Hộp thư"}
      subtitle="Tin khách gửi tới các kênh đã kết nối. Chỉ xem — trả lời vẫn ở trên nền tảng."
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
      {inbox?.failed.map((failure) => (
        <p
          key={failure.account}
          className="mb-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          Không đọc được {failure.account}: {failure.reason}
        </p>
      ))}

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
