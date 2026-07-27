// @ts-check
// Backend layer (NestJS services — services/api, services/runtime, services/worker, ...)
import tseslint from "typescript-eslint";
import { baseConfig } from "./base.js";

export const nestjsConfig = tseslint.config(...baseConfig, {
  rules: {
    // NestJS relies on decorators + DI, so empty constructors and
    // parameter-property classes are idiomatic, not dead code.
    "@typescript-eslint/no-useless-constructor": "off",
    "@typescript-eslint/no-extraneous-class": "off",

    // MUST stay off for NestJS. Dependency injection resolves constructor
    // parameter types at runtime from `emitDecoratorMetadata`, and a
    // `import type` declaration is erased before that metadata is written —
    // so "fixing" these imports silently breaks DI at boot. The failure is a
    // runtime "Nest can't resolve dependencies", far worse than inconsistent
    // import style.
    "@typescript-eslint/consistent-type-imports": "off",
  },
});

export default nestjsConfig;
