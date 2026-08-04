import Redis from "ioredis";
import { InMemoryEventBus } from "@repo/event";
import { createLogger } from "@repo/logger";
import {
  DrizzleAiUsageRepository,
  DrizzleSecretRepository,
  DrizzleContentPieceRepository,
  DrizzleSocialAccountRepository,
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
import { Metrics, withMetrics } from "@repo/observability";
import { Keyring } from "@repo/secrets";
import { buildAiEngines } from "./ai-engines";
import { buildSocialInbox, buildSocialPublish } from "./capabilities/social";
import { buildKnowledgeStack } from "./knowledge";
import { BUILTIN_CAPABILITIES } from "./capabilities/builtin";
import { startMetricsServer } from "./metrics-server";
import { EmailNotifier, mailerConfigFromEnv } from "@repo/notify";
import { ContentPublisher } from "./content-publisher";
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

  const metrics = new Metrics();
  const usage = new DrizzleAiUsageRepository(db);
  // Wrapped only where it is used as a recorder. The budget policy reads the
  // same repository for spend, and a decorator that narrowed it to `record`
  // would take that away — metrics must not cost the platform a feature.
  const meteredUsage = withMetrics(usage, metrics);

  const ai = buildAiEngines({
    capabilities: registry,
    recorder: meteredUsage,
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

  /**
   * Publishing for real, and only when the operator has said so.
   *
   * Opt-in rather than automatic, because switching it on changes what every
   * existing Goal already in the system does the next time it runs — including
   * scheduled ones nobody is watching. A capability that starts reaching real
   * audiences as a side effect of a deploy is not a change anyone consented to.
   *
   * When it is off, the rehearsal in `builtin.ts` runs instead and says plainly
   * that it published nothing.
   */
  const keyring = Keyring.fromEnv();
  const publishLive = process.env.SOCIAL_PUBLISH_LIVE?.trim() === "true";
  /**
   * Reading the inbox needs only the vault, not the publish switch.
   *
   * Deliberately separate: reading messages a customer already sent to a Page
   * changes nothing in the world, while publishing does. Gating them together
   * would mean turning on the dangerous one to get the harmless one.
   */
  const inbox = keyring
    ? buildSocialInbox({
        accounts: new DrizzleSocialAccountRepository(db),
        secrets: new DrizzleSecretRepository(db),
        keyring,
      })
    : null;

  const social =
    publishLive && keyring
      ? buildSocialPublish({
          accounts: new DrizzleSocialAccountRepository(db),
          secrets: new DrizzleSecretRepository(db),
          keyring,
          // A second, narrower switch. "Publish for real" and "publish for real
          // with nobody watching" are different decisions, and collapsing them
          // is how a scheduled Goal posts to a real audience at 3am.
          allowUnattended:
            process.env.SOCIAL_PUBLISH_UNATTENDED?.trim() === "true",
          metrics,
        })
      : null;

  /**
   * The calendar's own publisher.
   *
   * Behind SOCIAL_PUBLISH_LIVE like everything that reaches an audience, but
   * deliberately NOT behind SOCIAL_PUBLISH_UNATTENDED. That switch exists
   * because a scheduled Goal publishes something nobody read; here a person
   * wrote the text, chose the time and approved that exact post. Gating it
   * would make the Duyệt button do nothing and say nothing.
   */
  /**
   * Where failures are reported, if anywhere.
   *
   * Built once at startup so a misconfiguration is a startup error rather than
   * something discovered at eight in the morning when the first post fails and
   * the alert about it also fails.
   */
  const mailer = mailerConfigFromEnv();
  const notifier = mailer ? new EmailNotifier(mailer) : null;

  if (notifier) {
    // Checked now, not at eight in the morning. An alert that cannot be
    // delivered fails at exactly the moment it is needed, and nobody hears
    // about that failure either.
    //
    // Not awaited: a mail server that hangs must not hold up the runtime, and
    // publishing without alerts beats not publishing at all.
    void notifier.check().then((result) => {
      if (result.ok) {
        logger.info(
          { to: mailer!.to.length },
          "email alerts on: sẽ báo khi có bài không đăng được",
        );
      } else {
        logger.error(
          { reason: result.reason },
          "email alerts đã cấu hình nhưng KHÔNG gửi được — bài hỏng sẽ không có ai được báo",
        );
      }
    });
  }

  const contentPublisher =
    publishLive && keyring
      ? new ContentPublisher({
          accounts: new DrizzleSocialAccountRepository(db),
          secrets: new DrizzleSecretRepository(db),
          keyring,
          pieces: new DrizzleContentPieceRepository(db),
          // Shares the knowledge module's store, which is already built from
          // the same MINIO_* configuration. Null when storage is not set up,
          // and then a scheduled post goes out as words.
          store: knowledge?.store ?? null,
          notifier,
          ...(process.env.APP_URL?.trim()
            ? { appUrl: process.env.APP_URL.trim() }
            : {}),
          metrics,
        })
      : null;

  if (publishLive && !keyring) {
    // Said out loud rather than silently falling back. An operator who set the
    // flag believes posts are going out, and the gap between that belief and a
    // rehearsal is exactly where a campaign disappears.
    logger.error(
      "SOCIAL_PUBLISH_LIVE=true nhưng chưa có SECRET_KEYS — không mở được credential, nên vẫn chỉ chạy thử.",
    );
  }

  logger.info(
    {
      live: Boolean(social),
      unattended: process.env.SOCIAL_PUBLISH_UNATTENDED?.trim() === "true",
    },
    social
      ? "social.publish sẽ đăng thật"
      : "social.publish chỉ chạy thử, không gửi đi đâu",
  );

  // The AI implementations win, and the deterministic builtins fill the rest.
  // Filtered rather than registered over the top, because the registry
  // deliberately refuses a duplicate id — a plugin must not be able to shadow
  // a core capability by registering later. Choosing here keeps that guard
  // intact and makes the substitution visible.
  const provided = [
    ...ai.capabilities,
    ...(knowledge?.capabilities ?? []),
    ...(social ? [social] : []),
    ...(inbox ? [inbox] : []),
  ];
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

  const metricsServer = startMetricsServer(metrics);
  logger.info(
    { scraping: Boolean(metricsServer) },
    metricsServer
      ? `metrics ở :${process.env.RUNTIME_METRICS_PORT ?? 3101}/metrics`
      : "metrics tắt — chưa đặt METRICS_TOKEN",
  );

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
    contentPublisher?.stop();
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
  // Both loops run for the life of the process; whichever settles first is a
  // failure, and awaiting the race surfaces it instead of leaving one dead.
  await Promise.race(
    [scheduler.start(), contentPublisher?.start()].filter(Boolean),
  );
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
