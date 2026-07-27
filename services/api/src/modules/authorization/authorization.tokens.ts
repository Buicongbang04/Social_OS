/**
 * Injection tokens live in their own file so the module and the services it
 * provides can both import them without forming an import cycle.
 */
export const PERMISSION_EVALUATOR = Symbol("PERMISSION_EVALUATOR");
