import Redis from "ioredis";
import { InMemoryEventBus } from "@repo/event";
import { createLogger } from "@repo/logger";
import {
  DrizzleAiUsageRepository,
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

  // The AI implementations win, and the deterministic builtins fill the rest.
  // Filtered rather than registered over the top, because the registry
  // deliberately refuses a duplicate id — a plugin must not be able to shadow
  // a core capability by registering later. Choosing here keeps that guard
  // intact and makes the substitution visible.
  const aiIds = new Set(ai.capabilities.map((c) => c.descriptor.id));
  const capabilities = [
    ...ai.capabilities,
    ...BUILTIN_CAPABILITIES.filter((c) => !aiIds.has(c.descriptor.id)),
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

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "shutting down");
    scheduler.stop();
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
      aiCapabilities: ai.capabilities.map((c) => c.descriptor.id),
    },
    "runtime starting",
  );
  await scheduler.start();
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
