"use client";

import {
  isApiError,
  type Execution,
  type ExecutionUsage,
  type Task,
} from "@repo/sdk";
import { useEffect, useState } from "react";
import { getClient } from "../lib/api";
import { ErrorNote, Panel, PrimaryButton, StatusBadge } from "./ui";

/** Nothing more will happen to an execution in one of these. */
const TERMINAL = new Set(["COMPLETED", "FAILED", "CANCELLED"]);

const POLL_MS = 1_500;

/**
 * How long an execution may sit in CREATED before we suspect nothing is
 * consuming the queue. The runtime picks work up within one scheduler tick, so
 * several seconds means it is not running.
 */
const STALLED_AFTER_MS = 8_000;

export function ExecutionView({ executionId }: { executionId: string }) {
  const [execution, setExecution] = useState<Execution | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [usage, setUsage] = useState<ExecutionUsage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stalled, setStalled] = useState(false);
  /** Bumped after a decision so the view re-reads immediately. */
  const [nudge, setNudge] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();

    const poll = async () => {
      try {
        const client = getClient();
        const [next, nextTasks, nextUsage] = await Promise.all([
          client.getExecution(executionId),
          client.listTasks(executionId),
          client.getUsage(executionId),
        ]);
        if (cancelled) return;

        setExecution(next);
        setTasks(nextTasks);
        setUsage(nextUsage);
        setError(null);
        setStalled(
          next.status === "CREATED" &&
            Date.now() - startedAt > STALLED_AFTER_MS,
        );

        // Stop polling once nothing can change: leaving an interval running
        // against a finished execution burns requests for no information.
        if (!TERMINAL.has(next.status)) {
          timer = setTimeout(() => void poll(), POLL_MS);
        }
      } catch (caught) {
        if (cancelled) return;
        setError(
          isApiError(caught)
            ? `${caught.message} (${caught.code})`
            : String(caught),
        );
        // Keep trying: a dropped connection should not permanently freeze the
        // view on a run that is still going.
        timer = setTimeout(() => void poll(), POLL_MS * 2);
      }
    };

    void poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [executionId, nudge]);

  if (!execution) {
    return (
      <Panel title="Execution">
        <p className="text-sm text-neutral-500">Đang tải…</p>
        <ErrorNote message={error} />
      </Panel>
    );
  }

  const position = new Map(tasks.map((task, index) => [task.id, index + 1]));

  return (
    <Panel
      title="Kết quả chạy"
      subtitle={execution.id}
      actions={<StatusBadge status={execution.status} />}
    >
      <div className="flex flex-col gap-5">
        {stalled ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Execution vẫn ở <code>CREATED</code>. Không có tiến trình nào nhận
            việc — nhiều khả năng <code>services/runtime</code> chưa chạy. Mở
            một terminal khác và chạy{" "}
            <code>pnpm --filter @repo/runtime-service dev</code>.
          </p>
        ) : null}

        {execution.failureReason ? (
          <ErrorNote message={execution.failureReason} />
        ) : null}

        {execution.plan ? (
          <div>
            <h3 className="mb-2 text-sm font-semibold text-neutral-700">
              Kế hoạch{" "}
              <span className="font-normal text-neutral-500">
                — {String(execution.plan.metadata.planner ?? "?")}
                {execution.plan.metadata.model
                  ? ` / ${String(execution.plan.metadata.model)}`
                  : ""}
              </span>
            </h3>
            <ol className="flex flex-col gap-2">
              {tasks.map((task, index) => (
                <li
                  key={task.id}
                  className="rounded-md border border-neutral-200 px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm">
                      <span className="mr-2 font-mono text-xs text-neutral-400">
                        {index + 1}.
                      </span>
                      <span className="font-medium">{task.capability}</span>
                      {task.dependencies.length > 0 ? (
                        <span className="ml-2 text-xs text-neutral-500">
                          sau bước{" "}
                          {task.dependencies
                            .map((id) => position.get(id) ?? "?")
                            .join(", ")}
                        </span>
                      ) : (
                        <span className="ml-2 text-xs text-neutral-400">
                          chạy ngay
                        </span>
                      )}
                    </span>
                    <StatusBadge status={task.status} />
                  </div>

                  {task.metadata.description ? (
                    <p className="mt-1 text-xs text-neutral-500">
                      {String(task.metadata.description)}
                    </p>
                  ) : null}

                  {task.attempt > 1 ? (
                    <p className="mt-1 text-xs text-amber-700">
                      Lần thử {task.attempt}
                    </p>
                  ) : null}

                  {task.lastError ? (
                    <p className="mt-1 text-xs text-red-600">
                      {task.lastError}
                    </p>
                  ) : null}

                  {task.outputs ? (
                    <pre className="mt-2 overflow-x-auto rounded bg-neutral-50 p-2 text-xs text-neutral-700">
                      {JSON.stringify(task.outputs, null, 2)}
                    </pre>
                  ) : null}
                </li>
              ))}
            </ol>
          </div>
        ) : (
          <p className="text-sm text-neutral-500">
            Chưa có kế hoạch — runtime đang phân tích Goal.
          </p>
        )}

        <ApprovalPanel
          execution={execution}
          tasks={tasks}
          onDecided={() => setNudge((n) => n + 1)}
        />

        <UsagePanel usage={usage} />
        <ErrorNote message={error} />
      </div>
    </Panel>
  );
}

/**
 * The gate a user asked for.
 *
 * Shows what is about to be published before asking, because a prompt that
 * says only "approve?" without showing what is being approved trains people to
 * click yes — which is the same outcome as auto-approving, just slower.
 */
function ApprovalPanel({
  execution,
  tasks,
  onDecided,
}: {
  execution: Execution;
  tasks: Task[];
  onDecided: () => void;
}) {
  const [busy, setBusy] = useState<"APPROVED" | "REJECTED" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pending = tasks.find(
    (task) => task.status === "WAITING" && task.outputs?.awaitingApproval,
  );
  if (execution.status !== "WAITING" || !pending) return null;

  const preview = pending.outputs ?? {};

  const decide = async (decision: "APPROVED" | "REJECTED") => {
    setBusy(decision);
    setError(null);
    try {
      await getClient().decideApproval(execution.id, decision);
      onDecided();
    } catch (caught) {
      setError(
        isApiError(caught)
          ? `${caught.message} (${caught.code})`
          : String(caught),
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-4">
      <h3 className="text-sm font-semibold text-amber-900">
        Đang chờ bạn duyệt
      </h3>
      <p className="mt-1 text-xs text-amber-800">
        Chưa có gì được đăng. Nội dung bên dưới chỉ được gửi đi sau khi bạn đồng
        ý.
      </p>

      {preview.title ? (
        <p className="mt-3 text-sm font-medium text-neutral-900">
          {String(preview.title)}
        </p>
      ) : null}
      {preview.body ? (
        <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-700">
          {String(preview.body)}
        </p>
      ) : null}
      {preview.platforms ? (
        <p className="mt-2 text-xs text-neutral-600">
          Sẽ đăng lên: {JSON.stringify(preview.platforms)}
        </p>
      ) : null}

      <div className="mt-4 flex items-center gap-2">
        <PrimaryButton
          onClick={() => void decide("APPROVED")}
          busy={busy === "APPROVED"}
          disabled={busy !== null}
        >
          Duyệt và đăng
        </PrimaryButton>
        <button
          type="button"
          onClick={() => void decide("REJECTED")}
          disabled={busy !== null}
          className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 disabled:opacity-50"
        >
          {busy === "REJECTED" ? "Đang xử lý…" : "Từ chối"}
        </button>
      </div>

      <ErrorNote message={error} />
    </div>
  );
}

function UsagePanel({ usage }: { usage: ExecutionUsage | null }) {
  if (!usage || usage.calls.length === 0) {
    return (
      <p className="text-xs text-neutral-500">
        Chưa có lời gọi AI nào được ghi nhận. Nếu <code>AI_PROVIDER</code> chưa
        đặt, runtime dùng engine keyword tất định và không tốn tiền.
      </p>
    );
  }

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-neutral-700">
        Chi phí AI
      </h3>
      <table className="w-full text-left text-xs">
        <thead className="text-neutral-500">
          <tr>
            <th className="py-1 font-medium">Thao tác</th>
            <th className="py-1 font-medium">Model</th>
            <th className="py-1 text-right font-medium">Token</th>
            <th className="py-1 text-right font-medium">Độ trễ</th>
            <th className="py-1 text-right font-medium">Chi phí</th>
          </tr>
        </thead>
        <tbody>
          {usage.calls.map((call) => (
            <tr key={call.id} className="border-t border-neutral-100">
              <td className="py-1 font-mono">{call.operation}</td>
              <td className="py-1 text-neutral-600">
                {call.provider}/{call.model}
              </td>
              <td className="py-1 text-right">
                {call.inputTokens} + {call.outputTokens}
              </td>
              <td className="py-1 text-right">{call.latencyMs}ms</td>
              <td className="py-1 text-right font-mono">
                {call.costPriced ? `$${Number(call.costUsd).toFixed(6)}` : "—"}
              </td>
            </tr>
          ))}
          <tr className="border-t border-neutral-300 font-medium">
            <td className="py-1" colSpan={2}>
              Tổng
            </td>
            <td className="py-1 text-right">{usage.totalTokens}</td>
            <td />
            <td className="py-1 text-right font-mono">
              ${Number(usage.totalUsd).toFixed(6)}
            </td>
          </tr>
        </tbody>
      </table>

      {usage.unpricedCalls > 0 ? (
        // Said out loud rather than folded into the total: a report that counts
        // an unknown price as zero understates the bill.
        <p className="mt-2 text-xs text-amber-700">
          {usage.unpricedCalls} lời gọi chưa có giá trong bảng, nên tổng trên
          còn thiếu phần chi phí của chúng.
        </p>
      ) : null}
    </div>
  );
}
