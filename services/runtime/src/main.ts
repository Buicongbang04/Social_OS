import Redis from "ioredis";
import { InMemoryEventBus } from "@repo/event";
import { createLogger } from "@repo/logger";
import {
  DrizzleAiUsageRepository,
  DrizzleDocumentRepository,
  DrizzleExecutionRepository,
  DrizzleGoalRepository,
  DrizzleTaskRepository,
  closeDbClient,
  createDbClient,
} from "@repo/database";
import { RedisSchedulerLock, RedisTaskQueue } from "@repo/queue";
import {
  BudgetPolicy,
  CapabilityExecutor,
  ExecutionEngine,
  InMemoryCapabilityRegistry,
} from "@repo/runtime";
import { buildAiEngines } from "./ai-engines";
import { buildKnowledgeStack } from "./knowledge";
import { BUILTIN_CAPABILITIES } from "./capabilities/builtin";
import { Scheduler } from "./scheduler";

const logger = createLogger("runtime");

/**
 * Headless runtime process.
 *
 * There is no HTTP surface here on purpose: services/api owns the API and
 * already carries auth, RBAC and rate limiting from Phase 0. This process only
 * consumes — it claims queued tasks, runs them and records the outcome.
 */
async function main(): Promise<void> {
  const databaseUrl = requireEnv("DATABASE_URL");
  const redisUrl = requireEnv("REDIS_URL");

  const db = createDbClient(databaseUrl, { maxConnections: 10 });
  const redis = new Redis(redisUrl);

  const registry = new InMemoryCapabilityRegistry();
  const capabilityExecutor = new CapabilityExecutor();

  const queue = new RedisTaskQueue(redis);

  const goals = new DrizzleGoalRepository(db);
  const executionRepository = new DrizzleExecutionRepository(db);

  const usage = new DrizzleAiUsageRepository(db);

  const ai = buildAiEngines({
    capabilities: registry,
    recorder: usage,
    // A metering write that fails must not fail work already paid for, but it
    // must not vanish either — it is unbilled revenue.
    onUsageError: (error, record) => {
      logger.error({ err: error, record }, "failed to record AI usage");
    },
  });

  // Document search, when Qdrant, MinIO and a provider are all configured.
  // Null otherwise, and the runtime starts without it rather than refusing to
  // start at all — but it says so, because a knowledge capability that is
  // silently absent looks to a planner exactly like one that never existed.
  const knowledge = buildKnowledgeStack({
    gateway: ai.gateway,
    documents: new DrizzleDocumentRepository(db),
    onError: (error, document) => {
      logger.error({ err: error, documentId: document.id }, "indexing failed");
    },
  });

  // The AI implementations win, and the deterministic builtins fill the rest.
  // Filtered rather than registered over the top, because the registry
  // deliberately refuses a duplicate id — a plugin must not be able to shadow
  // a core capability by registering later. Choosing here keeps that guard
  // intact and makes the substitution visible.
  const provided = [...ai.capabilities, ...(knowledge?.capabilities ?? [])];
  const providedIds = new Set(provided.map((c) => c.descriptor.id));
  const capabilities = [
    ...provided,
    ...BUILTIN_CAPABILITIES.filter((c) => !providedIds.has(c.descriptor.id)),
  ];

  for (const capability of capabilities) {
    registry.register(capability.descriptor);
    capabilityExecutor.register(capability);
  }

  const engine = new ExecutionEngine({
    goals,
    executions: executionRepository,
    tasks: new DrizzleTaskRepository(db),
    queue,
    intentAnalyzer: ai.intentAnalyzer,
    planner: ai.planner,
    capabilities: registry,
    capabilityExecutor,
    // Enforces the Goal's own maxCostUsd. Without this the constraint is
    // accepted by the API, stored, and never read — a budget that does nothing
    // is worse than no budget, because someone will rely on it.
    policy: new BudgetPolicy({ spend: usage }),
  });

  const scheduler = new Scheduler(
    engine,
    queue,
    new RedisSchedulerLock(redis),
    new InMemoryEventBus(),
    {},
    // Lets the scheduler also pick up Executions the API has submitted.
    { executions: executionRepository, goals },
  );

  /**
   * Index uploaded documents in the background.
   *
   * A separate loop from the scheduler rather than a step inside its tick: a
   * long document is many provider round trips, and running it on the tick
   * would stall every queued task behind one upload. `running` keeps one pass
   * at a time in this process — the compare-and-swap in the repository is what
   * keeps two processes apart.
   */
  const indexIntervalMs = positiveInt(process.env.INDEX_INTERVAL_MS, 5_000);
  let indexing: NodeJS.Timeout | undefined;
  let running = false;

  if (knowledge) {
    indexing = setInterval(() => {
      if (running) return;
      running = true;
      void knowledge.indexer
        .runOnce()
        .then((result) => {
          if (result.claimed > 0) {
            logger.info({ ...result }, "indexed documents");
          }
        })
        .catch((error: unknown) => {
          logger.error({ err: error }, "indexing pass failed");
        })
        .finally(() => {
          running = false;
        });
    }, indexIntervalMs);
  }

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "shutting down");
    scheduler.stop();
    if (indexing) clearInterval(indexing);
    // Give the in-flight tick a moment to finish rather than killing a task
    // mid-run and relying on reservation recovery to clean up.
    await new Promise((resolve) => setTimeout(resolve, 500));
    await Promise.allSettled([closeDbClient(db), redis.quit()]);
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  logger.info(
    {
      capabilities: registry.list().length,
      aiMode: ai.mode,
      aiProviders: ai.providers,
      aiModels: ai.models,
      aiCapabilities: ai.capabilities.map((c) => c.descriptor.id),
      knowledge: knowledge
        ? { qdrant: knowledge.qdrantUrl, storage: knowledge.storageEndpoint }
        : "disabled (cần QDRANT_URL, MINIO_URL và một AI provider)",
    },
    "runtime starting",
  );
  await scheduler.start();
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

main().catch((error: unknown) => {
  logger.error({ err: error }, "runtime failed to start");
  process.exitCode = 1;
});
