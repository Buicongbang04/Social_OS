"use client";

import { isApiError, type PostStatsReport } from "@repo/sdk";
import { useCallback, useEffect, useState } from "react";
import { getClient } from "../lib/api";
import { ErrorNote, Panel } from "./ui";

/**
 * How recent posts have done.
 *
 * Engagement counts, not reach. Meta removed the impressions metrics in June
 * 2026, and withholds the replacements below a follower threshold — so the code
 * to read them could not be checked against a single real answer. A column that
 * is quietly always zero looks exactly like a post nobody saw, which is a worse
 * thing to show than an honest gap.
 */
export function StatsPanel() {
  const [report, setReport] = useState<PostStatsReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setReport(await getClient().postStats());
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

  return (
    <Panel
      title="Bài đã đăng"
      subtitle="Tương tác trên các bài gần đây. Chưa có lượt tiếp cận — xem ghi chú bên dưới."
    >
      <button
        type="button"
        onClick={() => void load()}
        disabled={busy}
        className="mb-3 text-xs text-neutral-500 underline hover:text-neutral-900 disabled:opacity-50"
      >
        {busy ? "Đang tải…" : "Tải lại"}
      </button>

      {report?.failed.map((failure) => (
        <p
          key={failure.account}
          className="mb-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          Không đọc được {failure.account}: {failure.reason}
        </p>
      ))}

      {report === null ? (
        <p className="text-sm text-neutral-500">Đang tải…</p>
      ) : report.posts.length === 0 ? (
        <p className="text-sm text-neutral-500">
          Chưa có bài nào trên các kênh đã nối.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-neutral-500">
                <th className="pb-1 font-medium">Bài</th>
                <th className="pb-1 pl-3 font-medium">Thích</th>
                <th className="pb-1 pl-3 font-medium">Bình luận</th>
                <th className="pb-1 pl-3 font-medium">Chia sẻ</th>
              </tr>
            </thead>
            <tbody>
              {report.posts.map((post) => (
                <tr key={post.postId} className="border-t border-neutral-100">
                  <td className="py-2 pr-3">
                    <a
                      href={post.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-neutral-800 underline decoration-neutral-300 hover:decoration-neutral-800"
                    >
                      {post.message ?? "(không có nội dung chữ)"}
                    </a>
                    <span className="ml-2 text-xs text-neutral-400">
                      {post.account} · {post.createdAt.slice(0, 10)}
                    </span>
                  </td>
                  {/* Right-aligned so the eye can compare a column of numbers
                      without reading each one. */}
                  <td className="py-2 pl-3 text-right tabular-nums">
                    {post.likes}
                  </td>
                  <td className="py-2 pl-3 text-right tabular-nums">
                    {post.comments}
                  </td>
                  <td className="py-2 pl-3 text-right tabular-nums">
                    {post.shares}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-xs text-neutral-500">
        Lượt tiếp cận chưa có: Meta đã bỏ chỉ số impressions từ 15/6/2026 và
        không trả chỉ số thay thế cho Page dưới ngưỡng người theo dõi.
      </p>

      <ErrorNote message={error} />
    </Panel>
  );
}

function describe(error: unknown): string {
  return isApiError(error) ? `${error.message} (${error.code})` : String(error);
}
