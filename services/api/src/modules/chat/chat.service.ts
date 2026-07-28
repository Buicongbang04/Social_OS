import { Inject, Injectable } from "@nestjs/common";
import {
  ProviderStreamError,
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
import type {
  Conversation,
  ConversationRepository,
  Message,
} from "@repo/domain";
import { AI_USAGE_REPOSITORY } from "../../infra/database/database.module";
import { CONVERSATION_REPOSITORY } from "../../infra/database/database.module";
import { AI_GATEWAY } from "../../infra/ai/ai.module";

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

const SYSTEM_PROMPT = `Bạn là trợ lý của một nền tảng tự động hoá mạng xã hội.

Trả lời ngắn gọn, đúng trọng tâm, bằng ngôn ngữ người dùng đang dùng.

Nếu không biết thì nói là không biết. Đừng bịa số liệu, đừng bịa nguồn.`;

export type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "done"; message: Message }
  | { type: "error"; message: string; partial: Message | null };

@Injectable()
export class ChatService {
  constructor(
    @Inject(CONVERSATION_REPOSITORY)
    private readonly conversations: ConversationRepository,
    @Inject(AI_GATEWAY) private readonly gateway: ProviderGateway | null,
    @Inject(AI_USAGE_REPOSITORY) private readonly usage: AiUsageRecorder,
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

    let text = "";

    try {
      for await (const chunk of gateway.stream(
        { messages: toPrompt(history) },
        input.signal,
      )) {
        if (chunk.type === "text") {
          text += chunk.delta;
          yield { type: "delta", text: chunk.delta };
        }
        if (chunk.type === "done") {
          const message = await this.recordAnswer(input, chunk.response, false);
          yield { type: "done", message };
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

  private async recordAnswer(
    input: {
      workspaceId: WorkspaceId;
      userId: UserId;
      conversationId: ConversationId;
      correlationId: string;
    },
    response: ProviderResponse,
    truncated: boolean,
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
function toPrompt(history: readonly Message[]): ProviderMessage[] {
  const recent = history.slice(-HISTORY_TURNS);

  return [
    { role: "system", content: SYSTEM_PROMPT },
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
