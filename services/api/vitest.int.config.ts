import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // vitest transforms with esbuild by default, and esbuild does not implement
  // `emitDecoratorMetadata` — so NestJS loses `design:paramtypes` and every
  // constructor dependency arrives as undefined. SWC does implement it, which
  // is what makes booting the real AppModule under test possible.
  plugins: [swc.vite({ module: { type: "es6" } })],
  test: {
    include: ["src/**/*.int-spec.ts"],
    // One shared database — parallel files would fight over the same rows.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
