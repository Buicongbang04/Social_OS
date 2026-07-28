"use client";

import { isApiError, type SpendReport } from "@repo/sdk";
import { useCallback, useEffect, useState } from "react";
import { getClient } from "../lib/api";
import { ErrorNote, Panel } from "./ui";

const WINDOWS = [
  { days: 7, label: "7 ngày" },
  { days: 30, label: "30 ngày" },
  { days: 90, label: "90 ngày" },
] as const;

/**
 * What this workspace has spent on AI.
 *
 * The ledger behind this has been written since Phase 2 and had no way out
 * until now. A record nobody can read is a record nobody trusts — and this one
 * decides whether a budget constraint on a Goal means anything.
 */
export function SpendPanel() {
  const [days, setDays] = useState<number>(30);
  const [report, setReport] = useState<SpendReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (window: number) => {
    try {
      setReport(await getClient().spend(window));
      setError(null);
    } catch (caught) {
      setError(describe(caught));
    }
  }, []);

  useEffect(() => {
    void load(days);
  }, [load, days]);

  return (
    <Panel
      title="Chi phí AI"
      subtitle="Tiền đã tiêu cho các lời gọi model, và tiêu vào đâu."
    >
      <div className="mb-3 flex gap-2">
        {WINDOWS.map((window) => (
          <button
            key={window.days}
            type="button"
            onClick={() => setDays(window.days)}
            className={`rounded border px-2 py-1 text-xs ${
              days === window.days
                ? "border-neutral-900 bg-neutral-900 text-white"
                : "border-neutral-300 text-neutral-600 hover:border-neutral-500"
            }`}
          >
            {window.label}
          </button>
        ))}
      </div>

      {report === null ? (
        <p className="text-sm text-neutral-500">Đang tải…</p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <span className="text-2xl font-semibold tabular-nums">
              {money(report.total.costUsd)}
            </span>
            <span className="text-sm text-neutral-500">
              {report.total.calls} lời gọi ·{" "}
              {(
                report.total.inputTokens + report.total.outputTokens
              ).toLocaleString("vi-VN")}{" "}
              token
            </span>
          </div>

          {/* Said out loud rather than folded into the total. A model with no
              price contributes nothing to the figure above, so without this the
              number is quietly too low and nobody can tell by how much. */}
          {report.total.unpricedCalls > 0 ? (
            <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {report.total.unpricedCalls} lời gọi chạy trên model chưa có bảng
              giá, nên con số trên <strong>thấp hơn</strong> thực tế.
            </p>
          ) : null}

          {report.byModel.length === 0 ? (
            <p className="text-sm text-neutral-500">
              Chưa có lời gọi nào trong khoảng này.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-neutral-500">
                    <th className="pb-1 font-medium">Model</th>
                    <th className="pb-1 pl-3 font-medium">Lời gọi</th>
                    <th className="pb-1 pl-3 font-medium">Token</th>
                    <th className="pb-1 pl-3 font-medium">Chi phí</th>
                  </tr>
                </thead>
                <tbody>
                  {report.byModel.map((row) => (
                    <tr
                      key={`${row.provider}/${row.model}`}
                      className="border-t border-neutral-100"
                    >
                      <td className="py-2 pr-3">
                        {row.model}
                        <span className="ml-2 text-xs text-neutral-400">
                          {row.provider}
                        </span>
                      </td>
                      <td className="py-2 pl-3 text-right tabular-nums">
                        {row.calls}
                      </td>
                      <td className="py-2 pl-3 text-right tabular-nums">
                        {(row.inputTokens + row.outputTokens).toLocaleString(
                          "vi-VN",
                        )}
                      </td>
                      <td className="py-2 pl-3 text-right tabular-nums">
                        {money(row.costUsd)}
                        {row.unpricedCalls > 0 ? (
                          <span
                            className="ml-1 text-amber-700"
                            title={`${row.unpricedCalls} lời gọi chưa có giá`}
                          >
                            *
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <ErrorNote message={error} />
    </Panel>
  );
}

/**
 * A cost, at a scale a person can read.
 *
 * These are fractions of a cent per call. Rounding to two decimals would show
 * "$0.00" for everything and make the whole panel look broken, so small figures
 * keep the digits that carry the information.
 */
function money(usd: string): string {
  const value = Number(usd);
  if (!Number.isFinite(value)) return usd;
  if (value === 0) return "$0";
  if (value < 0.01) return `$${value.toFixed(6)}`;
  return `$${value.toFixed(2)}`;
}

function describe(error: unknown): string {
  return isApiError(error) ? `${error.message} (${error.code})` : String(error);
}
