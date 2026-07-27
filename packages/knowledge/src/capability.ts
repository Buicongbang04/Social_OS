import {
  RuntimeError,
  type CapabilityImplementation,
} from "@repo/runtime";
import { DEFAULT_SEARCH_LIMIT, type KnowledgeService } from "./service";
import type { SearchHit } from "./store/types";

export type KnowledgeCapabilityOptions = {
  knowledge: KnowledgeService;
  /** Hits below this are dropped. Left out, the service's default applies. */
  minScore?: number;
};

/**
 * Capabilities that read a workspace's own documents.
 *
 * Lives here rather than in services/runtime so the chunking, the store and
 * the capability that exposes them stay in one package — and so @repo/runtime
 * keeps knowing nothing about vectors.
 */
export function createKnowledgeCapabilities(
  options: KnowledgeCapabilityOptions,
): readonly CapabilityImplementation[] {
  return [knowledgeSearch(options)];
}

function knowledgeSearch(
  options: KnowledgeCapabilityOptions,
): CapabilityImplementation {
  return {
    descriptor: {
      id: "knowledge.search",
      name: "Search Knowledge",
      description:
        "Tra cứu trong TÀI LIỆU NỘI BỘ mà workspace này đã tải lên (sổ tay, chính sách, hướng dẫn, dữ liệu riêng) và trả về các đoạn văn liên quan kèm nguồn trích dẫn. Dùng bước này BẤT CỨ KHI NÀO mục tiêu nhắc tới tài liệu, chính sách, quy định, hoặc dữ liệu riêng của tổ chức — trước bước viết nội dung, để bài viết dựa trên tài liệu thật thay vì bịa. KHÔNG tìm trên internet.",
      version: "1.0.0",
      category: "Research",
      supportedWorkers: ["FUNCTION"],
      // Reading a workspace's uploaded files, so the file permission rather
      // than the workflow one: a role that may run workflows but not read
      // files must not get at documents through a Goal.
      permissions: ["workspace.file.read"],
      timeoutMs: 30_000,
      // One embedding call on a short query. Two orders of magnitude cheaper
      // than a generation step, and declared honestly so the budget check does
      // not refuse a step that costs almost nothing.
      estimatedCostUsd: 0.0001,
    },
    handler: async (context) => {
      const query =
        text(context.inputs.query) ??
        text(context.inputs.topic) ??
        text(context.inputs.objective);

      if (!query) {
        throw new RuntimeError(
          "VALIDATION",
          "knowledge.search cần một câu hỏi (query, topic hoặc objective).",
          { retryable: false, context: { taskId: context.taskId } },
        );
      }

      const hits = await options.knowledge.search({
        // Straight from the task's context, never from its inputs. A
        // workspace the caller could name in `inputs` would be a workspace the
        // caller could change.
        workspaceId: context.workspaceId,
        query,
        limit: positiveInt(context.inputs.limit) ?? DEFAULT_SEARCH_LIMIT,
        ...(options.minScore === undefined
          ? {}
          : { minScore: options.minScore }),
      });

      return {
        query,
        found: hits.length,
        // Named `passages` rather than `results`: the next step is a model
        // reading them, and what it gets is quoted source text, not answers.
        passages: hits.map(toPassage),
        // Said explicitly so a downstream step cannot mistake "this workspace
        // has no document about it" for "this is not true".
        grounded: hits.length > 0,
      };
    },
  };
}

function toPassage(hit: SearchHit) {
  return {
    text: hit.text,
    // Everything a citation needs: which file, and where in it.
    documentId: hit.documentId,
    title: hit.title,
    chunkIndex: hit.chunkIndex,
    startOffset: hit.startOffset,
    endOffset: hit.endOffset,
    score: Number(hit.score.toFixed(4)),
  };
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

function positiveInt(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 20) : undefined;
}
