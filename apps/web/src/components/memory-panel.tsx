"use client";

import { isApiError, type BrandFact, type WorkspaceMemory } from "@repo/sdk";
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
  /** Where to read the workspace's own site from. */
  const [siteUrl, setSiteUrl] = useState("");
  /** What the site suggested, before anybody agreed to it. */
  const [proposed, setProposed] = useState<BrandFact[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [reading, setReading] = useState(false);

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

  /**
   * Read the site and show what it suggests.
   *
   * Nothing is saved here. A remembered fact shapes every post written
   * afterwards, so a wrong one is not one bad answer — it is a bad answer
   * repeated until somebody notices. The person decides which ones are true.
   */
  const readSite = async () => {
    if (siteUrl.trim() === "") return;
    setReading(true);
    setError(null);
    try {
      const result = await getClient().extractBrandFacts(siteUrl.trim());
      setProposed(result.object.facts);
      // Nothing ticked to begin with. Pre-ticking would make "save" the path
      // of least resistance for facts nobody read.
      setPicked([]);
    } catch (caught) {
      setError(describe(caught));
      setProposed(null);
    } finally {
      setReading(false);
    }
  };

  const savePicked = async () => {
    const chosen = (proposed ?? []).filter((fact) => picked.includes(fact.key));
    if (chosen.length === 0) return;

    setBusy(true);
    try {
      // One at a time, and the existing PUT is idempotent by key — reading the
      // site twice replaces what it said rather than leaving two answers to
      // one question.
      for (const fact of chosen) {
        await getClient().rememberFact(fact.key, fact.value);
      }
      setProposed(null);
      setPicked([]);
      setSiteUrl("");
      await load();
    } catch (caught) {
      setError(describe(caught));
    } finally {
      setBusy(false);
    }
  };

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
      {/* Above the manual box, because typing ten facts by hand is the part
          nobody finishes. The site already says most of them. */}
      <div className="mb-3 rounded-md border border-neutral-200 p-3">
        <div className="flex flex-wrap items-end gap-2">
          <input
            value={siteUrl}
            onChange={(event) => setSiteUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void readSite();
            }}
            placeholder="https://congty-cua-ban.com"
            className="min-w-0 flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
          />
          <PrimaryButton
            busy={reading}
            onClick={() => void readSite()}
            disabled={siteUrl.trim() === ""}
          >
            Đọc website
          </PrimaryButton>
        </div>
        <p className="mt-2 text-xs text-neutral-500">
          Đọc trang của chính bạn và đề xuất những điều đáng nhớ. Không tự lưu —
          bạn tick cái nào thì lưu cái đó.
        </p>

        {proposed !== null ? (
          proposed.length === 0 ? (
            <p className="mt-3 text-sm text-neutral-500">
              Không rút ra được gì từ trang này. Thử một trang giới thiệu cụ thể
              thay vì trang chủ.
            </p>
          ) : (
            <div className="mt-3">
              <ul className="flex flex-col gap-2">
                {proposed.map((fact) => (
                  <li key={fact.key} className="text-sm">
                    <label className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={picked.includes(fact.key)}
                        onChange={(event) =>
                          setPicked((current) =>
                            event.target.checked
                              ? [...current, fact.key]
                              : current.filter((k) => k !== fact.key),
                          )
                        }
                      />
                      <span>
                        <span className="font-medium">{fact.key}</span>
                        <span className="block text-neutral-600">
                          {fact.value}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>

              <div className="mt-3">
                <PrimaryButton
                  busy={busy}
                  onClick={() => void savePicked()}
                  disabled={picked.length === 0}
                >
                  Lưu {picked.length} mục đã chọn
                </PrimaryButton>
              </div>
            </div>
          )
        ) : null}
      </div>

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
