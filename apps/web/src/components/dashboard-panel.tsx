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
              tone="requests"
              label="Request hôm nay"
              value={String(report.spend.todayCalls)}
              note={`${report.spend.calls} trong ${days} ngày`}
            />
            <Tile
              tone="money"
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
              tone="queue"
              label="Việc đang chờ"
              value={String(report.queue.unfinished)}
              note={
                report.queue.awaitingApproval > 0
                  ? `${report.queue.awaitingApproval} đang chờ duyệt`
                  : `${report.queue.running} đang chạy`
              }
            />
            <Tile
              tone="content"
              label="Bài chờ đăng"
              value={String(report.content.approved)}
              note={`${report.content.drafts} nháp · ${report.content.published} đã đăng`}
              warn={report.content.failed > 0}
              warnNote={`${report.content.failed} bài đăng hỏng`}
            />
          </div>

          <RequestsChart days={report.requestsByDay} />
          <SpendChart days={report.requestsByDay} />

          {/* Side by side: they are the two halves of "what is in the pipe",
              and reading one under the other makes them look sequential. */}
          <div className="grid gap-6 md:grid-cols-2">
            <StatusBars
              title="Việc theo trạng thái"
              rows={queueRows(report.queue.byStatus)}
            />
            <StatusBars
              title="Nội dung theo trạng thái"
              rows={[
                { label: "Nháp", count: report.content.drafts },
                { label: "Chờ đăng", count: report.content.approved },
                { label: "Đang đăng", count: report.content.publishing },
                { label: "Đã đăng", count: report.content.published },
                { label: "Hỏng", count: report.content.failed, bad: true },
              ]}
            />
          </div>
        </div>
      )}
    </Panel>
  );
}

/**
 * One colour per thing being counted, in a fixed order.
 *
 * Four hues checked with the palette validator rather than picked by eye:
 * blue-600 / amber-600 / emerald-600 / rose-700 stay apart under red-green and
 * blue-yellow colour blindness and all clear 3:1 against white. They are tied
 * to the tile, not to its rank, so a number going up never repaints anything.
 *
 * The colour is carried by a bar and a dot. The figures themselves stay in
 * ordinary ink: a number wearing its own colour is harder to read and says
 * nothing the label beside it does not already say.
 */
const TONES = {
  requests: { bar: "bg-blue-600", dot: "bg-blue-600", tint: "bg-blue-50/60" },
  money: { bar: "bg-amber-600", dot: "bg-amber-600", tint: "bg-amber-50/60" },
  queue: {
    bar: "bg-emerald-600",
    dot: "bg-emerald-600",
    tint: "bg-emerald-50/60",
  },
  content: { bar: "bg-rose-700", dot: "bg-rose-700", tint: "bg-rose-50/60" },
} as const;

function Tile({
  tone,
  label,
  value,
  note,
  warn = false,
  warnNote,
}: {
  tone: keyof typeof TONES;
  label: string;
  value: string;
  note: string;
  warn?: boolean;
  warnNote?: string;
}) {
  const colours = TONES[tone];

  return (
    <div
      className={`overflow-hidden rounded-md border border-neutral-200 ${colours.tint}`}
    >
      <div className={`h-1 w-full ${colours.bar}`} />
      <div className="p-3">
        <p className="flex items-center gap-1.5 text-xs text-neutral-500">
          <span className={`h-2 w-2 rounded-full ${colours.dot}`} aria-hidden />
          {label}
        </p>
        <p className="mt-1 text-2xl font-semibold tabular-nums text-neutral-900">
          {value}
        </p>
        <p className="mt-0.5 text-xs text-neutral-500">
          {warn && warnNote ? (
            // Never colour alone: the word says what the colour means.
            <span className="font-medium text-rose-700">⚠ {warnNote}</span>
          ) : (
            note
          )}
        </p>
      </div>
    </div>
  );
}

/**
 * Requests per day.
 *
 * Bars rather than a line: a day is a bucket, not a point on a continuum, and a
 * line between two days implies values in between that nobody measured.
 *
 * One measure, so one colour for every bar — a ramp that goes darker where the
 * bar is taller spends the only free channel on what the height already says.
 * Today is the exception, and it is a different thing rather than a bigger one:
 * a part-day always looks like a slump next to the finished days beside it, so
 * it wears the second hue and says so underneath.
 *
 * Only the busiest day carries a number; the rest are readable on hover and,
 * for anyone who cannot hover, in the table below.
 */
function RequestsChart({ days }: { days: DashboardDay[] }) {
  const busiest = Math.max(...days.map((day) => day.calls), 1);
  const today = days.at(-1)?.day;

  // Nothing to draw means nothing on screen — not an empty frame with a key,
  // an axis and a table toggle around a sentence saying there is nothing. The
  // tiles above already report the zero.
  if (days.every((day) => day.calls === 0)) return null;

  return (
    <figure className="m-0">
      <figcaption className="flex flex-wrap items-baseline gap-x-3 text-sm font-medium text-neutral-700">
        Request mỗi ngày
        {/* Two colours, so both are named. A key beside the title is cheaper to
            read than a legend box under the plot. */}
        <span className="flex items-center gap-1 text-xs font-normal text-neutral-500">
          <span className="h-2 w-2 rounded-full bg-blue-600" aria-hidden />
          <span>ngày đã trọn</span>
          <span
            className="ml-2 h-2 w-2 rounded-full bg-amber-600"
            aria-hidden
          />
          <span>hôm nay (chưa hết ngày)</span>
        </span>
      </figcaption>

      <div
        // A baseline the bars sit on: without one, a short bar floats and the
        // eye has nothing to measure it against.
        className="mt-3 flex h-32 items-end gap-0.5 border-b border-neutral-200"
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
              data-today={day.day === today ? "true" : undefined}
              style={{
                height: `${Math.max((day.calls / busiest) * 100, day.calls > 0 ? 3 : 0)}%`,
              }}
              className={`rounded-t ${
                day.day === today
                  ? "bg-amber-600 group-hover:bg-amber-700"
                  : "bg-blue-600 group-hover:bg-blue-700"
              }`}
            />
          </div>
        ))}
      </div>

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

/**
 * Money spent, running total.
 *
 * A line, where the requests are bars, because the two answer different
 * questions. Requests are a count in a bucket: each day stands alone and the
 * height is the whole story. A running total is one quantity that only ever
 * goes up, measured at points along the way — the slope between two points is
 * real information (how fast it is being spent), which is exactly what a line
 * shows and a row of bars hides.
 *
 * Drawn as an SVG with a viewBox rather than sized in pixels, so it fits
 * whatever width it is given.
 */
function SpendChart({ days }: { days: DashboardDay[] }) {
  let running = 0;
  const points = days.map((day) => {
    running += Number(day.costUsd) || 0;
    return { day: day.day, total: running, spent: Number(day.costUsd) || 0 };
  });

  const highest = points.at(-1)?.total ?? 0;
  // Nothing spent means a flat line along zero, which says less than the tile
  // above it already does.
  if (highest <= 0) return null;

  const width = 100;
  const height = 32;
  const x = (index: number) =>
    points.length === 1 ? 0 : (index / (points.length - 1)) * width;
  const y = (total: number) => height - (total / highest) * height;

  const line = points
    .map((point, index) => `${x(index)},${y(point.total)}`)
    .join(" ");

  return (
    <figure className="m-0">
      <figcaption className="text-sm font-medium text-neutral-700">
        Tiền đã dùng, cộng dồn
      </figcaption>

      <div className="relative mt-3">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          className="h-28 w-full border-b border-neutral-200"
          role="img"
          aria-label={`Tiền đã dùng cộng dồn, tổng ${usd(String(highest))}`}
        >
          {/* Filled underneath, faintly: it says "this is an accumulation"
              without the fill competing with the line for attention. */}
          <polygon
            points={`0,${height} ${line} ${width},${height}`}
            className="fill-amber-600/10"
          />
          <polyline
            points={line}
            className="fill-none stroke-amber-600"
            strokeWidth={2}
            // Scaled by the viewBox otherwise, which would make the line
            // thicker on a wide screen than a narrow one.
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
            data-testid="spend-line"
          />
        </svg>

        {/* Hit targets, one per day, over the whole height. A point on a line
            is four pixels wide and unhoverable; a column is not. */}
        <div className="absolute inset-0 flex">
          {points.map((point) => (
            <div
              key={point.day}
              className="flex-1"
              title={`${vnDay(point.day)}: +${usd(String(point.spent))} · cộng dồn ${usd(String(point.total))}`}
            />
          ))}
        </div>
      </div>

      <div className="mt-1 flex justify-between text-[10px] text-neutral-400">
        <span>{vnDay(days[0]?.day ?? "")}</span>
        {/* The end of the line is the number anyone came for, so it is written
            out rather than left to be read off an axis. */}
        <span className="tabular-nums text-neutral-500">
          {usd(String(highest))}
        </span>
      </div>
    </figure>
  );
}

/**
 * How many things are sitting in each status.
 *
 * Horizontal bars, not a pie: these are counts to be compared, and a length
 * along a common baseline is read accurately where an angle is not. Horizontal
 * rather than vertical because the labels are words — sideways text is the
 * usual price of a vertical bar chart of named categories.
 */
function StatusBars({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; count: number; bad?: boolean }[];
}) {
  const present = rows.filter((row) => row.count > 0);
  if (present.length === 0) return null;

  const most = Math.max(...present.map((row) => row.count));

  return (
    <figure className="m-0">
      <figcaption className="text-sm font-medium text-neutral-700">
        {title}
      </figcaption>

      <ul className="mt-2 flex flex-col gap-1.5">
        {present.map((row) => (
          <li key={row.label} className="flex items-center gap-2 text-xs">
            <span className="w-24 shrink-0 text-neutral-500">{row.label}</span>
            <span className="h-2.5 flex-1 rounded bg-neutral-100">
              <span
                data-testid="status-bar"
                style={{ width: `${Math.max((row.count / most) * 100, 4)}%` }}
                // Failures wear the status colour and say so in the label
                // beside them; nothing here is colour alone.
                className={`block h-2.5 rounded ${
                  row.bad ? "bg-rose-700" : "bg-emerald-600"
                }`}
              />
            </span>
            <span className="w-8 shrink-0 text-right tabular-nums text-neutral-700">
              {row.count}
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

/**
 * Execution statuses, in Vietnamese, in the order a run goes through them.
 *
 * Named rather than shown raw: CREATED, VALIDATING and PLANNING mean nothing to
 * the person waiting for a post. Anything not listed is folded into "Khác" so a
 * status added later still shows up somewhere instead of vanishing from the
 * total.
 */
const QUEUE_LABELS: Record<string, string> = {
  CREATED: "Vừa nhận",
  VALIDATING: "Đang kiểm",
  PLANNING: "Đang lập kế hoạch",
  READY: "Sẵn sàng",
  SCHEDULED: "Đã xếp lịch",
  RUNNING: "Đang chạy",
  WAITING: "Chờ duyệt",
  RETRYING: "Đang thử lại",
  PAUSED: "Tạm dừng",
  CANCELLING: "Đang huỷ",
  CANCELLED: "Đã huỷ",
  COMPLETED: "Xong",
  FAILED: "Hỏng",
  ARCHIVED: "Lưu trữ",
};

function queueRows(
  byStatus: Record<string, number>,
): { label: string; count: number; bad?: boolean }[] {
  const rows = Object.entries(byStatus).map(([status, count]) => ({
    label: QUEUE_LABELS[status] ?? status,
    count,
    ...(status === "FAILED" ? { bad: true } : {}),
  }));

  // Biggest first: a list in status order makes somebody read all of it to
  // find the line that matters.
  return rows.sort((a, b) => b.count - a.count);
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
