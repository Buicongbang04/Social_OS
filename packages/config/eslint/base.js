// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";

/**
 * Base ESLint flat config shared by every package/app/service.
 * Naming/style rules follow docs/development/02_CODING_STANDARDS.md.
 */
export const baseConfig = tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    ignores: ["dist/**", "build/**", ".next/**", ".turbo/**", "coverage/**", "node_modules/**"],
  },
  {
    rules: {
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "no-empty": ["error", { allowEmptyCatch: false }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
);

export default baseConfig;
