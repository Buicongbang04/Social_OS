/**
 * The Provider Gateway built from the environment, or nothing.
 *
 * Null when no AI provider is configured, and the API still boots. Login,
 * workspaces, goals and documents do not need a model, and refusing to start
 * without a paid credential would make most of the platform unreachable to
 * anyone who has not bought one. The chat endpoint checks and says so.
 *
 * Kept in its own file, away from the module that provides it. A token declared
 * next to its module and injected by something that module imports is a
 * circular import: by the time the injecting class's decorators run the token is
 * still undefined, `@Inject(undefined)` silently falls back to the reflected
 * parameter type, and Nest fails to resolve a dependency that looks correct in
 * the source.
 */
export const AI_GATEWAY = Symbol("AI_GATEWAY");
