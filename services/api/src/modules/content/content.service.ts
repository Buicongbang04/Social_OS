import { Inject, Injectable } from "@nestjs/common";
import {
  rewriteContent,
  suggestSeo,
  translateContent,
  writeContent,
  type ContentResult,
  type RewriteInput,
  type SeoInput,
  type TranslateInput,
  type WriteInput,
} from "@repo/ai";
import { ValidationError, type UserId, type WorkspaceId } from "@repo/core";
import type { AiUsageRecorder } from "@repo/ai";
import { newId } from "@repo/core";
import type { WorkspaceMemoryRepository } from "@repo/domain";
import { AI_USAGE_REPOSITORY, WORKSPACE_MEMORY_REPOSITORY } from "../../infra/database/database.module";
import { WorkspaceGatewayFactory } from "../../infra/ai/workspace-gateway";

/**
 * The content studio.
 *
 * Every operation goes through the workspace's own gateway, so a workspace
 * that has connected its own provider key spends its own quota here as
 * everywhere else — and every call is metered, because a studio that quietly
 * costs money is one nobody can budget for.
 */
@Injectable()
export class ContentService {
  constructor(
    private readonly gateways: WorkspaceGatewayFactory,
    @Inject(WORKSPACE_MEMORY_REPOSITORY)
    private readonly memory: WorkspaceMemoryRepository,
    @Inject(AI_USAGE_REPOSITORY)
    private readonly usage: AiUsageRecorder,
  ) {}

  async write(
    workspaceId: WorkspaceId,
    userId: UserId,
    input: Omit<WriteInput, "memory">,
  ) {
    const gateway = await this.require(workspaceId);
    // Read fresh on every call rather than cached: somebody who has just
    // changed the brand voice expects the next draft to use it.
    const remembered = await this.memory.list(workspaceId);

    return this.meter(
      workspaceId,
      userId,
      "content.write",
      await writeContent(
        { gateway },
        {
          ...input,
          memory: remembered.map((fact) => ({
            key: fact.key,
            value: fact.value,
          })),
        },
      ),
    );
  }

  async rewrite(
    workspaceId: WorkspaceId,
    userId: UserId,
    input: RewriteInput,
  ) {
    return this.meter(
      workspaceId,
      userId,
      "content.rewrite",
      await rewriteContent({ gateway: await this.require(workspaceId) }, input),
    );
  }

  async translate(
    workspaceId: WorkspaceId,
    userId: UserId,
    input: TranslateInput,
  ) {
    return this.meter(
      workspaceId,
      userId,
      "content.translate",
      await translateContent(
        { gateway: await this.require(workspaceId) },
        input,
      ),
    );
  }

  async seo(workspaceId: WorkspaceId, userId: UserId, input: SeoInput) {
    return this.meter(
      workspaceId,
      userId,
      "content.seo",
      await suggestSeo({ gateway: await this.require(workspaceId) }, input),
    );
  }

  /**
   * Write the usage row, then hand back the result.
   *
   * Metered here rather than inside the operations, for the same reason the
   * capabilities meter rather than the gateway: the ledger needs a workspace
   * and a user, and `@repo/ai` deliberately knows about neither.
   *
   * A failed write must not fail the call — the provider has already answered
   * and we have already been charged — but it is never swallowed silently
   * either, because an unrecorded call is unbilled revenue.
   */
  private async meter<T>(
    workspaceId: WorkspaceId,
    userId: UserId,
    operation: string,
    result: ContentResult<T>,
  ): Promise<ContentResult<T>> {
    await this.usage
      .record({
        id: newId("aiUsage"),
        workspaceId,
        userId,
        executionId: null,
        taskId: null,
        correlationId: null,
        provider: result.provider as never,
        model: result.model,
        operation,
        usage: {
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          totalTokens: result.usage.totalTokens,
          cachedInputTokens: 0,
          reasoningTokens: 0,
        },
        cost: {
          inputUsd: 0,
          outputUsd: 0,
          totalUsd: Number(result.costUsd),
          priced: Number(result.costUsd) > 0,
        },
        latencyMs: 0,
        finishReason: "stop",
        metadata: { promptVersion: result.promptVersion },
        timestamp: new Date(),
      })
      .catch((error: unknown) => {
         
        console.error(`[content] failed to record ${operation}:`, error);
      });

    return result;
  }

  private async require(workspaceId: WorkspaceId) {
    const gateway = await this.gateways.forWorkspace(workspaceId);
    if (!gateway) {
      throw new ValidationError(
        "Chưa cấu hình AI provider. Kết nối key của workspace, hoặc đặt AI_PROVIDER và key tương ứng.",
      );
    }
    return gateway;
  }
}
