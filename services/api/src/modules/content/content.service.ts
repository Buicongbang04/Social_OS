import { Inject, Injectable } from "@nestjs/common";
import {
  analyseCompetitor,
  extractBrandFacts,
  rewriteContent,
  suggestSeo,
  translateContent,
  writeContent,
  type BrandFact,
  type CompetitorAnalysis,
  type ContentResult,
  type RewriteInput,
  type SeoInput,
  type TranslateInput,
  type WriteInput,
} from "@repo/ai";
import { ValidationError, type UserId, type WorkspaceId } from "@repo/core";
import { crawlPage, type CrawledPage } from "@repo/trends";
import type { AiUsageRecorder } from "@repo/ai";
import { newId } from "@repo/core";
import type { WorkspaceMemoryRepository } from "@repo/domain";
import {
  AI_USAGE_REPOSITORY,
  WORKSPACE_MEMORY_REPOSITORY,
} from "../../infra/database/database.module";
import { WorkspaceGatewayFactory } from "../../infra/ai/workspace-gateway";

/**
 * The content studio.
 *
 * Every operation goes through the workspace's own gateway, so a workspace
 * that has connected its own provider key spends its own quota here as
 * everywhere else — and every call is metered, because a studio that quietly
 * costs money is one nobody can budget for.
 */
/**
 * The remembered fact that holds the block ending every post.
 *
 * A reserved key rather than a column: it is one more thing the workspace
 * remembers about how it wants to be spoken for, and putting it in memory
 * means it is edited in the same place as the brand voice.
 */
const FOOTER_KEY = "chan-bai";

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
    const footer = remembered.find((fact) => fact.key === FOOTER_KEY);

    return this.meter(
      workspaceId,
      userId,
      "content.write",
      await writeContent(
        { gateway },
        {
          ...input,
          // The footer is left out of the memory block it came from. Handed to
          // the model as something to remember, it gets paraphrased into the
          // body as well, and the post ends with two different hotlines.
          memory: remembered
            .filter((fact) => fact.key !== FOOTER_KEY)
            .map((fact) => ({ key: fact.key, value: fact.value })),
          ...(footer ? { footer: footer.value } : {}),
        },
      ),
    );
  }

  /**
   * Read a competitor's page and say what it tells us.
   *
   * The crawl happens here, in the service, rather than in `@repo/ai`: whether
   * a site may be read is a question about robots.txt and content types, and
   * burying it inside an AI call would put that decision in the model layer.
   *
   * A crawl that fails never reaches the model, so a workspace is not billed
   * for a page nobody could read.
   */
  async analyseCompetitor(
    workspaceId: WorkspaceId,
    userId: UserId,
    url: string,
  ): Promise<ContentResult<CompetitorAnalysis> & { page: CrawledPage }> {
    const gateway = await this.require(workspaceId);

    const page = await crawlPage(url).catch((error: unknown) => {
      // Turned into a ValidationError so the caller gets the reason with a
      // status attached. A CrawlError carries none, so robots.txt refusing
      // would otherwise surface as a 500 about our own server.
      throw new ValidationError(
        error instanceof Error ? error.message : String(error),
      );
    });

    if (page.text.trim().length < 200) {
      // Below this there is nothing to analyse, and a model handed an empty
      // page invents a company. Common for sites that render entirely in the
      // browser — said plainly rather than answered with confident fiction.
      throw new ValidationError(
        `${page.url} hầu như không có chữ nào đọc được từ HTML — nhiều khả năng trang này dựng bằng JavaScript. Thử một trang bài viết cụ thể thay vì trang chủ.`,
      );
    }

    const result = await this.meter(
      workspaceId,
      userId,
      "competitor.analyse",
      await analyseCompetitor({ gateway }, page),
    );

    return { ...result, page };
  }

  /**
   * Read the workspace's own site and propose what to remember.
   *
   * Proposes; never saves. A wrong brand fact is not one wrong answer — it is
   * a wrong answer repeated in everything written afterwards, so a person
   * approves each one. That is the same reason a post is approved before it
   * goes out.
   */
  async extractBrandFacts(
    workspaceId: WorkspaceId,
    userId: UserId,
    url: string,
  ): Promise<ContentResult<{ facts: BrandFact[] }> & { page: CrawledPage }> {
    const gateway = await this.require(workspaceId);

    const page = await crawlPage(url).catch((error: unknown) => {
      throw new ValidationError(
        error instanceof Error ? error.message : String(error),
      );
    });

    if (page.text.trim().length < 200) {
      throw new ValidationError(
        `${page.url} hầu như không có chữ nào đọc được từ HTML — nhiều khả năng trang này dựng bằng JavaScript. Thử một trang giới thiệu cụ thể thay vì trang chủ.`,
      );
    }

    const result = await this.meter(
      workspaceId,
      userId,
      "brand.extract",
      await extractBrandFacts({ gateway }, page),
    );

    return { ...result, page };
  }

  async rewrite(workspaceId: WorkspaceId, userId: UserId, input: RewriteInput) {
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
