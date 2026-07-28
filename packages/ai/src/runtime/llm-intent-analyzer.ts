import { newId, type ExecutionId } from "@repo/core";
import {
  INTENT_TYPES,
  RuntimeError,
  type Goal,
  type Intent,
  type IntentAnalyzer,
} from "@repo/runtime";
import { z } from "zod";
import type { ProviderGateway } from "../provider/gateway";
import { structured } from "../provider/structured";
import {
  recordUsageSafely,
  usageRecordFrom,
  type AiUsageRecord,
  type AiUsageRecorder,
} from "../usage/recorder";
import { createDefaultPromptRegistry } from "../prompt/builtin";
import {
  intentUserPrompt,
} from "./prompts";

/**
 * Rendered once at module load.
 *
 * A system prompt has no variables, so re-rendering it per request would only
 * repeat the same string work — and doing it once means a prompt that cannot
 * render fails at startup rather than on somebody's first goal.
 */
const INTENT_PROMPT = createDefaultPromptRegistry().render("intent.system");


const intentSchema = z.object({
  intents: z
    .array(
      z.object({
        type: z.enum(INTENT_TYPES),
        /** snake_case verb, e.g. "generate_content". */
        action: z.string().min(1).max(60),
        entities: z.record(
          z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
        ),
        confidence: z.number().min(0).max(1),
      }),
    )
    // A goal that produces no intent at all is a failure to understand, not a
    // valid empty answer — the model must at least say CHAT.
    .min(1)
    .max(12),
});

export type LlmIntentAnalyzerOptions = {
  gateway: ProviderGateway;
  recorder: AiUsageRecorder;
  model?: string;
  /**
   * Low, because the same objective should not produce a different reading on
   * a re-run. This is comprehension, not creative writing.
   */
  temperature?: number;
  onUsageError?: (error: unknown, record: AiUsageRecord) => void;
};

/**
 * Intent Engine backed by a model.
 *
 * Replaces KeywordIntentAnalyzer without touching anything else: the
 * IntentAnalyzer port was built for exactly this swap in Phase 1. What it adds
 * over keyword matching is the two things keywords cannot do — inferring a
 * step the user only implied, and reading an objective whose wording was never
 * anticipated.
 */
export class LlmIntentAnalyzer implements IntentAnalyzer {
  private static readonly schema = structured(
    "intent_analysis",
    intentSchema,
    "Các Intent tách được từ mục tiêu người dùng.",
  );

  constructor(private readonly options: LlmIntentAnalyzerOptions) {}

  async analyze(
    goal: Goal,
    executionId: ExecutionId,
  ): Promise<readonly Intent[]> {
    const response = await this.options.gateway
      .generateObject(
        {
          ...(this.options.model === undefined
            ? {}
            : { model: this.options.model }),
          temperature: this.options.temperature ?? 0.1,
          messages: [
            { role: "system", content: INTENT_PROMPT.text },
            {
              role: "user",
              content: intentUserPrompt({
                objective: goal.objective,
                title: goal.title,
                constraints: goal.constraints,
                schedule: goal.schedule,
              }),
            },
          ],
          metadata: {
            operation: "intent.analyze",
            promptVersion: INTENT_PROMPT.version,
          },
        },
        LlmIntentAnalyzer.schema,
      )
      .catch((error: unknown) => {
        // PLANNING rather than PROVIDER: by the time this surfaces, the
        // gateway has already retried and exhausted its fallback chain, so
        // what the runtime is being told is "this goal could not be
        // understood", not "the vendor blipped".
        throw new RuntimeError(
          "PLANNING",
          `Could not analyse the goal's intent: ${error instanceof Error ? error.message : String(error)}`,
          {
            retryable: false,
            context: { goalId: goal.id, executionId },
            cause: error,
          },
        );
      });

    await recordUsageSafely(
      this.options.recorder,
      usageRecordFrom(response, {
        workspaceId: goal.workspaceId,
        userId: goal.ownerId,
        executionId,
        correlationId: null,
        operation: "intent.analyze",
      }),
      this.options.onUsageError,
    );

    const timestamp = new Date();
    return response.object.intents.map((intent) => ({
      id: newId("event"),
      executionId,
      type: intent.type,
      action: intent.action,
      entities: intent.entities,
      constraints: { ...goal.constraints },
      confidence: intent.confidence,
      metadata: {
        analyzer: "llm",
        provider: response.provider,
        model: response.model,
        promptVersion: INTENT_PROMPT.version,
        goalId: goal.id,
      },
      timestamp,
    }));
  }
}
