"use client";

import {
  isApiError,
  type ContentChannel,
  type ContentLength,
  type ContentTone,
} from "@repo/sdk";
import { useState } from "react";
import { getClient } from "../lib/api";
import { ErrorNote, Panel, PrimaryButton } from "./ui";

/**
 * Every option, with a label.
 *
 * `Record<ContentChannel, string>` rather than a list built from the SDK's
 * constant: adding a channel there and forgetting it here then fails to
 * compile, instead of quietly leaving one option off the screen.
 */
const CHANNEL_LABELS: Record<ContentChannel, string> = {
  facebook: "Facebook",
  tiktok: "TikTok",
  threads: "Threads",
  blog: "Blog",
  email: "Email",
};

const TONE_LABELS: Record<ContentTone, string> = {
  "than-thien": "Thân thiện",
  "chuyen-nghiep": "Chuyên nghiệp",
  "hai-huoc": "Hài hước",
  "khan-truong": "Khẩn trương",
  "gan-gui": "Gần gũi",
};

const LENGTH_LABELS: Record<ContentLength, string> = {
  ngan: "Ngắn",
  vua: "Vừa",
  dai: "Dài",
};

/** What the studio has produced, in the order it was produced. */
type Draft = {
  body: string;
  title?: string;
  hashtags?: string[];
  /** Where an instruction could not be followed without changing a fact. */
  notes?: string[];
  seo?: { titles: string[]; metaDescription: string; keywords: string[] };
  cost: string;
  model: string;
};

/**
 * Write, rewrite, translate and check a post — without writing a Goal.
 *
 * The Goal path is for work the platform runs on its own. This is for the
 * other half of the job: somebody sitting down to write something now, wanting
 * a draft in front of them rather than a run to wait on.
 *
 * The draft stays on screen and every operation acts on it, so rewriting and
 * translating compose instead of each needing a fresh paste.
 */
export function StudioPanel() {
  const [brief, setBrief] = useState("");
  const [channel, setChannel] = useState<ContentChannel>("facebook");
  const [tone, setTone] = useState<ContentTone>("than-thien");
  const [length, setLength] = useState<ContentLength>("vua");
  const [instruction, setInstruction] = useState("");
  const [language, setLanguage] = useState("English");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const guard = async (what: string, run: () => Promise<void>) => {
    setBusy(what);
    setError(null);
    try {
      await run();
    } catch (caught) {
      setError(describe(caught));
    } finally {
      setBusy(null);
    }
  };

  const write = () =>
    guard("write", async () => {
      const result = await getClient().writeContent({
        brief: brief.trim(),
        channel,
        tone,
        length,
      });
      setDraft({
        title: result.object.title,
        body: result.object.body,
        hashtags: result.object.hashtags,
        cost: result.costUsd,
        model: result.model,
      });
    });

  const rewrite = () =>
    guard("rewrite", async () => {
      if (!draft) return;
      const result = await getClient().rewriteContent({
        original: draft.body,
        instruction: instruction.trim(),
      });
      // The rewrite replaces the body and carries its own notes. The title and
      // hashtags are left alone: the instruction was about the body, and
      // silently regenerating the rest would lose an edit somebody made.
      setDraft({
        ...draft,
        body: result.object.body,
        notes: result.object.notes,
        cost: result.costUsd,
        model: result.model,
      });
    });

  const translate = () =>
    guard("translate", async () => {
      if (!draft) return;
      const result = await getClient().translateContent({
        original: draft.body,
        targetLanguage: language.trim(),
      });
      setDraft({
        ...draft,
        body: result.object.body,
        notes: result.object.notes,
        cost: result.costUsd,
        model: result.model,
      });
    });

  const seo = () =>
    guard("seo", async () => {
      if (!draft) return;
      const result = await getClient().suggestSeo({ content: draft.body });
      setDraft({ ...draft, seo: result.object, cost: result.costUsd });
    });

  return (
    <Panel
      title="Studio nội dung"
      subtitle="Viết, viết lại, dịch và kiểm SEO — không cần tạo Goal."
    >
      <textarea
        value={brief}
        onChange={(event) => setBrief(event.target.value)}
        rows={3}
        placeholder="Viết gì? Ví dụ: giới thiệu dịch vụ mua hộ hàng Nhật, nhấn vào phí minh bạch."
        className="mb-2 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select value={channel} onChange={setChannel} labels={CHANNEL_LABELS} />
        <Select value={tone} onChange={setTone} labels={TONE_LABELS} />
        <Select value={length} onChange={setLength} labels={LENGTH_LABELS} />
        <PrimaryButton
          busy={busy === "write"}
          onClick={() => void write()}
          disabled={brief.trim() === ""}
        >
          Viết
        </PrimaryButton>
      </div>

      {draft === null ? (
        <p className="text-sm text-neutral-500">
          Chưa có bản nháp. Viết một câu brief rồi bấm Viết.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {draft.title ? <p className="font-medium">{draft.title}</p> : null}

          <textarea
            value={draft.body}
            onChange={(event) =>
              setDraft({ ...draft, body: event.target.value })
            }
            rows={10}
            className="w-full rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
          />

          {draft.hashtags && draft.hashtags.length > 0 ? (
            <p className="text-xs text-neutral-500">
              {draft.hashtags.map((tag) => `#${tag}`).join(" ")}
            </p>
          ) : null}

          {/* Shown, never dropped. This is the model saying it could not do
              what was asked without changing a fact — the one thing a person
              reviewing a rewrite most needs to see. */}
          {draft.notes && draft.notes.length > 0 ? (
            <ul className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {draft.notes.map((note) => (
                <li key={note}>· {note}</li>
              ))}
            </ul>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 border-t border-neutral-100 pt-3">
            <input
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              placeholder="ngắn hơn một nửa"
              className="w-48 rounded-md border border-neutral-300 px-2 py-1 text-sm focus:border-neutral-900 focus:outline-none"
            />
            <PrimaryButton
              busy={busy === "rewrite"}
              onClick={() => void rewrite()}
              disabled={instruction.trim() === ""}
            >
              Viết lại
            </PrimaryButton>

            <input
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
              placeholder="English"
              className="w-28 rounded-md border border-neutral-300 px-2 py-1 text-sm focus:border-neutral-900 focus:outline-none"
            />
            <PrimaryButton
              busy={busy === "translate"}
              onClick={() => void translate()}
              disabled={language.trim() === ""}
            >
              Dịch
            </PrimaryButton>

            <PrimaryButton busy={busy === "seo"} onClick={() => void seo()}>
              Gợi ý SEO
            </PrimaryButton>
          </div>

          {draft.seo ? (
            <div className="rounded-md border border-neutral-200 px-3 py-2 text-sm">
              <p className="mb-1 text-xs font-medium text-neutral-500">
                Tiêu đề gợi ý
              </p>
              <ul className="mb-2">
                {draft.seo.titles.map((title) => (
                  <li key={title}>· {title}</li>
                ))}
              </ul>
              <p className="mb-1 text-xs font-medium text-neutral-500">Mô tả</p>
              <p className="mb-2 text-neutral-700">
                {draft.seo.metaDescription}
              </p>
              <p className="text-xs text-neutral-500">
                Từ khoá: {draft.seo.keywords.join(", ")}
              </p>
            </div>
          ) : null}

          {/* What that draft cost. Small, but present — a studio whose price is
              invisible is one nobody can budget for. */}
          <p className="text-xs text-neutral-400">
            {draft.model} · ${draft.cost}
          </p>
        </div>
      )}

      <ErrorNote message={error} />
    </Panel>
  );
}

function Select<T extends string>({
  value,
  onChange,
  labels,
}: {
  value: T;
  onChange: (value: T) => void;
  labels: Record<T, string>;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value as T)}
      className="rounded-md border border-neutral-300 px-2 py-1 text-sm focus:border-neutral-900 focus:outline-none"
    >
      {Object.entries(labels).map(([key, label]) => (
        <option key={key} value={key}>
          {label as string}
        </option>
      ))}
    </select>
  );
}

function describe(error: unknown): string {
  return isApiError(error) ? `${error.message} (${error.code})` : String(error);
}
