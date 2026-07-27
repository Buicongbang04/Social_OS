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
  },
});

export default nestjsConfig;
