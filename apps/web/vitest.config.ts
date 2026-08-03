import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    // A DOM, because what is being tested is what somebody sees and clicks.
    // These components hold the only logic that has no other home: which
    // button appears for which status, what a brief is built from, whether a
    // picker is offered at all.
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/testing/setup.ts"],
    include: ["src/**/*.spec.tsx", "src/**/*.spec.ts"],
  },
});
