import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regression guard.
 *
 * `@typescript-eslint/consistent-type-imports` once autofixed NestJS
 * constructor dependencies to `import type`, which erases the declaration
 * before `emitDecoratorMetadata` writes `design:paramtypes` — the app then
 * failed at boot with "Nest can't resolve dependencies of X". Linting is
 * configured to leave these alone (see the repo-root eslint.config.js and
 * packages/config/eslint/nestjs.js); this test fails loudly if that
 * protection is ever removed, because the symptom is a runtime crash rather
 * than a compile error.
 */
const SRC = join(__dirname);

/** Classes that appear as constructor parameter types and must stay value imports. */
const INJECTABLE_CLASSES = [
  "AppConfig",
  "AuthService",
  "TokenService",
  "JwtService",
  "ConfigService",
  "Reflector",
  "ModuleRef",
  "PasswordService",
  "RefreshTokenService",
  "PermissionService",
  "WorkspacesService",
  "OrganizationsService",
];

function collectTypeScriptFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return collectTypeScriptFiles(path);
    return path.endsWith(".ts") && !path.endsWith(".spec.ts") ? [path] : [];
  });
}

describe("NestJS dependency injection metadata", () => {
  it("never imports an injectable class with `import type`", () => {
    const offenders: string[] = [];

    for (const file of collectTypeScriptFiles(SRC)) {
      const source = readFileSync(file, "utf8");

      for (const className of INJECTABLE_CLASSES) {
        // Matches `import type { Foo }` and `import type Foo from`.
        const typeImport = new RegExp(
          `import\\s+type\\s+(\\{[^}]*\\b${className}\\b[^}]*\\}|${className})\\s+from`,
        );

        if (typeImport.test(source)) {
          offenders.push(
            `${file.replace(SRC, "src")} imports ${className} as a type`,
          );
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
