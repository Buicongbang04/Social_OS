"use client";

import { isApiError, type CampaignReportRow } from "@repo/sdk";
import { useCallback, useEffect, useState } from "react";
import { getClient } from "../lib/api";
import { ErrorNote, Panel } from "./ui";

type Report = {
  rows: CampaignReportRow[];
  unreadable: { account: string; reason: string }[];
};

/**
 * Whether any of this is working.
 *
 * The one screen that answers a question the rest of the platform cannot: a
 * calendar says what will go out and a studio says what was written, but
 * neither says whether it was worth doing.
 */
export function ReportPanel() {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setReport(await getClient().campaignReport());
      setError(null);
    } catch (caught) {
      setError(describe(caught));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Panel
      title="Kết quả chiến dịch"
      subtitle="Viết bao nhiêu, ra bao nhiêu, được bao nhiêu tương tác."
    >
      {report === null ? (
        <p className="text-sm text-neutral-500">
          {error === null ? "Đang tải…" : "—"}
        </p>
      ) : report.rows.length === 0 ? (
        <p className="text-sm text-neutral-500">
          Chưa có nội dung nào để tổng kết.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
                <th className="py-1 pr-3 font-medium">Chiến dịch</th>
                <th className="py-1 pr-3 text-right font-medium">Nháp</th>
                <th className="py-1 pr-3 text-right font-medium">Chờ đăng</th>
                <th className="py-1 pr-3 text-right font-medium">Đã đăng</th>
                <th className="py-1 pr-3 text-right font-medium">Hỏng</th>
                <th className="py-1 pr-3 text-right font-medium">Thích</th>
                <th className="py-1 pr-3 text-right font-medium">Bình luận</th>
                <th className="py-1 text-right font-medium">Chia sẻ</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <tr
                  key={row.campaignId ?? "loose"}
                  className="border-b border-neutral-100"
                >
                  <td className="py-1.5 pr-3">
                    {row.name}
                    {/* Said on the row it applies to, not once at the bottom.
                        A total that is missing some posts is misleading
                        exactly where it is read. */}
                    {row.postsWithoutStats > 0 ? (
                      <span
                        className="ml-2 text-xs text-amber-700"
                        title="Số liệu chỉ đọc được cho các bài gần đây. Những bài cũ hơn không được cộng vào."
                      >
                        {row.postsWithoutStats} bài chưa có số liệu
                      </span>
                    ) : null}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">
                    {row.drafts}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">
                    {row.approved}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">
                    {row.published}
                  </td>
                  <td
                    className={`py-1.5 pr-3 text-right tabular-nums ${
                      row.failed > 0 ? "text-red-700" : ""
                    }`}
                  >
                    {row.failed}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">
                    {row.likes}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">
                    {row.comments}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {row.shares}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Named, not hidden. A channel whose numbers could not be read makes
              every total below it an undercount, and the person reading has no
              other way to find out. */}
          {report.unreadable.length > 0 ? (
            <ul className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {report.unreadable.map((entry) => (
                <li key={entry.account}>
                  Chưa đọc được số liệu của {entry.account}: {entry.reason}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}

      <ErrorNote message={error} />
    </Panel>
  );
}

function describe(error: unknown): string {
  return isApiError(error) ? `${error.message} (${error.code})` : String(error);
}
