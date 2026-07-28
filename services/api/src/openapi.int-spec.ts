import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";
import { AppModule } from "./app.module";
import { buildOpenApiDocument } from "./common/openapi/document";

/**
 * The committed specification must match the code.
 *
 * A document generated on demand and never compared is a document that drifts,
 * and the drift shows up as a consumer following instructions that stopped
 * being true. Committing it turns every change of API surface into a diff
 * somebody reads in review — which is the only reason to have the file.
 *
 * Regenerate with: pnpm --filter @repo/api openapi:write
 */
describe("OpenAPI document", () => {
  it("matches the file checked into the repository", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    const app = moduleRef.createNestApplication();
    app.setGlobalPrefix(process.env.API_PREFIX ?? "api/v1", {
      exclude: ["health", "metrics"],
    });
    await app.init();

    const generated = buildOpenApiDocument(app);
    const committed = JSON.parse(
      readFileSync(join(__dirname, "..", "openapi.json"), "utf8"),
    ) as unknown;

    await app.close();

    expect(generated).toEqual(committed);
  });
});
