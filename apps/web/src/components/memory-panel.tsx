"use client";

import { isApiError, type WorkspaceMemory } from "@repo/sdk";
import { useCallback, useEffect, useState } from "react";
import { getClient } from "../lib/api";
import { ErrorNote, Panel, PrimaryButton } from "./ui";

const EXAMPLES = [
  { key: "giọng văn", value: "thân thiện, ngắn gọn, không dùng tiếng lóng" },
  { key: "khách hàng mục tiêu", value: "chủ shop online 25–40 tuổi" },
  { key: "điều cấm kỵ", value: "không hứa hẹn kết quả cụ thể về doanh số" },
];

/**
 * What the platform remembers about this workspace.
 *
 * On screen, and editable, because memory that shapes every answer and cannot
 * be inspected is the frightening kind: when a remembered fact is wrong, the
 * only symptom is that the output has quietly been wrong for a while, and
 * there is nowhere to look.
 */
export function MemoryPanel() {
  const [facts, setFacts] = useState<WorkspaceMemory[] | null>(null);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setFacts(await getClient().listMemory());
      setError(null);
    } catch (caught) {
      setError(describe(caught));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const remember = async () => {
    if (key.trim() === "" || value.trim() === "") return;
    setBusy(true);
    try {
      await getClient().rememberFact(key.trim(), value.trim());
      setKey("");
      setValue("");
      await load();
    } catch (caught) {
      setError(describe(caught));
    } finally {
      setBusy(false);
    }
  };

  const forget = async (fact: WorkspaceMemory) => {
    try {
      await getClient().forgetFact(fact.id);
      await load();
    } catch (caught) {
      setError(describe(caught));
    }
  };

  return (
    <Panel
      title="Ghi nhớ về workspace"
      subtitle="Những điều này đi kèm MỌI câu trả lời, không chỉ hội thoại hiện tại."
    >
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <input
          value={key}
          onChange={(event) => setKey(event.target.value)}
          placeholder="ví dụ: giọng văn"
          className="w-48 rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
        />
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void remember();
          }}
          placeholder="thân thiện, ngắn gọn"
          className="min-w-0 flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
        />
        <PrimaryButton
          busy={busy}
          onClick={() => void remember()}
          disabled={key.trim() === "" || value.trim() === ""}
        >
          Ghi nhớ
        </PrimaryButton>
      </div>

      {facts === null ? (
        <p className="text-sm text-neutral-500">Đang tải…</p>
      ) : facts.length === 0 ? (
        <div className="text-sm text-neutral-500">
          <p>Chưa ghi nhớ gì. Vài thứ đáng nhớ:</p>
          <ul className="mt-1 flex flex-wrap gap-2">
            {EXAMPLES.map((example) => (
              <li key={example.key}>
                <button
                  type="button"
                  onClick={() => {
                    setKey(example.key);
                    setValue(example.value);
                  }}
                  className="rounded border border-neutral-200 px-2 py-1 text-xs hover:border-neutral-400"
                >
                  {example.key}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <ul className="flex flex-col gap-1">
          {facts.map((fact) => (
            <li
              key={fact.id}
              className="flex flex-wrap items-center gap-3 rounded-md border border-neutral-200 px-3 py-2 text-sm"
            >
              <span className="shrink-0 font-medium">{fact.key}</span>
              <span className="min-w-0 flex-1 text-neutral-600">
                {fact.value}
              </span>
              {/* Shown because a fact the platform decided to remember by
                  itself is one the workspace never agreed to. Only MANUAL is
                  written today; the label is here so the day that changes is
                  visible rather than silent. */}
              {fact.source === "LEARNED" ? (
                <span className="shrink-0 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                  tự học
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => void forget(fact)}
                className="shrink-0 text-xs text-neutral-500 underline hover:text-red-700"
              >
                Quên
              </button>
            </li>
          ))}
        </ul>
      )}

      <ErrorNote message={error} />
    </Panel>
  );
}

function describe(error: unknown): string {
  return isApiError(error) ? `${error.message} (${error.code})` : String(error);
}
