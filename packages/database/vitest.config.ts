import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Unit tests stay Docker-free so `pnpm test` runs anywhere.
    // Integration specs (*.int-spec.ts) need Postgres and run via `test:int`.
    include: ["src/**/*.spec.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "src/**/*.int-spec.ts"],
  },
});
