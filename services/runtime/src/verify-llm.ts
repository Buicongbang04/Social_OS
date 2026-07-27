/**
 * Send one real Goal through the real Provider Gateway and report what came
 * back — including what it cost.
 *
 * Everything else in the suite runs against StubProviderAdapter, which proves
 * our code but says nothing about whether a live vendor actually understands
 * the prompts or returns the shape we demand. This closes that gap, and is the
 * only thing here that spends money.
 *
 *   pnpm --filter @repo/runtime-service verify:llm
 *   pnpm --filter @repo/runtime-service verify:llm "Mục tiêu của bạn"
 *
 * Needs AI_PROVIDER and the matching key in .env. No database and no Redis:
 * usage is collected in memory and printed, so this can be run against a
 * fresh clone.
 */
/* eslint-disable no-console -- This file is a CLI: its output IS the result. */
import {
  InMemoryUsageRecorder,
  formatError,
  type AiUsageRecord,
} from "@repo/ai";
import { newId, type UserId, type WorkspaceId } from "@repo/core";
import {
  InMemoryCapabilityRegistry,
  newExecutionFor,
  type Goal,
} from "@repo/runtime";
import { buildAiEngines } from "./ai-engines";
import { BUILTIN_CAPABILITIES } from "./capabilities/builtin";

const DEFAULT_OBJECTIVE =
  "Tìm xu hướng AI mới trong tuần này, viết một bài ngắn bằng tiếng Việt, rồi đăng lên facebook";

async function main(): Promise<void> {
  const objective = process.argv.slice(2).join(" ").trim() || DEFAULT_OBJECTIVE;

  const capabilities = new InMemoryCapabilityRegistry();
  for (const capability of BUILTIN_CAPABILITIES) {
    capabilities.register(capability.descriptor);
  }

  const recorder = new InMemoryUsageRecorder();
  const engines = buildAiEngines({ capabilities, recorder });

  if (engines.mode !== "llm") {
    console.error(
      "AI_PROVIDER is not set, or no key was found for the providers named in it.\n" +
        "This script exists to exercise a live vendor, so it stops rather than\n" +
        "silently falling back to the deterministic engines and reporting a\n" +
        "success that proves nothing.\n\n" +
        "Set AI_PROVIDER and the matching key in .env — see .env.example.",
    );
    process.exitCode = 1;
    return;
  }

  console.log(`Providers : ${engines.providers.join(" → ")}`);
  console.log(`Model     : ${process.env.AI_MODEL ?? "(provider default)"}`);
  console.log(`Objective : ${objective}\n`);

  const goal = buildGoal(objective);
  const execution = newExecutionFor(goal, newId("request"));

  console.log("→ Intent…");
  const intents = await engines.intentAnalyzer.analyze(goal, execution.id);
  for (const intent of intents) {
    console.log(
      `   ${intent.type.padEnd(18)} ${intent.action.padEnd(20)} ` +
        `conf=${intent.confidence.toFixed(2)}  ${JSON.stringify(intent.entities)}`,
    );
  }

  console.log("\n→ Plan…");
  const plan = await engines.planner.plan({ execution, goal, intents });
  const position = new Map(
    plan.tasks.map((task, index) => [task.id, index + 1]),
  );
  for (const [index, task] of plan.tasks.entries()) {
    const dependsOn = task.dependencies
      .map((id) => position.get(id) ?? "?")
      .join(", ");
    console.log(
      `   ${String(index + 1).padStart(2)}. ${task.capability.padEnd(24)}` +
        `${dependsOn ? `sau bước ${dependsOn}` : "chạy ngay"}`,
    );
    console.log(`       inputs: ${JSON.stringify(task.inputs)}`);
  }

  report(recorder.records);
}

function report(records: readonly AiUsageRecord[]): void {
  console.log("\n→ Usage");
  for (const record of records) {
    console.log(
      `   ${record.operation.padEnd(15)} ${record.provider}/${record.model}  ` +
        `in=${record.usage.inputTokens} out=${record.usage.outputTokens}  ` +
        `${record.latencyMs}ms  ${money(record)}`,
    );
  }

  const total = records.reduce((sum, r) => sum + r.cost.totalUsd, 0);
  const tokens = records.reduce((sum, r) => sum + r.usage.totalTokens, 0);
  const unpriced = records.filter((r) => !r.cost.priced).length;

  console.log(
    `   ${"TOTAL".padEnd(15)} ${records.length} call(s)  ${tokens} token  $${total.toFixed(6)}`,
  );

  if (unpriced > 0) {
    // Said out loud rather than folded into the total, because a report that
    // silently counts an unknown price as zero understates the bill.
    console.log(
      `   NOTE: ${unpriced} call(s) had no price entry, so the total above is` +
        ` short by their cost. Add the model to DEFAULT_MODEL_PRICING or pass` +
        ` a pricing override.`,
    );
  }
}

function money(record: AiUsageRecord): string {
  return record.cost.priced
    ? `$${record.cost.totalUsd.toFixed(6)}`
    : "$? (chưa có giá)";
}

function buildGoal(objective: string): Goal {
  const now = new Date();
  return {
    id: newId("goal"),
    // Not persisted — this script never touches the database, so these only
    // need to be well-formed.
    workspaceId: newId("workspace") as WorkspaceId,
    ownerId: newId("user") as UserId,
    title: "verify-llm",
    objective,
    description: null,
    type: "MULTI_STEP",
    priority: "NORMAL",
    constraints: { language: "vi" },
    inputs: {},
    outputs: [],
    schedule: null,
    status: "CREATED",
    metadata: {},
    createdAt: now,
    updatedAt: now,
    createdBy: null,
    updatedBy: null,
    version: 1,
  };
}

main().catch((error: unknown) => {
  // Formatted, never inspected: printing the raw object can crash the process
  // inside util.inspect and take the real message with it.
  console.error(`\nverify-llm failed: ${formatError(error)}`);
  if (error instanceof Error && error.stack) {
    console.error(error.stack.split("\n").slice(1, 5).join("\n"));
  }
  process.exitCode = 1;
});
