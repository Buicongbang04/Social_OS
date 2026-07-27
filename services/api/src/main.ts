import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { createLogger } from "@repo/logger";
import { AppModule } from "./app.module";
import { AppConfig } from "./config/app.config";

const logger = createLogger("api");

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(AppConfig);

  // URL versioning per docs/api/10_API_VERSIONING.md. /health stays unprefixed
  // so probes do not have to track the API version.
  app.setGlobalPrefix(config.apiPrefix, { exclude: ["health"] });

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
