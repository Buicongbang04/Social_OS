import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.int-spec.ts"],
    // One shared Qdrant instance — parallel files would race on collections.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
