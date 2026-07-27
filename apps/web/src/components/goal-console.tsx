"use client";

import { isApiError, type Workspace } from "@repo/sdk";
import { useState } from "react";
import { getClient } from "../lib/api";
import { ExecutionView } from "./execution-view";
import { ErrorNote, Panel, PrimaryButton } from "./ui";

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
      });
      const execution = await client.submitGoal(goal.id);
      setExecutionId(execution.id);
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

      {executionId ? <ExecutionView executionId={executionId} /> : null}
    </div>
  );
}
