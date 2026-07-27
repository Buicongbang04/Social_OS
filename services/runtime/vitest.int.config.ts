import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.int-spec.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
