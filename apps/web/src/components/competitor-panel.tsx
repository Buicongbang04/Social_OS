"use client";

import {
  isApiError,
  type CompetitorAnalysis,
  type CrawledPage,
} from "@repo/sdk";
import { useState } from "react";
import { getClient } from "../lib/api";
import { ErrorNote, Panel, PrimaryButton } from "./ui";

type Result = {
  object: CompetitorAnalysis;
  page: CrawledPage;
  model: string;
  costUsd: string;
};

/**
 * What a competitor's page says, and what it does not.
 *
 * One page at a time, on request. Not a crawl of a whole site and not a
 * schedule: this fetches somebody else's server on the customer's behalf, and
 * the difference between one page somebody asked for and a background sweep is
 * the difference between reading and scraping.
 */
export function CompetitorPanel() {
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyse = async () => {
    if (url.trim() === "") return;
    setBusy(true);
    setError(null);
    try {
      setResult(await getClient().analyseCompetitor(url.trim()));
    } catch (caught) {
      setError(describe(caught));
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      title="Đối thủ"
      subtitle="Dán một địa chỉ trang. Đọc xem họ bán gì, cho ai, và không nói gì."
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void analyse();
          }}
          placeholder="https://doithu.com/trang-dich-vu"
          className="min-w-0 flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
        />
        <PrimaryButton
          busy={busy}
          onClick={() => void analyse()}
          disabled={url.trim() === ""}
        >
          Đọc trang
        </PrimaryButton>
      </div>

      <p className="mb-3 text-xs text-neutral-500">
        Nền tảng tôn trọng robots.txt của trang đó và tự xưng danh khi đọc.
        Trang nào từ chối thì không đọc.
      </p>

      {result === null ? null : (
        <div className="flex flex-col gap-3 text-sm">
          <div>
            <p className="text-xs font-medium text-neutral-500">Định vị</p>
            <p>{result.object.positioning || "—"}</p>
          </div>

          <div>
            <p className="text-xs font-medium text-neutral-500">
              Nói với ai · Giọng văn
            </p>
            <p>
              {result.object.audience || "—"}
              {result.object.tone ? ` · ${result.object.tone}` : ""}
            </p>
          </div>

          <Chips label="Sản phẩm, dịch vụ" items={result.object.offers} />
          <Chips label="Chủ đề nội dung" items={result.object.topics} />

          {/* The useful half, and the one worth reading carefully — it is what
              the page did not say, so it is where a model is most tempted to
              invent. Kept visually apart so it is never mistaken for something
              the competitor claimed. */}
          {result.object.gaps.length > 0 ? (
            <div className="rounded-md bg-amber-50 px-3 py-2">
              <p className="mb-1 text-xs font-medium text-amber-900">
                Trang này không nói gì về
              </p>
              <ul className="text-amber-900">
                {result.object.gaps.map((gap) => (
                  <li key={gap}>· {gap}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <p className="text-xs text-neutral-400">
            Đọc từ{" "}
            <a
              href={result.page.url}
              target="_blank"
              rel="noreferrer noopener"
              className="underline"
            >
              {result.page.title ?? result.page.url}
            </a>{" "}
            · {result.model} · ${result.costUsd}
          </p>
        </div>
      )}

      <ErrorNote message={error} />
    </Panel>
  );
}

function Chips({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;

  return (
    <div>
      <p className="mb-1 text-xs font-medium text-neutral-500">{label}</p>
      <div className="flex flex-wrap gap-1">
        {items.map((item) => (
          <span
            key={item}
            className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700"
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

function describe(error: unknown): string {
  return isApiError(error) ? `${error.message} (${error.code})` : String(error);
}
