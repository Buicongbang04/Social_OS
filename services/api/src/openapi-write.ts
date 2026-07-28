/* eslint-disable no-console -- This file is a CLI: its output IS the result. */
// First, and before anything that reads a decorator. Without it Nest sees no
// `design:paramtypes` and injects undefined into every constructor — which
// surfaces far away, as a property read on nothing.
import "reflect-metadata";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { buildOpenApiDocument } from "./common/openapi/document";

/**
 * Write the specification to disk.
 *
 * A committed artefact so a change to the API surface arrives as a diff in
 * review rather than as a surprise to whoever was using it.
 *
 * Run from the compiled output, not through tsx: tsx does not emit
 * `design:paramtypes`, so Nest injects undefined into every constructor and
 * the failure surfaces far away as a property read on nothing. The integration
 * test config solves the same problem with SWC; here a build is simpler.
 */
async function main(): Promise<void> {
  // `abortOnError: false` so a failure reaches the catch below instead of
  // calling process.exit(1) with the logger silenced — which is a script that
  // fails with no output at all.
  const app = await NestFactory.create(AppModule, {
    logger: ["error"],
    abortOnError: false,
  });
  app.setGlobalPrefix(process.env.API_PREFIX ?? "api/v1", {
    exclude: ["health", "metrics"],
  });
  await app.init();

  const target = join(__dirname, "..", "openapi.json");
  writeFileSync(
    target,
    `${JSON.stringify(buildOpenApiDocument(app), null, 2)}\n`,
  );
  await app.close();

  console.log(`✓ đã ghi ${target}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
