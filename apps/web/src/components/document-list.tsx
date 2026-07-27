"use client";

import { isApiError, type DocumentSummary } from "@repo/sdk";
import { useCallback, useEffect, useRef, useState } from "react";
import { getClient } from "../lib/api";
import { ErrorNote, Panel, StatusBadge } from "./ui";

/** Fast enough that a small file looks instant, slow enough not to hammer. */
const POLL_MS = 3_000;

const ACCEPT = ".txt,.md,.markdown,.csv,.json,text/plain,text/markdown,text/csv,application/json";

/**
 * Upload files the workspace can then be asked about.
 *
 * The status is on screen for every document because it is the honest answer
 * to "can I ask about this yet". A file is stored before it is searchable, and
 * a list that showed only names would let someone upload a policy, ask about
 * it a second later, get nothing back, and conclude the search is broken.
 */
export function DocumentList() {
  const [documents, setDocuments] = useState<DocumentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const next = await getClient().listDocuments();
      setDocuments(next);
      setError(null);
      return next;
    } catch (caught) {
      setError(describe(caught));
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      const next = await load();
      if (cancelled) return;

      // Polling stops once nothing is in flight. Indexing is the only thing
      // that changes on its own, so a list of settled documents that kept
      // refetching would be pure noise on the network tab.
      const working = (next ?? []).some(
        (document) =>
          document.status === "PENDING" || document.status === "INDEXING",
      );
      if (working) timer = setTimeout(() => void tick(), POLL_MS);
    };

    void tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // `load` is stable; this runs once and re-arms itself while work is live.
  }, [load]);

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    setNote(null);

    try {
      const result = await getClient().uploadDocument(file);
      setNote(
        result.duplicate
          ? `"${result.fileName}" đã có sẵn — không tải lên lại.`
          : `Đã tải "${result.fileName}" lên. Đang lập chỉ mục…`,
      );
      await load();
      // Re-arm the poll: the new document is PENDING and nothing else would
      // notice it becoming searchable.
      setTimeout(() => void load(), POLL_MS);
    } catch (caught) {
      setError(describe(caught));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const remove = async (document: DocumentSummary) => {
    setError(null);
    try {
      await getClient().deleteDocument(document.id);
      setNote(`Đã xoá "${document.fileName}".`);
      await load();
    } catch (caught) {
      setError(describe(caught));
    }
  };

  const download = async (document: DocumentSummary) => {
    try {
      const url = await getClient().documentDownloadUrl(document.id);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (caught) {
      setError(describe(caught));
    }
  };

  return (
    <Panel
      title="Tài liệu"
      subtitle="Tải file lên để Goal có thể tra cứu nội dung thật thay vì đoán."
    >
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
          }}
          className="block text-sm text-neutral-600 file:mr-3 file:rounded-md file:border file:border-neutral-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:text-neutral-800 hover:file:border-neutral-400"
        />
        {busy ? (
          <span className="text-sm text-neutral-500">Đang tải lên…</span>
        ) : null}
      </div>

      <p className="mb-3 text-xs text-neutral-500">
        Hiện nhận .txt, .md, .csv, .json — những định dạng đọc được thẳng thành
        chữ. PDF và Word cần bước bóc tách riêng, chưa làm.
      </p>

      {note ? (
        <p className="mb-3 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-700">
          {note}
        </p>
      ) : null}

      {documents === null ? (
        <p className="text-sm text-neutral-500">Đang tải…</p>
      ) : documents.length === 0 ? (
        <p className="text-sm text-neutral-500">
          Chưa có tài liệu nào. Tải một file lên rồi thử hỏi Goal về nội dung
          trong đó.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {documents.map((document) => (
            <li
              key={document.id}
              className="flex flex-wrap items-center gap-3 rounded-md border border-neutral-200 px-3 py-2 text-sm"
            >
              <span className="min-w-0 flex-1 truncate">
                {document.fileName}
              </span>
              <span className="shrink-0 text-xs text-neutral-400">
                {formatSize(document.sizeBytes)}
              </span>
              <span className="shrink-0 text-xs text-neutral-400">
                {describeIndex(document)}
              </span>
              <StatusBadge status={document.status} />
              <button
                type="button"
                onClick={() => void download(document)}
                className="shrink-0 text-xs text-neutral-500 underline hover:text-neutral-800"
              >
                Tải về
              </button>
              <button
                type="button"
                onClick={() => void remove(document)}
                className="shrink-0 text-xs text-neutral-500 underline hover:text-red-700"
              >
                Xoá
              </button>
            </li>
          ))}
        </ul>
      )}

      <ErrorNote message={error} />
    </Panel>
  );
}

/**
 * What the status actually means for someone about to ask a question.
 *
 * "READY" alone does not say whether the file produced anything to search; a
 * document that chunked to nothing would sit there looking finished.
 */
function describeIndex(document: DocumentSummary): string {
  switch (document.status) {
    case "PENDING":
      return "chờ lập chỉ mục";
    case "INDEXING":
      return "đang lập chỉ mục";
    case "READY":
      return `${document.chunkCount} đoạn · ${document.embeddingModel ?? "?"}`;
    case "FAILED":
      return document.failureReason ?? "lỗi";
    default:
      return "";
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function describe(error: unknown): string {
  return isApiError(error)
    ? `${error.message} (${error.code})`
    : String(error);
}
