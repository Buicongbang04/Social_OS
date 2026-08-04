"use client";

import { isApiError, type DashboardDay, type DashboardReport } from "@repo/sdk";
import { useCallback, useEffect, useState } from "react";
import { getClient } from "../lib/api";
import { ErrorNote, Panel } from "./ui";

/** The windows worth asking for. Longer than three months is a billing report. */
const WINDOWS = [7, 14, 30] as const;

/**
 * The numbers, at the top of the overview.
 *
 * One request, not four: an overview assembled from several responses shows
 * several different moments, and the first one to fail leaves a screen that is
 * partly blank with nothing on it saying which part is missing.
 */
export function DashboardPanel() {
  const [days, setDays] = useState<number>(14);
  const [report, setReport] = useState<DashboardReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (window: number) => {
    try {
      setReport(await getClient().dashboard(window));
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
      title="Tình hình"
      subtitle="Số request theo ngày, tiền đã dùng, việc đang chờ."
      actions={
        // One row of filters above the numbers, so the window that produced
        // them is visible beside them rather than remembered.
        <div className="flex gap-1" role="group" aria-label="Khoảng thời gian">
          {WINDOWS.map((window) => (
            <button
              key={window}
              type="button"
              onClick={() => setDays(window)}
              aria-pressed={days === window}
              className={`rounded px-2 py-1 text-xs ${
                days === window
                  ? "bg-neutral-900 text-white"
                  : "text-neutral-600 hover:bg-neutral-100"
              }`}
            >
              {window} ngày
            </button>
          ))}
        </div>
      }
    >
      {error !== null ? <ErrorNote message={error} /> : null}

      {report === null ? (
        <p className="text-sm text-neutral-500">
          {error === null ? "Đang tải…" : "—"}
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile
              label="Request hôm nay"
              value={String(report.spend.todayCalls)}
              note={`${report.spend.calls} trong ${days} ngày`}
            />
            <Tile
              label="Tiền đã dùng"
              value={usd(report.spend.costUsd)}
              note={
                // Said where the number is read, not in a footnote. A total
                // that is short by an unknown amount is misleading exactly
                // here.
                report.spend.unpricedCalls > 0
                  ? `Chưa tính ${report.spend.unpricedCalls} lượt không có bảng giá`
                  : `Hôm nay ${usd(report.spend.todayUsd)}`
              }
            />
            <Tile
              label="Việc đang chờ"
              value={String(report.queue.unfinished)}
              note={
                report.queue.awaitingApproval > 0
                  ? `${report.queue.awaitingApproval} đang chờ duyệt`
                  : `${report.queue.running} đang chạy`
              }
            />
            <Tile
              label="Bài chờ đăng"
              value={String(report.content.approved)}
              note={`${report.content.drafts} nháp · ${report.content.published} đã đăng`}
              warn={report.content.failed > 0}
              warnNote={`${report.content.failed} bài đăng hỏng`}
            />
          </div>

          <RequestsChart days={report.requestsByDay} />
        </div>
      )}
    </Panel>
  );
}

function Tile({
  label,
  value,
  note,
  warn = false,
  warnNote,
}: {
  label: string;
  value: string;
  note: string;
  warn?: boolean;
  warnNote?: string;
}) {
  return (
    <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-neutral-900">
        {value}
      </p>
      <p className="mt-0.5 text-xs text-neutral-500">
        {warn && warnNote ? (
          // Never colour alone: the word says what the colour means.
          <span className="text-amber-700">⚠ {warnNote}</span>
        ) : (
          note
        )}
      </p>
    </div>
  );
}

/**
 * Requests per day.
 *
 * Bars rather than a line: a day is a bucket, not a point on a continuum, and a
 * line between two days implies values in between that nobody measured.
 *
 * One series, so no legend — the heading names it. Only the busiest day carries
 * a number; the rest are readable on hover and, for anyone who cannot hover, in
 * the table below.
 */
function RequestsChart({ days }: { days: DashboardDay[] }) {
  const busiest = Math.max(...days.map((day) => day.calls), 1);
  const nothing = days.every((day) => day.calls === 0);

  return (
    <figure className="m-0">
      <figcaption className="text-sm font-medium text-neutral-700">
        Request mỗi ngày
      </figcaption>

      {nothing ? (
        <p className="mt-2 text-sm text-neutral-500">
          Chưa có request nào trong khoảng này.
        </p>
      ) : (
        <div
          className="mt-3 flex h-32 items-end gap-0.5"
          role="img"
          aria-label={`Số request mỗi ngày, cao nhất ${busiest} lượt`}
        >
          {days.map((day) => (
            <div
              key={day.day}
              className="group relative flex h-full flex-1 flex-col justify-end"
              // The hit target is the whole column, not the bar: a quiet day is
              // three pixels tall and otherwise unhoverable.
              title={`${vnDay(day.day)}: ${day.calls} request · ${usd(day.costUsd)}`}
            >
              {day.calls === busiest ? (
                <span className="mb-0.5 text-center text-[10px] tabular-nums text-neutral-500">
                  {day.calls}
                </span>
              ) : null}
              <div
                data-testid="bar"
                style={{
                  height: `${Math.max((day.calls / busiest) * 100, day.calls > 0 ? 3 : 0)}%`,
                }}
                className="rounded-t bg-blue-600 group-hover:bg-blue-700"
              />
            </div>
          ))}
        </div>
      )}

      <div className="mt-1 flex justify-between text-[10px] text-neutral-400">
        <span>{vnDay(days[0]?.day ?? "")}</span>
        <span>{vnDay(days.at(-1)?.day ?? "")}</span>
      </div>

      {/* The same numbers as text. A chart nobody can hover — a screen reader,
          a printout — is otherwise unreadable. */}
      <details className="mt-3">
        <summary className="cursor-pointer text-xs text-neutral-500">
          Xem dạng bảng
        </summary>
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
              <th className="py-1 pr-3 font-medium">Ngày</th>
              <th className="py-1 pr-3 text-right font-medium">Request</th>
              <th className="py-1 text-right font-medium">Tiền</th>
            </tr>
          </thead>
          <tbody>
            {days.map((day) => (
              <tr key={day.day} className="border-b border-neutral-100">
                <td className="py-1 pr-3">{vnDay(day.day)}</td>
                <td className="py-1 pr-3 text-right tabular-nums">
                  {day.calls}
                </td>
                <td className="py-1 text-right tabular-nums">
                  {usd(day.costUsd)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

/** `2026-08-04` → `04/08`. */
function vnDay(day: string): string {
  const [, month, date] = day.split("-");
  return month && date ? `${date}/${month}` : day;
}

/**
 * Money, to the cent, with the fractions of a cent kept out of sight.
 *
 * Rounded for display only. The exact decimal is what the API sent and what
 * anything adding these up should use.
 */
function usd(amount: string): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return "$0";
  return value > 0 && value < 0.01 ? "<$0.01" : `$${value.toFixed(2)}`;
}

function describe(caught: unknown): string {
  if (isApiError(caught)) return caught.message;
  return caught instanceof Error ? caught.message : "Không tải được số liệu.";
}
