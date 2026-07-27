import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.int-spec.ts"],
    // One shared Redis — parallel files would collide on the same keys.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
