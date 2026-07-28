import type { ConversationId, UserId, WorkspaceId } from "@repo/core";
import type {
  AppendMessageInput,
  Conversation,
  CreateConversationInput,
  Message,
} from "../entities/conversation.entity";

/**
 * Chat threads and their messages.
 *
 * Every method takes a workspaceId alongside the conversation's own id, for the
 * same reason the document repository does: a lookup by id alone hands another
 * tenant's conversation to anyone who learns or guesses one, and the read looks
 * entirely legitimate in every log.
 */
export interface ConversationRepository {
  create(
    input: CreateConversationInput,
    actorId: UserId | null,
  ): Promise<Conversation>;

  findById(
    workspaceId: WorkspaceId,
    id: ConversationId,
  ): Promise<Conversation | null>;

  /** Most recently active first. */
  list(workspaceId: WorkspaceId, limit?: number): Promise<Conversation[]>;

  /**
   * The thread, oldest first.
   *
   * Oldest first because that is the order a model has to read it in, and
   * reversing a page in the caller means the caller decides how much history
   * there is — which is the one thing the context window cares about.
   */
  listMessages(
    workspaceId: WorkspaceId,
    id: ConversationId,
    limit?: number,
  ): Promise<Message[]>;

  /**
   * Record one turn and move the conversation's clock forward.
   *
   * One operation rather than two, because a message whose conversation still
   * says it has none is a thread that sorts to the bottom of the list and looks
   * empty until something else happens to touch it.
   */
  appendMessage(input: AppendMessageInput): Promise<Message>;

  /**
   * Fold the turns that have fallen out of the window into the summary.
   *
   * `expectedSummarisedCount` is a compare-and-swap: two turns arriving
   * together would otherwise both summarise from the same starting point and
   * the second would overwrite the first, losing everything the first had
   * folded in. The loser gets null and skips — the work is already done.
   */
  updateSummary(
    workspaceId: WorkspaceId,
    id: ConversationId,
    summary: string,
    summarisedCount: number,
    expectedSummarisedCount: number,
  ): Promise<Conversation | null>;

  /** Rename a thread. Returns null when there is no such conversation here. */
  rename(
    workspaceId: WorkspaceId,
    id: ConversationId,
    title: string,
    actorId: UserId | null,
  ): Promise<Conversation | null>;

  softDelete(
    workspaceId: WorkspaceId,
    id: ConversationId,
    actorId: UserId | null,
  ): Promise<boolean>;
}
