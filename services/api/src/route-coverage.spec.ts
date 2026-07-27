import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every HTTP handler must make a deliberate authorization choice.
 *
 * PermissionGuard already fails closed at runtime, but that only surfaces when
 * someone happens to call the endpoint. This test surfaces it at commit time:
 * a new route with no `@Public()`, `@AuthenticatedOnly()` or
 * `@RequirePermission()` fails the build instead of shipping and then 403-ing
 * in production.
 *
 * Enforces "Không bỏ qua Authorization đối với Internal API"
 * (docs/platform/08_PERMISSION_MODEL.md).
 */
const SRC = __dirname;
const HTTP_METHODS = [
  "Get",
  "Post",
  "Put",
  "Patch",
  "Delete",
  "Head",
  "Options",
  "All",
];
const POLICY_DECORATORS = [
  "@Public()",
  "@AuthenticatedOnly()",
  "@RequirePermission(",
];

function collectControllers(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return collectControllers(path);
    return path.endsWith(".controller.ts") ? [path] : [];
  });
}

type Handler = {
  file: string;
  method: string;
  policies: string[];
};

/**
 * Walks each controller and, for every `@Get(...)`-style decorator, scans the
 * decorator block immediately above it for a policy decorator.
 */
function extractHandlers(file: string): Handler[] {
  const lines = readFileSync(file, "utf8").split("\n");
  const handlers: Handler[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim() ?? "";
    const httpMethod = HTTP_METHODS.find((verb) =>
      line.startsWith(`@${verb}(`),
    );
    if (!httpMethod) continue;

    // Walk upward across the contiguous decorator block.
    const policies: string[] = [];
    for (let j = i - 1; j >= 0; j--) {
      const above = lines[j]?.trim() ?? "";
      if (
        above === "" ||
        above.startsWith("//") ||
        above.startsWith("*") ||
        above.startsWith("/*")
      ) {
        continue;
      }
      if (!above.startsWith("@")) break;

      for (const policy of POLICY_DECORATORS) {
        if (above.startsWith(policy)) policies.push(policy);
      }
    }

    handlers.push({
      file: file.replace(SRC, "src"),
      method: `${httpMethod} (line ${i + 1})`,
      policies,
    });
  }

  return handlers;
}

describe("route authorization coverage", () => {
  const handlers = collectControllers(SRC).flatMap(extractHandlers);

  it("finds the controllers to check", () => {
    // Guards against the walker silently matching nothing and passing vacuously.
    expect(handlers.length).toBeGreaterThan(10);
  });

  it("every route declares exactly one authorization policy", () => {
    const violations = handlers
      .filter((handler) => handler.policies.length !== 1)
      .map(
        (handler) =>
          `${handler.file} ${handler.method}: ${
            handler.policies.length === 0
              ? "no policy decorator"
              : `conflicting policies ${handler.policies.join(" + ")}`
          }`,
      );

    expect(violations).toEqual([]);
  });
});
