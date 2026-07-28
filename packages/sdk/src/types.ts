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
  /**
   * When this recurring Goal next fires, or null.
   *
   * Null is the only thing that proves a Goal was actually stopped: the status
   * says ARCHIVED, but a Goal caught mid-run keeps its status until that run
   * finishes, and the schedule is cleared either way.
   */
  nextRunAt: string | null;
  lastRunAt: string | null;
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

export type Conversation = {
  id: string;
  workspaceId: string;
  title: string;
  lastMessageAt: string | null;
  messageCount: number;
  /**
   * What the turns that fell out of the context window said, or null.
   *
   * Exposed so a UI can show that a thread has been condensed rather than
   * letting the model appear to forget for no stated reason.
   */
  summary: string | null;
  summarisedCount: number;
  createdAt: string;
};

export type ChatMessage = {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  provider: string | null;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  /** Money as a decimal string, never a float. */
  costUsd: string;
  finishReason: string | null;
  /** The stream died partway and this is what arrived. */
  truncated: boolean;
  createdAt: string;
};

/**
 * What `streamMessage` yields.
 *
 * `error` carries `partial` because the answer can fail after the reader has
 * already seen part of it — dropping that would leave the screen showing text
 * the transcript denies exists.
 */
export type Citation = {
  documentId: string;
  title: string;
  score: number;
  excerpt: string;
};

export type ChatStreamEvent =
  | { type: "delta"; text: string }
  /** What the answer is about to draw on. Arrives before the first token. */
  | { type: "sources"; citations: Citation[] }
  | { type: "done"; message: ChatMessage }
  | { type: "error"; message: string; partial: ChatMessage | null };

/**
 * One durable fact the platform remembers about a workspace.
 *
 * Exposed so it can be shown and edited. Memory that shapes every answer and
 * cannot be inspected is the frightening kind: when it is wrong, the only
 * symptom is that the output has quietly been wrong for a while.
 */
export type WorkspaceMemory = {
  id: string;
  workspaceId: string;
  key: string;
  value: string;
  source: "MANUAL" | "LEARNED";
  updatedAt: string;
};
