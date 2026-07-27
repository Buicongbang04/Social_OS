import Redis from "ioredis";
import { InMemoryEventBus } from "@repo/event";
import { createLogger } from "@repo/logger";
import {
  DrizzleExecutionRepository,
  DrizzleGoalRepository,
  DrizzleTaskRepository,
  closeDbClient,
  createDbClient,
} from "@repo/database";
import { RedisSchedulerLock, RedisTaskQueue } from "@repo/queue";
import {
  CapabilityExecutor,
  ExecutionEngine,
  InMemoryCapabilityRegistry,
  KeywordIntentAnalyzer,
  TemplatePlanner,
} from "@repo/runtime";
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
  for (const capability of BUILTIN_CAPABILITIES) {
    registry.register(capability.descriptor);
    capabilityExecutor.register(capability);
  }

  const queue = new RedisTaskQueue(redis);

  const goals = new DrizzleGoalRepository(db);
  const executionRepository = new DrizzleExecutionRepository(db);

  const engine = new ExecutionEngine({
    goals,
    executions: executionRepository,
    tasks: new DrizzleTaskRepository(db),
    queue,
    intentAnalyzer: new KeywordIntentAnalyzer(),
    planner: new TemplatePlanner(registry),
    capabilities: registry,
    capabilityExecutor,
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

  logger.info({ capabilities: registry.list().length }, "runtime starting");
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
