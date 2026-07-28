import type {
  ConversationId,
  MessageId,
  Metadata,
  SoftDeletableEntity,
  UserId,
  WorkspaceId,
} from "@repo/core";

export const MESSAGE_ROLES = ["user", "assistant", "system"] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];

/**
 * One chat thread.
 *
 * Short-term memory in the taxonomy of docs/ai/06_AGENT_MEMORY.md: it holds
 * what was said in one session. What outlives it — preferences, learned facts —
 * is a different store and a later piece of work.
 */
export type Conversation = SoftDeletableEntity<ConversationId> & {
  workspaceId: WorkspaceId;
  /** Null when the runtime started the thread rather than a person. */
  createdByUser: UserId | null;
  title: string;
  /**
   * When the last message landed.
   *
   * Stored rather than derived so listing threads by recency is an indexed
   * sort instead of a join and an aggregate over every message.
   */
  lastMessageAt: Date | null;
  messageCount: number;
  metadata: Metadata;
};

/**
 * One turn.
 *
 * Insert-only, for the same reason `execution_events` and `ai_usage` are: this
 * is the record of what was actually said, and a transcript that can be edited
 * after the fact is not a transcript. A correction is a new message.
 */
export type Message = {
  id: MessageId;
  conversationId: ConversationId;
  workspaceId: WorkspaceId;
  role: MessageRole;
  content: string;
  /** Null on a user or system message — nothing generated them. */
  provider: string | null;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  /** Money as a decimal string, never a float. See ai_usage for why. */
  costUsd: string;
  finishReason: string | null;
  /**
   * True when the stream died partway and this is what had arrived.
   *
   * Recorded rather than dropped: the reader already saw this text, and the
   * vendor already billed for it. A transcript that silently omits it disagrees
   * with both the screen and the invoice.
   */
  truncated: boolean;
  metadata: Metadata;
  createdAt: Date;
};

export type CreateConversationInput = {
  workspaceId: WorkspaceId;
  createdByUser?: UserId | null;
  title?: string;
  metadata?: Metadata;
};

export type AppendMessageInput = {
  conversationId: ConversationId;
  workspaceId: WorkspaceId;
  role: MessageRole;
  content: string;
  provider?: string | null;
  model?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: string;
  finishReason?: string | null;
  truncated?: boolean;
  metadata?: Metadata;
};
