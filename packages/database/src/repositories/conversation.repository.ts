import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type {
  ConversationId,
  MessageId,
  Metadata,
  UserId,
  WorkspaceId,
} from "@repo/core";
import { newId } from "@repo/core";
import type {
  AppendMessageInput,
  Conversation,
  ConversationRepository,
  CreateConversationInput,
  Message,
} from "@repo/domain";
import type { DatabaseClient } from "../client";
import { conversations, messages } from "../schema";

type ConversationRow = typeof conversations.$inferSelect;
type MessageRow = typeof messages.$inferSelect;

const DEFAULT_LIST_LIMIT = 50;
/**
 * How many turns one read returns.
 *
 * A thread can outgrow any context window, so something has to bound this. The
 * bound lives here rather than in the caller because a caller that forgets it
 * loads the whole history into memory and then sends most of it to a vendor
 * that will refuse it.
 */
const DEFAULT_MESSAGE_LIMIT = 200;

function toConversation(row: ConversationRow): Conversation {
  return {
    id: row.id as ConversationId,
    workspaceId: row.workspaceId as WorkspaceId,
    createdByUser: row.createdByUser as UserId | null,
    title: row.title,
    lastMessageAt: row.lastMessageAt,
    messageCount: row.messageCount,
    summary: row.summary,
    summarisedCount: row.summarisedCount,
    metadata: row.metadata as Metadata,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    version: row.version,
    deletedAt: row.deletedAt,
    deletedBy: row.deletedBy,
  };
}

function toMessage(row: MessageRow): Message {
  return {
    id: row.id as MessageId,
    conversationId: row.conversationId as ConversationId,
    workspaceId: row.workspaceId as WorkspaceId,
    role: row.role,
    content: row.content,
    provider: row.provider,
    model: row.model,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    costUsd: row.costUsd,
    finishReason: row.finishReason,
    truncated: row.truncated,
    metadata: row.metadata as Metadata,
    createdAt: row.createdAt,
  };
}

export class DrizzleConversationRepository implements ConversationRepository {
  constructor(private readonly db: DatabaseClient) {}

  async create(
    input: CreateConversationInput,
    actorId: UserId | null,
  ): Promise<Conversation> {
    const rows = await this.db
      .insert(conversations)
      .values({
        id: newId("conversation"),
        workspaceId: input.workspaceId,
        createdByUser: input.createdByUser ?? actorId,
        title: (input.title ?? "Hội thoại mới").slice(0, 300),
        metadata: input.metadata ?? {},
        createdBy: actorId,
        updatedBy: actorId,
      })
      .returning();

    const row = rows[0];
    if (!row) throw new Error("Insert returned no conversation row.");
    return toConversation(row);
  }

  async findById(
    workspaceId: WorkspaceId,
    id: ConversationId,
  ): Promise<Conversation | null> {
    const rows = await this.db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.id, id),
          eq(conversations.workspaceId, workspaceId),
          isNull(conversations.deletedAt),
        ),
      )
      .limit(1);

    return rows[0] ? toConversation(rows[0]) : null;
  }

  async list(
    workspaceId: WorkspaceId,
    limit = DEFAULT_LIST_LIMIT,
  ): Promise<Conversation[]> {
    const rows = await this.db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.workspaceId, workspaceId),
          isNull(conversations.deletedAt),
        ),
      )
      // COALESCE, not a second sort key. A thread with no messages has a null
      // lastMessageAt, and Postgres puts NULLs FIRST on a DESC sort — so
      // `desc(lastMessageAt), desc(createdAt)` parks every empty thread above
      // every active one, which is the opposite of "most recently active".
      // Falling back to createdAt says what was actually meant: an empty
      // thread's activity is the moment it was started.
      .orderBy(
        desc(sql`coalesce(${conversations.lastMessageAt}, ${conversations.createdAt})`),
      )
      .limit(Math.min(Math.max(limit, 1), 200));

    return rows.map(toConversation);
  }

  async listMessages(
    workspaceId: WorkspaceId,
    id: ConversationId,
    limit = DEFAULT_MESSAGE_LIMIT,
  ): Promise<Message[]> {
    const rows = await this.db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, id),
          eq(messages.workspaceId, workspaceId),
        ),
      )
      .orderBy(asc(messages.createdAt), asc(messages.id))
      .limit(Math.min(Math.max(limit, 1), 500));

    return rows.map(toMessage);
  }

  /**
   * Append a turn and move the conversation's clock forward.
   *
   * In a transaction because the two halves are one fact. A message whose
   * conversation still says it has none sorts to the bottom of the thread list
   * and looks empty until something else happens to touch it.
   *
   * `messageCount` is incremented in SQL rather than read-then-written: two
   * turns landing together would otherwise both read the same number and the
   * count would drift low for ever.
   */
  async appendMessage(input: AppendMessageInput): Promise<Message> {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .insert(messages)
        .values({
          id: newId("message"),
          conversationId: input.conversationId,
          workspaceId: input.workspaceId,
          role: input.role,
          content: input.content,
          provider: input.provider ?? null,
          model: input.model ?? null,
          inputTokens: input.inputTokens ?? 0,
          outputTokens: input.outputTokens ?? 0,
          costUsd: input.costUsd ?? "0",
          finishReason: input.finishReason ?? null,
          truncated: input.truncated ?? false,
          metadata: input.metadata ?? {},
        })
        .returning();

      const row = rows[0];
      if (!row) throw new Error("Insert returned no message row.");

      await tx
        .update(conversations)
        .set({
          lastMessageAt: row.createdAt,
          messageCount: sql`${conversations.messageCount} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(conversations.id, input.conversationId),
            eq(conversations.workspaceId, input.workspaceId),
          ),
        );

      return toMessage(row);
    });
  }

  /**
   * Fold the overflow into the summary.
   *
   * Compare-and-swap on `summarisedCount` rather than on `version`: version
   * changes on every message too, so using it would make a summary fail
   * whenever a turn happened to land at the same moment — and then never
   * retry, because the next attempt would read the same unchanged summary and
   * race again. The count only moves when a summary lands, which is exactly
   * the collision worth refusing.
   */
  async updateSummary(
    workspaceId: WorkspaceId,
    id: ConversationId,
    summary: string,
    summarisedCount: number,
    expectedSummarisedCount: number,
  ): Promise<Conversation | null> {
    const rows = await this.db
      .update(conversations)
      .set({
        summary,
        summarisedCount,
        updatedAt: new Date(),
        version: sql`${conversations.version} + 1`,
      })
      .where(
        and(
          eq(conversations.id, id),
          eq(conversations.workspaceId, workspaceId),
          eq(conversations.summarisedCount, expectedSummarisedCount),
          isNull(conversations.deletedAt),
        ),
      )
      .returning();

    return rows[0] ? toConversation(rows[0]) : null;
  }

  async rename(
    workspaceId: WorkspaceId,
    id: ConversationId,
    title: string,
    actorId: UserId | null,
  ): Promise<Conversation | null> {
    const rows = await this.db
      .update(conversations)
      .set({
        title: title.slice(0, 300),
        updatedAt: new Date(),
        updatedBy: actorId,
        version: sql`${conversations.version} + 1`,
      })
      .where(
        and(
          eq(conversations.id, id),
          eq(conversations.workspaceId, workspaceId),
          isNull(conversations.deletedAt),
        ),
      )
      .returning();

    return rows[0] ? toConversation(rows[0]) : null;
  }

  async softDelete(
    workspaceId: WorkspaceId,
    id: ConversationId,
    actorId: UserId | null,
  ): Promise<boolean> {
    const rows = await this.db
      .update(conversations)
      .set({
        deletedAt: new Date(),
        deletedBy: actorId,
        updatedAt: new Date(),
        updatedBy: actorId,
        version: sql`${conversations.version} + 1`,
      })
      .where(
        and(
          eq(conversations.id, id),
          eq(conversations.workspaceId, workspaceId),
          isNull(conversations.deletedAt),
        ),
      )
      .returning({ id: conversations.id });

    return rows.length > 0;
  }
}
