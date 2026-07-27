/**
 * Render an error as text, without inspecting the object.
 *
 * `console.error(msg, error)` looks harmless and is not: Node formats the whole
 * object graph, and some of what the AI SDK throws carries properties whose
 * descriptors crash `util.inspect` outright. When that happens the process dies
 * inside the error handler and the original failure is never printed — the
 * worst possible outcome for the one code path whose entire job is to explain
 * what went wrong.
 *
 * So: message and stack only, plus the cause chain, each read defensively.
 */
export function formatError(error: unknown, depth = 0): string {
  if (depth > 4) return "…";

  if (!(error instanceof Error)) {
    if (typeof error === "string") return error;
    try {
      // JSON.stringify returns undefined — not a string — for undefined, a
      // function, or a symbol. Returning that would put a literal "undefined"
      // in the log where the reason should be.
      return JSON.stringify(error) ?? String(error);
    } catch {
      return String(error);
    }
  }

  const parts = [`${error.name}: ${error.message}`];

  const status = readNumber(error, "statusCode");
  if (status !== null) parts.push(`(HTTP ${status})`);

  // Vendors put the actionable detail here — a malformed-schema complaint, a
  // quota message — and it is plain text, so it is safe to read.
  const body = readString(error, "responseBody");
  if (body) parts.push(`\n  response: ${body.slice(0, 500)}`);

  const cause = (error as { cause?: unknown }).cause;
  if (cause !== undefined && cause !== null) {
    parts.push(`\n  caused by: ${formatError(cause, depth + 1)}`);
  }

  return parts.join(" ");
}

function readString(error: Error, key: string): string | null {
  const value = (error as unknown as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

function readNumber(error: Error, key: string): number | null {
  const value = (error as unknown as Record<string, unknown>)[key];
  return typeof value === "number" ? value : null;
}
