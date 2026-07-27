// @ts-check
// Root ESLint config — lets `eslint` run from the repo root (used by lint-staged
// pre-commit). Each package/app also has its own eslint.config.js used by
// `pnpm lint` via Turborepo; both derive from @repo/config.
import tseslint from "typescript-eslint";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import next from "@next/eslint-plugin-next";
import { baseConfig } from "@repo/config/eslint/base";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/node_modules/**",
      "**/next-env.d.ts",
    ],
  },
  ...baseConfig,
  {
    // NestJS services. `consistent-type-imports` MUST stay off here: NestJS
    // resolves constructor parameter types at runtime from
    // emitDecoratorMetadata, and an `import type` declaration is erased before
    // that metadata is written — so autofixing these imports breaks dependency
    // injection at boot ("Nest can't resolve dependencies of X"). This block
    // exists because lint-staged runs eslint from the repo root, where the
    // per-package config in services/*/eslint.config.js does not apply.
    files: ["services/**/*.ts"],
    rules: {
      "@typescript-eslint/consistent-type-imports": "off",
    },
  },
  {
    // React surfaces only: frontend apps and the shared UI package.
    files: ["apps/**/*.{ts,tsx}", "packages/ui/**/*.{ts,tsx}"],
    plugins: {
      react,
      "react-hooks": reactHooks,
      "@next/next": next,
    },
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: {
      react: { version: "detect" },
    },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      ...next.configs.recommended.rules,
      ...next.configs["core-web-vitals"].rules,
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      // Resolved per-app (apps/*/eslint.config.js); the repo root is not a
      // Next.js app, so this rule can't locate a pages/ directory here.
      "@next/next/no-html-link-for-pages": "off",
    },
  },
);
