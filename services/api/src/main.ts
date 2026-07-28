import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { createLogger } from "@repo/logger";
import { SwaggerModule } from "@nestjs/swagger";
import { buildOpenApiDocument } from "./common/openapi/document";
import { AppModule } from "./app.module";
import { AppConfig } from "./config/app.config";

const logger = createLogger("api");

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(AppConfig);

  // URL versioning per docs/api/10_API_VERSIONING.md. /health stays unprefixed
  // so probes do not have to track the API version.
  // Both sit outside the versioned API on purpose: a load balancer and a
  // metrics scraper are configured once and must not move when the API is.
  app.setGlobalPrefix(config.apiPrefix, { exclude: ["health", "metrics"] });

  // Served in development only. The document describes every route and every
  // body the platform accepts, which is a map worth having and not one to hand
  // out — and an installation that has not thought about it should not be
  // publishing one.
  if (process.env.NODE_ENV !== "production") {
    SwaggerModule.setup("docs", app, buildOpenApiDocument(app), {
      jsonDocumentUrl: "docs/json",
    });
  }

  // An explicit allowlist, never `*`. The browser sends the access token in an
  // Authorization header, so a wildcard origin would let any site on the
  // internet make authenticated calls on a signed-in user's behalf.
  app.enableCors({
    origin: config.corsOrigins,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    // `x-workspace-id` is a custom header, so it is not simple and the browser
    // will fail the preflight unless it is named here. Omitting it breaks
    // every workspace-scoped call while leaving login working — a confusing
    // half-broken state.
    allowedHeaders: ["content-type", "authorization", "x-workspace-id"],
    maxAge: 600,
  });

  app.enableShutdownHooks();

  await app.listen(config.port);

  logger.info(
    { port: config.port, prefix: config.apiPrefix, env: config.nodeEnv },
    "api listening",
  );
}

bootstrap().catch((error: unknown) => {
  logger.error({ err: error }, "failed to start api");
  process.exitCode = 1;
});
