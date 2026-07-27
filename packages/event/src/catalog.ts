/**
 * Runtime event catalog, per docs/kernel/11_EVENT_BUS.md.
 *
 * Names are bare PascalCase as the docs specify — not dotted — so they can be
 * matched literally against the doc when tracing a flow.
 *
 * NOTE ON DOC INCONSISTENCIES: the docs use both `TaskRetry`/`TaskRetried` and
 * `ApprovalRequired`/`ApprovalRequested` for the same events. We take the past
 * tense in each case, matching the majority of names here (`TaskCompleted`,
 * `WorkerRegistered`) which report something that already happened.
 */
export const EXECUTION_EVENTS = [
  "ExecutionCreated",
  "ExecutionStarted",
  "ExecutionPaused",
  "ExecutionResumed",
  "ExecutionCompleted",
  "ExecutionFailed",
  "ExecutionCancelled",
  "ExecutionRetried",
  "ExecutionTimeout",
] as const;

export const TASK_EVENTS = [
  "TaskQueued",
  "TaskDispatched",
  "TaskStarted",
  "TaskCompleted",
  "TaskFailed",
  "TaskRetried",
  "TaskRetryScheduled",
  "TaskTimeout",
  "TaskCancelled",
  "TaskReserved",
  "TaskReleased",
] as const;

export const PLANNING_EVENTS = [
  "IntentResolved",
  "IntentResolutionFailed",
  "PlanningCompleted",
  "PlanningFailed",
  "CapabilityNotFound",
] as const;

export const POLICY_EVENTS = [
  "PolicyEvaluated",
  "PolicyApproved",
  "PolicyDenied",
  "ApprovalRequested",
  "PermissionDenied",
  "BudgetExceeded",
] as const;

export const QUEUE_EVENTS = ["QueueOverflow", "DeadLetterCreated"] as const;

export const RUNTIME_EVENT_TYPES = [
  ...EXECUTION_EVENTS,
  ...TASK_EVENTS,
  ...PLANNING_EVENTS,
  ...POLICY_EVENTS,
  ...QUEUE_EVENTS,
] as const;

export type RuntimeEventType = (typeof RUNTIME_EVENT_TYPES)[number];

const KNOWN_EVENTS = new Set<string>(RUNTIME_EVENT_TYPES);

export function isRuntimeEventType(value: string): value is RuntimeEventType {
  return KNOWN_EVENTS.has(value);
}
