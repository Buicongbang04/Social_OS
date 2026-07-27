import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.int-spec.ts"],
    // Integration specs share one database; running them in parallel would
    // make them fight over the same rows.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
