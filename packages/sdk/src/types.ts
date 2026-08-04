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

/** A tool the assistant ran, and what it got back. */
export type ToolRun = {
  name: string;
  input: unknown;
  result: unknown;
};

export type ChatStreamEvent =
  | { type: "delta"; text: string }
  /** The assistant ran a tool. Read-only today — see chat-tools.ts. */
  | { type: "tool"; run: ToolRun }
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
/**
 * A stored credential, as the client is allowed to see it.
 *
 * Note the absence: no `value`. The server has no route that returns one — a
 * credential is written in and used from inside — so there is nothing here to
 * hold it. `hint` is the last four characters, enough to tell two keys apart.
 */
export type StoredSecret = {
  id: string;
  name: string;
  description: string | null;
  hint: string;
  activeVersion: number;
  updatedAt: string;
};

/**
 * A social platform account the workspace has connected.
 *
 * As with `StoredSecret`, note the absence: no token. The server keeps those
 * sealed in the vault and hands out only a reference, so nothing that
 * serialises a connection can carry a live credential for someone's audience.
 */
/**
 * A Page a user token can manage.
 *
 * No token in it, and never will be: the browser names which Pages to connect,
 * and the server re-reads their tokens itself.
 */
export type ManageablePage = {
  externalId: string;
  displayName: string;
  alreadyConnected: boolean;
};

export type SocialConnection = {
  id: string;
  connectorId: string;
  externalId: string;
  displayName: string;
  avatarUrl: string | null;
  /** What the platform granted, which can be less than what was asked for. */
  scopes: string[];
  status: "ACTIVE" | "EXPIRED" | "REVOKED";
  expiresAt: string | null;
  connectedAt: string;
};

/**
 * What a workspace has spent on AI over a period.
 *
 * `unpricedCalls` is not decoration. A model with no price in the table
 * contributes nothing to the total, so a figure shown without that count is
 * quietly understated and the reader has no way to know by how much.
 */
export type SpendSummary = {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: string;
  unpricedCalls: number;
};

export type SpendReport = {
  from: string;
  to: string;
  total: SpendSummary;
  /** Dearest first, so the line that matters is not buried in an alphabet. */
  byModel: (SpendSummary & { provider: string; model: string })[];
};

/** One day's AI requests, as counted on the clock in `timeZone`. */
export type DashboardDay = { day: string; calls: number; costUsd: string };

/** What the overview page reads: one call, one moment, one screen. */
export type DashboardReport = {
  from: string;
  to: string;
  timeZone: string;
  /** Every day in the window, including the ones with nothing on them. */
  requestsByDay: DashboardDay[];
  spend: {
    calls: number;
    costUsd: string;
    /** Calls whose model had no price, so `costUsd` is short by their cost. */
    unpricedCalls: number;
    todayUsd: string;
    todayCalls: number;
  };
  queue: {
    unfinished: number;
    awaitingApproval: number;
    running: number;
    failed: number;
  };
  content: {
    drafts: number;
    approved: number;
    publishing: number;
    published: number;
    failed: number;
  };
};

/**
 * What a competitor's page says.
 *
 * `gaps` is what the page does **not** cover — usually the most useful field,
 * and the one a model is most tempted to invent, so the prompt names the kinds
 * of thing to look for rather than asking for weaknesses in general.
 */
/** One fact proposed from a website, not yet remembered. */
export type BrandFact = { key: string; value: string };

export type CompetitorAnalysis = {
  positioning: string;
  audience: string;
  offers: string[];
  topics: string[];
  tone: string;
  gaps: string[];
};

/** The page itself, as it was read. */
export type CrawledPage = {
  url: string;
  title: string | null;
  description: string | null;
  headings: string[];
  text: string;
};

export const TREND_SOURCES = ["google", "youtube"] as const;
export type TrendSourceName = (typeof TREND_SOURCES)[number];

/**
 * One thing people are looking at right now.
 *
 * `volume` is a string because Google publishes a band — "200+", "20K+" — not
 * a number, and YouTube publishes a real view count. Keeping both as text is
 * what stops a screen adding a search volume to a view count.
 */
export type TrendItem = {
  source: TrendSourceName;
  title: string;
  volume: string | null;
  url: string | null;
  at: string | null;
  context: string | null;
};

/**
 * One row of the campaign report.
 *
 * `postsWithoutStats` is carried rather than folded away: engagement is read
 * from a window of recent posts, so an older one contributes nothing to the
 * totals — a number shown without this count is quietly understated.
 */
export type CampaignReportRow = {
  campaignId: string | null;
  name: string;
  status: CampaignStatus | null;
  drafts: number;
  approved: number;
  published: number;
  failed: number;
  likes: number;
  comments: number;
  shares: number;
  postsWithoutStats: number;
};

export const CAMPAIGN_STATUSES = ["DRAFT", "ACTIVE", "DONE"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const CONTENT_PIECE_STATUSES = [
  "DRAFT",
  "APPROVED",
  "PUBLISHING",
  "PUBLISHED",
  "FAILED",
] as const;
export type ContentPieceStatus = (typeof CONTENT_PIECE_STATUSES)[number];

export type Campaign = {
  id: string;
  name: string;
  objective: string | null;
  status: CampaignStatus;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
};

/**
 * One piece of content.
 *
 * `scheduledAt` is an absolute instant. The screen turns it into a local time
 * to show, and back into an instant to send — the server never sees a
 * wall-clock time without a zone attached to it.
 */
export type ContentPiece = {
  id: string;
  campaignId: string | null;
  /** Which connected account it goes to; null means the only one on its channel. */
  socialAccountId: string | null;
  title: string;
  body: string;
  hashtags: string[];
  channel: string;
  scheduledAt: string | null;
  /** Storage key of the banner rendered for this piece, if any. */
  imageKey: string | null;
  status: ContentPieceStatus;
  publishedPostId: string | null;
  publishedAt: string | null;
  lastError: string | null;
};

export const CONTENT_CHANNELS = [
  "facebook",
  "tiktok",
  "threads",
  "blog",
  "email",
] as const;
export type ContentChannel = (typeof CONTENT_CHANNELS)[number];

export const CONTENT_TONES = [
  "than-thien",
  "chuyen-nghiep",
  "hai-huoc",
  "khan-truong",
  "gan-gui",
] as const;
export type ContentTone = (typeof CONTENT_TONES)[number];

export const CONTENT_LENGTHS = ["ngan", "vua", "dai"] as const;
export type ContentLength = (typeof CONTENT_LENGTHS)[number];

/** What every studio operation reports alongside its own payload. */
export type ContentMeta = {
  provider: string;
  model: string;
  promptVersion: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  costUsd: string;
};

export type WrittenContent = ContentMeta & {
  object: { title: string; body: string; hashtags: string[] };
};

/**
 * A rewrite or a translation.
 *
 * `notes` is where the instruction could not be followed without changing a
 * fact — shown rather than dropped, because a rewrite that quietly loses a
 * delivery time is worse than one that says it could not keep it.
 */
export type RevisedContent = ContentMeta & {
  object: { body: string; notes: string[] };
};

export type SeoContent = ContentMeta & {
  object: { titles: string[]; metaDescription: string; keywords: string[] };
};

/**
 * One waiting conversation, as the inbox shows it.
 *
 * `lastMessage` is a trimmed snippet, not the whole thing. A customer's full
 * message belongs where they wrote it, not in every log and context window it
 * would otherwise pass through.
 */
/**
 * One comment waiting under a post.
 *
 * Carries the post it sits under, because a question without it is
 * unanswerable — "còn hàng không" needs the post to say what the thing is.
 */
export type PageComment = {
  id: string;
  account: string;
  accountId: string;
  author: string;
  message: string;
  createdAt: string;
  postId: string;
  postExcerpt: string | null;
};

export type Comments = {
  comments: PageComment[];
  failed: { account: string; reason: string }[];
};

export type InboxThread = {
  id: string;
  account: string;
  accountId: string;
  participant: string;
  updatedAt: string;
  lastMessage: string | null;
  unread: boolean;
};

/**
 * How one post has done.
 *
 * Engagement counts, not reach. Meta removed the impressions metrics in June
 * 2026 and withholds the replacements below a follower threshold, so reading
 * them could not be checked against a real answer — and a number that is
 * quietly always zero looks exactly like a post nobody saw.
 */
export type PostStats = {
  postId: string;
  account: string;
  createdAt: string;
  message: string | null;
  likes: number;
  comments: number;
  shares: number;
  url: string;
};

export type PostStatsReport = {
  posts: PostStats[];
  failed: { account: string; reason: string }[];
};

/**
 * The inbox, plus the channels that could not be read.
 *
 * Reported rather than thrown: one expired token must not hide the messages
 * sitting in the other channels.
 */
export type Inbox = {
  threads: InboxThread[];
  failed: { account: string; reason: string }[];
};

/** A platform on offer, and whether the operator has registered an app for it. */
export type ConnectorSummary = {
  id: string;
  name: string;
  scopes: string[];
  configured: boolean;
};

/** Whose credential this workspace's AI requests are spending. */
export type ProviderKeyStatus = {
  source: "workspace" | "platform";
  providers: string[];
};

export type WorkspaceMemory = {
  id: string;
  workspaceId: string;
  key: string;
  value: string;
  source: "MANUAL" | "LEARNED";
  updatedAt: string;
};
