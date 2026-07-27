/**
 * Wire types for the Runtime API.
 *
 * Declared here rather than imported from @repo/core or @repo/runtime on
 * purpose: those are server types carrying `Date` objects and branded ids,
 * while what actually crosses the wire is JSON — dates are strings and ids are
 * plain strings. Reusing the server types would make the client claim a
 * `Date` where it holds a string, and that lie surfaces as a runtime crash the
 * first time someone calls `.getTime()`.
 */

export type ApiErrorBody = {
  code: string;
  message: string;
  requestId: string;
  timestamp: string;
  details?: { field: string; message: string }[];
};

export type Envelope<T> = {
  data: T;
  meta?: Record<string, unknown>;
  links?: Record<string, string | null>;
};

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: number;
};

export type PublicUser = {
  id: string;
  email: string;
  status: string;
  displayName?: string | null;
};

export type AuthResult = { user: PublicUser; tokens: AuthTokens };

export type Organization = {
  id: string;
  name: string;
  slug: string;
};

export type Workspace = {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
};

export type GoalStatus =
  | "CREATED"
  | "VALIDATED"
  | "SCHEDULED"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "ARCHIVED";

export type Goal = {
  id: string;
  workspaceId: string;
  ownerId: string;
  title: string;
  objective: string;
  description: string | null;
  type: string;
  priority: string;
  constraints: Record<string, unknown>;
  status: GoalStatus;
  schedule: { cron: string; timezone: string } | null;
  createdAt: string;
};

export type CreateGoalInput = {
  title: string;
  objective: string;
  description?: string | null;
  priority?: "CRITICAL" | "HIGH" | "NORMAL" | "LOW" | "BACKGROUND";
  constraints?: {
    language?: string;
    retry?: number;
    approval?: boolean;
    maxCostUsd?: number;
  };
  schedule?: { cron: string; timezone: string } | null;
};

/**
 * Kept as a value, not just a union, so the drift guard in types.spec.ts can
 * actually compare it against the runtime's list. A type-only mirror looks
 * checked and is not: a type-level assertion passes at runtime no matter what.
 */
export const EXECUTION_STATUSES = [
  "CREATED",
  "VALIDATING",
  "PLANNING",
  "READY",
  "SCHEDULED",
  "RUNNING",
  "WAITING",
  "PAUSED",
  "CANCELLING",
  "CANCELLED",
  "FAILED",
  "RETRYING",
  "COMPLETED",
  "ARCHIVED",
] as const;

export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

export type PlannedTask = {
  id: string;
  capability: string;
  dependencies: string[];
  inputs: Record<string, unknown>;
  metadata: Record<string, unknown>;
};

export type ExecutionPlan = {
  id: string;
  tasks: PlannedTask[];
  estimatedDurationMs: number;
  estimatedCostUsd: number;
  metadata: Record<string, unknown>;
};

export type Execution = {
  id: string;
  goalId: string;
  workspaceId: string;
  status: ExecutionStatus;
  plan: ExecutionPlan | null;
  outputs: Record<string, unknown> | null;
  failureReason: string | null;
  correlationId: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
};

export const TASK_STATUSES = [
  "PENDING",
  "READY",
  "RUNNING",
  "WAITING",
  "SUCCESS",
  "FAILED",
  "RETRY",
  "COMPLETED",
  "CANCELLED",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export type Task = {
  id: string;
  executionId: string;
  capability: string;
  status: TaskStatus;
  dependencies: string[];
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown> | null;
  attempt: number;
  lastError: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  metadata: Record<string, unknown>;
};

export type UsageCall = {
  id: string;
  operation: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** A decimal string, not a number — this is money and must not round. */
  costUsd: string;
  costPriced: boolean;
  latencyMs: number;
  timestamp: string;
};

export type ExecutionUsage = {
  calls: UsageCall[];
  totalUsd: string;
  totalTokens: number;
  /** Calls whose model had no price, so totalUsd is short by their cost. */
  unpricedCalls: number;
};

export const DOCUMENT_STATUSES = [
  "PENDING",
  "INDEXING",
  "READY",
  "FAILED",
] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

/**
 * An uploaded file, as the browser sees it.
 *
 * Deliberately without `storageKey`: where the bytes live is the server's
 * business, and a client that knows the key is a client that will eventually
 * try to build one.
 */
export type DocumentSummary = {
  id: string;
  workspaceId: string;
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  status: DocumentStatus;
  failureReason: string | null;
  /** 0 until indexing succeeds. */
  chunkCount: number;
  embeddingModel: string | null;
  indexedAt: string | null;
  createdAt: string;
};

/** True when the same bytes were already uploaded, and nothing new was stored. */
export type UploadedDocument = DocumentSummary & { duplicate: boolean };
