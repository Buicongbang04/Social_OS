"use client";

import { isApiError, type TrendItem, type TrendSourceName } from "@repo/sdk";
import { useCallback, useEffect, useState } from "react";
import { getClient } from "../lib/api";
import { ErrorNote, Panel, PrimaryButton } from "./ui";

const SOURCE_LABELS: Record<TrendSourceName, string> = {
  google: "Google tìm kiếm",
  youtube: "YouTube",
};

/**
 * What Vietnam is searching for and watching.
 *
 * The two sources are tabs rather than one merged list, because they do not
 * measure the same thing: Google publishes a band of searches, YouTube a view
 * count. Sorting them together would put a video with a hundred thousand views
 * above a search term with "20K+" and call that a ranking.
 */
export function TrendsPanel() {
  const [source, setSource] = useState<TrendSourceName>("google");
  const [items, setItems] = useState<TrendItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (which: TrendSourceName) => {
    setBusy(true);
    setItems(null);
    try {
      setItems(await getClient().listTrends({ source: which, limit: 15 }));
      setError(null);
    } catch (caught) {
      setError(describe(caught));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load(source);
  }, [load, source]);

  return (
    <Panel
      title="Xu hướng"
      subtitle="Người ta đang tìm gì và xem gì hôm nay. Bấm vào một dòng để đọc nguồn."
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {(Object.keys(SOURCE_LABELS) as TrendSourceName[]).map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => setSource(name)}
            className={`rounded-md px-3 py-1 text-sm ${
              source === name
                ? "bg-neutral-900 text-white"
                : "border border-neutral-300 text-neutral-700"
            }`}
          >
            {SOURCE_LABELS[name]}
          </button>
        ))}
        <PrimaryButton busy={busy} onClick={() => void load(source)}>
          Tải lại
        </PrimaryButton>
      </div>

      {items === null ? (
        <p className="text-sm text-neutral-500">
          {error === null ? "Đang tải…" : "—"}
        </p>
      ) : items.length === 0 ? (
        <p className="text-sm text-neutral-500">
          Nguồn này chưa có gì cho hôm nay.
        </p>
      ) : (
        <ol className="flex flex-col gap-1">
          {items.map((item, index) => (
            <li
              key={`${item.source}-${item.title}-${index}`}
              className="flex flex-wrap items-baseline gap-2 rounded-md border border-neutral-200 px-3 py-2 text-sm"
            >
              <span className="w-5 shrink-0 text-right font-mono text-xs text-neutral-400">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 font-medium">
                {item.url ? (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="underline decoration-neutral-300 hover:decoration-neutral-900"
                  >
                    {item.title}
                  </a>
                ) : (
                  item.title
                )}
              </span>

              {/* The number is shown with its unit spelled out. "184392" next
                  to "20K+" with nothing to tell them apart invites reading one
                  as bigger than the other. */}
              {item.volume ? (
                <span className="shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-600">
                  {item.source === "google"
                    ? `${item.volume} lượt tìm`
                    : `${formatViews(item.volume)} lượt xem`}
                </span>
              ) : null}

              {item.context ? (
                <span className="w-full text-xs text-neutral-500">
                  {item.context}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      )}

      <ErrorNote message={error} />
    </Panel>
  );
}

/** A view count with separators. Left as text if it is not a plain number. */
function formatViews(raw: string): string {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed.toLocaleString("vi-VN") : raw;
}

function describe(error: unknown): string {
  return isApiError(error) ? `${error.message} (${error.code})` : String(error);
}
