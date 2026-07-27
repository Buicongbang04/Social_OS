"use client";

import { isApiError, type Execution } from "@repo/sdk";
import { useEffect, useState } from "react";
import { getClient } from "../lib/api";
import { ErrorNote, Panel, StatusBadge } from "./ui";

const POLL_MS = 4_000;

/**
 * Recent runs in this workspace.
 *
 * This exists because runs no longer only start when someone presses a button:
 * a scheduled Goal fires on its own, and if it stops for approval there was
 * previously nowhere to see it — so it would wait for a person who never
 * learned they were being asked. That is the same failure as auto-approving,
 * reached by a different route.
 */
export function RunList({
  selectedId,
  onSelect,
  refreshToken,
}: {
  selectedId: string | null;
  onSelect: (executionId: string) => void;
  /** Changed by the parent after submitting, to pull the new run in at once. */
  refreshToken: number;
}) {
  const [runs, setRuns] = useState<Execution[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const next = await getClient().listExecutions();
        if (cancelled) return;
        setRuns(next);
        setError(null);
      } catch (caught) {
        if (cancelled) return;
        setError(
          isApiError(caught)
            ? `${caught.message} (${caught.code})`
            : String(caught),
        );
      } finally {
        // Keeps polling even after an error: a scheduled run can appear at any
        // time, and giving up would hide exactly the runs nobody started.
        if (!cancelled) timer = setTimeout(() => void poll(), POLL_MS);
      }
    };

    void poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [refreshToken]);

  const waiting = (runs ?? []).filter((run) => run.status === "WAITING");

  return (
    <Panel
      title="Các lần chạy"
      subtitle="Gồm cả những lần do lịch tự kích hoạt."
    >
      {waiting.length > 0 ? (
        <p className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {waiting.length} lần chạy đang chờ bạn duyệt. Chưa có gì được đăng.
        </p>
      ) : null}

      {runs === null ? (
        <p className="text-sm text-neutral-500">Đang tải…</p>
      ) : runs.length === 0 ? (
        <p className="text-sm text-neutral-500">
          Chưa có lần chạy nào. Gửi một mục tiêu ở trên để bắt đầu.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {runs.map((run) => (
            <li key={run.id}>
              <button
                type="button"
                onClick={() => onSelect(run.id)}
                className={`flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm ${
                  run.id === selectedId
                    ? "border-neutral-900"
                    : run.status === "WAITING"
                      ? "border-amber-300 bg-amber-50/50"
                      : "border-neutral-200 hover:border-neutral-400"
                }`}
              >
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-neutral-500">
                  {run.id}
                </span>
                <span className="shrink-0 text-xs text-neutral-400">
                  {formatWhen(run.createdAt)}
                </span>
                <StatusBadge status={run.status} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <ErrorNote message={error} />
    </Panel>
  );
}

/** Relative for anything recent, absolute once it stops being "just now". */
function formatWhen(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";

  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return "vừa xong";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} phút trước`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} giờ trước`;
  return new Date(iso).toLocaleDateString();
}
