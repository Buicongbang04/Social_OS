/**
 * @repo/secrets — envelope encryption for secrets at rest.
 *
 * See docs/platform/12_SECRET_MANAGER.md. Pure and I/O-free on purpose: the
 * storage lives in @repo/database, so the part where a mistake is expensive can
 * be tested exhaustively without a database.
 */
export * from "./cipher";
