import { Inject, Injectable } from "@nestjs/common";
import {
  ProviderStreamError,
  createDefaultPromptRegistry,
  recordUsageSafely,
  usageRecordFrom,
  type AiUsageRecorder,
  type ProviderGateway,
  type ProviderMessage,
  type ProviderResponse,
} from "@repo/ai";
import {
  NotFoundError,
  ValidationError,
  type ConversationId,
  type UserId,
  type WorkspaceId,
} from "@repo/core";
import type { KnowledgeService } from "@repo/knowledge";
import { WORKSPACE_MEMORY_REPOSITORY } from "../../infra/database/database.module";
import type {
  Conversation,
  ConversationRepository,
  Message,
  WorkspaceMemory,
  WorkspaceMemoryRepository,
} from "@repo/domain";
import { AI_USAGE_REPOSITORY } from "../../infra/database/database.module";
import { CONVERSATION_REPOSITORY } from "../../infra/database/database.module";
import { AI_GATEWAY } from "../../infra/ai/ai.module";
import { KNOWLEDGE_SERVICE } from "../../infra/knowledge/knowledge.module";

/**
 * How many past turns go into the prompt.
 *
 * A thread outgrows any context window eventually, so something has to bound
 * this. Bounded by turns rather than tokens because tokens are only knowable
 * after the vendor has read the prompt, and a limit that can only be checked
 * afterwards is not a limit. The oldest turns are dropped first: a conversation
 * where the model forgets the beginning is worse than one it refuses to answer,
 * but only just — see the note on Memory in the roadmap.
 */
const HISTORY_TURNS = 20;

/**
 * How far behind the summary is allowed to fall before it is refreshed.
 *
 * Not one, because summarising costs a model call and doing it on every turn
 * past the window would double the price of a long conversation. Not fifty,
 * because everything between the summary and the window is simply gone. Ten
 * turns is roughly one exchange's worth of drift.
 */
const SUMMARY_LAG = 10;

/**
 * Rendered once at module load.
 *
 * These have no variables, so re-rendering per request would repeat the same
 * string work — and doing it here means a prompt that cannot render fails at
 * startup rather than on somebody's first message.
 */
const PROMPTS = createDefaultPromptRegistry();
const CHAT_PROMPT = PROMPTS.render("chat.system");
const SUMMARY_PROMPT = PROMPTS.render("chat.summary.system");



/**
 * A passage the answer was allowed to draw on, and where it came from.
 *
 * Sent to the client so an answer can be checked against its source. An
 * assistant that cites nothing is indistinguishable from one that invented the
 * whole thing, and the difference matters most exactly when the answer sounds
 * right.
 */
export type Citation = {
  documentId: string;
  title: string;
  /** Cosine similarity. Higher is closer. */
  score: number;
  excerpt: string;
};

export type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "sources"; citations: Citation[] }
  | { type: "done"; message: Message }
  | { type: "error"; message: string; partial: Message | null };

@Injectable()
export class ChatService {
  constructor(
    @Inject(CONVERSATION_REPOSITORY)
    private readonly conversations: ConversationRepository,
    @Inject(AI_GATEWAY) private readonly gateway: ProviderGateway | null,
    @Inject(AI_USAGE_REPOSITORY) private readonly usage: AiUsageRecorder,
    @Inject(KNOWLEDGE_SERVICE)
    private readonly knowledge: KnowledgeService | null,
    @Inject(WORKSPACE_MEMORY_REPOSITORY)
    private readonly memory: WorkspaceMemoryRepository,
  ) {}

  async createConversation(
    workspaceId: WorkspaceId,
    userId: UserId,
    title?: string,
  ): Promise<Conversation> {
    return this.conversations.create(
      { workspaceId, ...(title === undefined ? {} : { title }) },
      userId,
    );
  }

  async listConversations(workspaceId: WorkspaceId): Promise<Conversation[]> {
    return this.conversations.list(workspaceId);
  }

  async getConversation(
    workspaceId: WorkspaceId,
    id: ConversationId,
  ): Promise<Conversation> {
    const conversation = await this.conversations.findById(workspaceId, id);
    if (!conversation) {
      // 404 rather than 403 for another tenant's thread, like every other read.
      throw new NotFoundError("Không tìm thấy hội thoại.");
    }
    return conversation;
  }

  async listMessages(
    workspaceId: WorkspaceId,
    id: ConversationId,
  ): Promise<Message[]> {
    await this.getConversation(workspaceId, id);
    return this.conversations.listMessages(workspaceId, id);
  }

  async deleteConversation(
    workspaceId: WorkspaceId,
    id: ConversationId,
    userId: UserId,
  ): Promise<void> {
    await this.getConversation(workspaceId, id);
    await this.conversations.softDelete(workspaceId, id, userId);
  }

  /**
   * Record the user's turn, then stream the answer.
   *
   * The user message is written before the model is called, so a failure
   * anywhere after this point leaves a thread that shows what was asked. The
   * opposite order loses the question along with the answer, and the reader
   * cannot tell whether it was ever sent.
   */
  async *send(input: {
    workspaceId: WorkspaceId;
    userId: UserId;
    conversationId: ConversationId;
    content: string;
    correlationId: string;
    /** Aborted when the client goes away. */
    signal: AbortSignal;
  }): AsyncGenerator<StreamEvent, void, undefined> {
    const gateway = this.requireGateway();
    const content = input.content.trim();
    if (content === "") {
      throw new ValidationError("Tin nhắn rỗng.");
    }

    await this.getConversation(input.workspaceId, input.conversationId);

    await this.conversations.appendMessage({
      conversationId: input.conversationId,
      workspaceId: input.workspaceId,
      role: "user",
      content,
    });

    const history = await this.conversations.listMessages(
      input.workspaceId,
      input.conversationId,
    );
    const conversation = await this.getConversation(
      input.workspaceId,
      input.conversationId,
    );

    // Searched on every turn rather than only when the question "looks like"
    // it needs a document. Deciding that would take a model call, which costs
    // more than the embedding the search itself needs; and a wrong decision is
    // invisible, because the answer still sounds fine. The score floor is what
    // keeps irrelevant passages out.
    const citations = await this.lookUp(input.workspaceId, content);
    if (citations.length > 0) yield { type: "sources", citations };

    // What the workspace has told the platform to remember. Read per turn
    // rather than cached: someone changing the brand voice expects the next
    // message to use it, not the next deploy.
    const remembered = await this.memory.list(input.workspaceId);

    let text = "";

    try {
      for await (const chunk of gateway.stream(
        {
          messages: toPrompt(
            history,
            conversation.summary,
            citations,
            remembered,
          ),
        },
        input.signal,
      )) {
        if (chunk.type === "text") {
          text += chunk.delta;
          yield { type: "delta", text: chunk.delta };
        }
        if (chunk.type === "done") {
          const message = await this.recordAnswer(
            input,
            chunk.response,
            false,
            citations,
          );
          yield { type: "done", message };

          // After the answer, never before it. Summarising is another model
          // call, and putting it on the path of a reply would make every turn
          // in a long thread visibly slower for a benefit the reader does not
          // see until the turn after.
          await this.consolidate(input, conversation, history.length + 1);
          return;
        }
      }
    } catch (error: unknown) {
      // What arrived is kept, not discarded: the reader saw it and the vendor
      // billed for it. A transcript missing it disagrees with both.
      const partial =
        error instanceof ProviderStreamError
          ? await this.recordTruncated(input, error)
          : text === ""
            ? null
            : await this.recordTruncated(input, null, text);

      yield {
        type: "error",
        message: error instanceof Error ? error.message : String(error),
        partial,
      };
      return;
    }

    // The gateway guarantees a `done`, so reaching here means it broke its own
    // contract. Said out loud rather than returning an empty answer.
    throw new Error("The gateway ended the stream without a final chunk.");
  }

  /**
   * Fold the turns that have fallen out of the window into the summary.
   *
   * Best effort and deliberately silent on failure: the answer has already
   * been delivered, and turning a summarisation hiccup into a failed reply
   * would trade something the reader has for something they cannot see.
   * The next turn retries, because the count has not moved.
   */
  private async consolidate(
    input: { workspaceId: WorkspaceId; conversationId: ConversationId },
    conversation: Conversation,
    messageCount: number,
  ): Promise<void> {
    const overflow = messageCount - HISTORY_TURNS;
    if (overflow <= 0) return;
    if (overflow - conversation.summarisedCount < SUMMARY_LAG) return;

    try {
      const all = await this.conversations.listMessages(
        input.workspaceId,
        input.conversationId,
      );
      // Exactly the turns that will not fit next time, and only the ones the
      // summary does not already cover.
      const toFold = all.slice(conversation.summarisedCount, overflow);
      if (toFold.length === 0) return;

      const response = await this.requireGateway().generate({
        messages: [
          { role: "system", content: SUMMARY_PROMPT.text },
          {
            role: "user",
            content: [
              conversation.summary
                ? `Tóm tắt hiện có:\n${conversation.summary}`
                : "Chưa có tóm tắt nào.",
              "",
              "Các lượt cần gộp thêm:",
              ...toFold.map(
                (message) => `${message.role}: ${message.content}`,
              ),
            ].join("\n"),
          },
        ],
      });

      await this.conversations.updateSummary(
        input.workspaceId,
        input.conversationId,
        response.text.trim(),
        overflow,
        conversation.summarisedCount,
      );

      await recordUsageSafely(
        this.usage,
        usageRecordFrom(response, {
          workspaceId: input.workspaceId,
          operation: "chat.summarise",
        }),
      );
    } catch {
      // See above: the reply is already out, and the next turn retries.
    }
  }

  /**
   * The workspace's own documents, for this question.
   *
   * Returns nothing rather than failing when search is unavailable or errors:
   * an answer without sources is worse than one with them, and a chat that
   * refuses to reply because Qdrant is down is worse than both.
   */
  private async lookUp(
    workspaceId: WorkspaceId,
    question: string,
  ): Promise<Citation[]> {
    if (!this.knowledge) return [];

    try {
      const hits = await this.knowledge.search({
        workspaceId,
        query: question,
        limit: 4,
      });

      return hits.map((hit) => ({
        documentId: hit.documentId,
        title: hit.title,
        score: Number(hit.score.toFixed(4)),
        excerpt: hit.text.slice(0, 400),
      }));
    } catch {
      return [];
    }
  }

  private async recordAnswer(
    input: {
      workspaceId: WorkspaceId;
      userId: UserId;
      conversationId: ConversationId;
      correlationId: string;
    },
    response: ProviderResponse,
    truncated: boolean,
    citations: Citation[] = [],
  ): Promise<Message> {
    const message = await this.conversations.appendMessage({
      conversationId: input.conversationId,
      workspaceId: input.workspaceId,
      role: "assistant",
      content: response.text,
      provider: response.provider,
      model: response.model,
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      costUsd: response.cost.totalUsd.toFixed(8),
      finishReason: response.finishReason,
      truncated,
      // Stored with the turn, so a transcript read months later still shows
      // what the answer was based on.
      metadata: citations.length > 0 ? { citations } : {},
    });

    // Metered against ai_usage as well as the message, because Billing reads
    // that table and must not have to know chat exists to bill for it.
    await recordUsageSafely(
      this.usage,
      usageRecordFrom(response, {
        workspaceId: input.workspaceId,
        userId: input.userId,
        correlationId: input.correlationId,
        operation: "chat.message",
      }),
    );

    return message;
  }

  /**
   * Write down an answer that did not finish.
   *
   * The usage on a ProviderStreamError is what the gateway managed to capture,
   * which today is nothing — a vendor that drops a stream reports no counts.
   * The row still goes in, with the text, so the transcript matches the screen
   * even when the bill cannot be reconstructed from it.
   */
  private async recordTruncated(
    input: { workspaceId: WorkspaceId; conversationId: ConversationId },
    error: ProviderStreamError | null,
    fallbackText = "",
  ): Promise<Message> {
    return this.conversations.appendMessage({
      conversationId: input.conversationId,
      workspaceId: input.workspaceId,
      role: "assistant",
      content: error?.partial.textSoFar ?? fallbackText,
      inputTokens: error?.partial.usage.inputTokens ?? 0,
      outputTokens: error?.partial.usage.outputTokens ?? 0,
      finishReason: "error",
      truncated: true,
    });
  }

  private requireGateway(): ProviderGateway {
    if (!this.gateway) {
      throw new ValidationError(
        "Chưa cấu hình AI provider. Đặt AI_PROVIDER và key tương ứng.",
      );
    }
    return this.gateway;
  }
}

/**
 * The thread as the model sees it.
 *
 * Only the last few turns, and the system prompt is prepended here rather than
 * stored: it is code, not conversation, and storing it would freeze every old
 * thread to the wording it was started with.
 */
function toPrompt(
  history: readonly Message[],
  summary: string | null,
  citations: readonly Citation[] = [],
  remembered: readonly WorkspaceMemory[] = [],
): ProviderMessage[] {
  const recent = history.slice(-HISTORY_TURNS);

  return [
    { role: "system", content: CHAT_PROMPT.text },
    // Standing facts about this workspace, before anything else: they are
    // meant to shape how every answer is written, not to compete with the
    // question for attention at the end of the prompt.
    ...(remembered.length > 0
      ? [
          {
            role: "system" as const,
            content: [
              "GHI NHỚ VỀ WORKSPACE NÀY (áp dụng cho mọi câu trả lời):",
              ...remembered.map((fact) => `- ${fact.key}: ${fact.value}`),
            ].join("\n"),
          },
        ]
      : []),
    // Labelled as a summary rather than replayed as dialogue, so the model
    // does not quote it back as something the user said in those words.
    ...(summary
      ? [
          {
            role: "system" as const,
            content: `Tóm tắt phần đầu cuộc trò chuyện (không phải lời người dùng vừa nói):\n${summary}`,
          },
        ]
      : []),
    // The workspace's own documents, marked as the authoritative source. The
    // instruction to say when they do not answer matters as much as the
    // passages: without it a model handed unrelated text will use it anyway.
    ...(citations.length > 0
      ? [
          {
            role: "system" as const,
            content: [
              "TRÍCH ĐOẠN TỪ TÀI LIỆU NỘI BỘ CỦA WORKSPACE (nguồn có thẩm quyền cao nhất):",
              "",
              ...citations.map(
                (citation, index) =>
                  `[${index + 1}] ${citation.title}: ${citation.excerpt}`,
              ),
              "",
              "Nếu trích đoạn trả lời được câu hỏi, hãy bám sát nó và nói rõ lấy từ tài liệu nào. Nếu KHÔNG, hãy nói thẳng là tài liệu không có thông tin đó thay vì tự suy ra.",
            ].join("\n"),
          },
        ]
      : []),
    ...recent
      // A truncated answer is shown to the reader but not fed back: it stops
      // mid-word, and a model asked to continue from it tends to repeat the
      // whole thing.
      .filter((message) => !message.truncated && message.role !== "system")
      .map((message) => ({
        role: message.role as "user" | "assistant",
        content: message.content,
      })),
  ];
}
