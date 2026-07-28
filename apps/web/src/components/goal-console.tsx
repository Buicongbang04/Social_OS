"use client";

import { isApiError, type Workspace } from "@repo/sdk";
import { useState } from "react";
import { getClient } from "../lib/api";
import { ChatPanel } from "./chat-panel";
import { DocumentList } from "./document-list";
import { ConnectionsPanel } from "./connections-panel";
import { KeysPanel } from "./keys-panel";
import { MemoryPanel } from "./memory-panel";
import { ExecutionView } from "./execution-view";
import { RunList } from "./run-list";
import { ErrorNote, Panel, PrimaryButton } from "./ui";

/**
 * A few schedules in plain words. The raw expression stays editable because
 * cron can express things no preset list can, and hiding it would make the
 * feature look less capable than it is.
 */
const SCHEDULE_PRESETS = [
  { label: "Mỗi sáng 8h", cron: "0 8 * * *" },
  { label: "Mỗi giờ", cron: "0 * * * *" },
  { label: "Thứ Hai hàng tuần", cron: "0 9 * * 1" },
];

const DEFAULT_TIMEZONE = "Asia/Ho_Chi_Minh";

const EXAMPLES = [
  "Tìm xu hướng AI mới trong tuần này, viết một bài ngắn bằng tiếng Việt, rồi đăng lên facebook",
  "Mỗi sáng viết một caption ngắn về cà phê rồi đăng lên instagram, nhớ cho tôi duyệt trước",
  "Nghiên cứu đối thủ rồi làm báo cáo",
];

export function GoalConsole({ workspace }: { workspace: Workspace }) {
  const [objective, setObjective] = useState(EXAMPLES[0]!);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [executionId, setExecutionId] = useState<string | null>(null);
  /** Bumped so the run list picks up a freshly submitted run immediately. */
  const [listToken, setListToken] = useState(0);
  const [repeat, setRepeat] = useState(false);
  const [cron, setCron] = useState(SCHEDULE_PRESETS[0]!.cron);

  const run = async () => {
    setBusy(true);
    setError(null);
    setFields({});
    setExecutionId(null);

    try {
      const client = getClient();
      const goal = await client.createGoal({
        // The objective is the real input; the title exists so the goal is
        // identifiable in a list, and deriving it saves asking for both.
        title: objective.slice(0, 60),
        objective,
        constraints: { language: "vi" },
        // A timezone is required, never defaulted server-side: "8am" without
        // one is ambiguous across DST and regions.
        ...(repeat ? { schedule: { cron, timezone: DEFAULT_TIMEZONE } } : {}),
      });
      const execution = await client.submitGoal(goal.id);
      setExecutionId(execution.id);
      setListToken((token) => token + 1);
    } catch (caught) {
      if (isApiError(caught)) {
        setFields(caught.fieldErrors());
        setError(`${caught.message} (${caught.code})`);
      } else {
        setError(`Không gọi được API: ${String(caught)}`);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <Panel
        title="Mô tả điều bạn muốn"
        subtitle="Viết bằng ngôn ngữ tự nhiên. Runtime sẽ tự tách thành các bước và chạy theo đúng thứ tự phụ thuộc."
      >
        <div className="flex flex-col gap-3">
          <textarea
            value={objective}
            onChange={(event) => setObjective(event.target.value)}
            rows={3}
            className={`w-full resize-y rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-900/10 ${
              fields.objective ? "border-red-400" : "border-neutral-300"
            }`}
          />
          {fields.objective ? (
            <span className="text-xs text-red-600">{fields.objective}</span>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => setObjective(example)}
                className="rounded-full border border-neutral-200 px-3 py-1 text-xs text-neutral-600 hover:border-neutral-400"
              >
                {example.slice(0, 42)}…
              </button>
            ))}
          </div>

          <div className="rounded-md border border-neutral-200 p-3">
            <label className="flex items-center gap-2 text-sm text-neutral-700">
              <input
                type="checkbox"
                checked={repeat}
                onChange={(event) => setRepeat(event.target.checked)}
              />
              Lặp lại theo lịch
            </label>

            {repeat ? (
              <div className="mt-3 flex flex-col gap-2">
                <div className="flex flex-wrap gap-2">
                  {SCHEDULE_PRESETS.map((preset) => (
                    <button
                      key={preset.cron}
                      type="button"
                      onClick={() => setCron(preset.cron)}
                      className={`rounded-full border px-3 py-1 text-xs ${
                        cron === preset.cron
                          ? "border-neutral-900 text-neutral-900"
                          : "border-neutral-200 text-neutral-600 hover:border-neutral-400"
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <input
                  value={cron}
                  onChange={(event) => setCron(event.target.value)}
                  className={`w-full rounded-md border px-3 py-2 font-mono text-sm outline-none ${
                    fields.schedule ? "border-red-400" : "border-neutral-300"
                  }`}
                />
                <p className="text-xs text-neutral-500">
                  Giờ {DEFAULT_TIMEZONE}. Lần chạy đầu bắt đầu ngay bây giờ; các
                  lần sau theo lịch trên.
                </p>
                {fields.schedule ? (
                  <span className="text-xs text-red-600">
                    {fields.schedule}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="flex items-center gap-3">
            <PrimaryButton
              onClick={run}
              busy={busy}
              disabled={!objective.trim()}
            >
              Chạy
            </PrimaryButton>
            <span className="font-mono text-xs text-neutral-400">
              {workspace.id}
            </span>
          </div>

          <ErrorNote message={error} />
        </div>
      </Panel>

      {/* First, because everything below it costs money and this says whose.
          A workspace running on the platform's key without knowing it finds
          out from a bill, which is the wrong place to find out. */}
      <KeysPanel />

      {/* Under the keys, because both answer the same question — what this
          workspace is connected to and on whose authority. */}
      <ConnectionsPanel />

      {/* Above the run list: what a Goal can read has to be visible before
          someone writes a Goal that assumes it. */}
      <DocumentList />

      {/* Above the chat, because what the platform remembers changes every
          answer below it. */}
      <MemoryPanel />

      {/* Below the documents, because the obvious thing to ask about is what
          was just uploaded. */}
      <ChatPanel />

      <RunList
        selectedId={executionId}
        onSelect={setExecutionId}
        refreshToken={listToken}
      />

      {executionId ? (
        <ExecutionView key={executionId} executionId={executionId} />
      ) : null}
    </div>
  );
}
