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

/**
 * How far behind the summary is allowed to fall before it is refreshed.
 *
 * Not one, because summarising costs a model call and doing it on every turn
 * past the window would double the price of a long conversation. Not fifty,
 * because everything between the summary and the window is simply gone. Ten
 * turns is roughly one exchange's worth of drift.
 */
const SUMMARY_LAG = 10;

const SUMMARY_PROMPT = `Bạn đang nén phần đầu của một cuộc trò chuyện để giữ lại trong bộ nhớ.

Viết lại thành một đoạn tóm tắt ngắn, ở ngôi thứ ba, giữ đúng những thứ mà lượt sau còn cần:

- Người dùng là ai, đang làm gì, muốn gì.
- Những quyết định đã chốt và những con số, tên riêng, ràng buộc đã nêu.
- Những gì đã bị bác bỏ, để không đề xuất lại.

Bỏ lời chào, lời cảm ơn, và mọi thứ chỉ có ý nghĩa tại thời điểm nói.

Nếu đã có tóm tắt trước đó, hãy gộp phần mới vào chứ đừng viết lại từ đầu và đừng làm mất thông tin cũ.

Chỉ trả về đoạn tóm tắt, không thêm lời dẫn.`;

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
    const conversation = await this.getConversation(
      input.workspaceId,
      input.conversationId,
    );

    let text = "";

    try {
      for await (const chunk of gateway.stream(
        { messages: toPrompt(history, conversation.summary) },
        input.signal,
      )) {
        if (chunk.type === "text") {
          text += chunk.delta;
          yield { type: "delta", text: chunk.delta };
        }
        if (chunk.type === "done") {
          const message = await this.recordAnswer(input, chunk.response, false);
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
          { role: "system", content: SUMMARY_PROMPT },
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
function toPrompt(
  history: readonly Message[],
  summary: string | null,
): ProviderMessage[] {
  const recent = history.slice(-HISTORY_TURNS);

  return [
    { role: "system", content: SYSTEM_PROMPT },
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
