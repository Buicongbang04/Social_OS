import type { JsonSchema } from "@repo/ai";
import type { UserId, WorkspaceId } from "@repo/core";
import type { KnowledgeService } from "@repo/knowledge";
import type {
  DocumentRepository,
  WorkspaceMemoryRepository,
} from "@repo/domain";

/**
 * What a chat tool is allowed to be.
 *
 * `readOnly` is required and, for now, must be true — see `assertReadOnly`.
 * This is the first place a model is allowed to do something rather than say
 * something, and the two failures are not comparable: a wrong answer is wrong
 * and visible, while a wrong action has already happened by the time anyone
 * reads it.
 *
 * A tool with side effects belongs on the Goal path, which already has a
 * planner that can be reviewed, a budget check, an approval gate and an audit
 * trail. None of that exists on the chat path, and adding a publishing tool
 * here would route around all four.
 */
export type ChatTool = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  /** Must be true. Kept as a field so the day it is not is a visible edit. */
  readOnly: true;
  run(
    input: Record<string, unknown>,
    context: { workspaceId: WorkspaceId; userId: UserId },
  ): Promise<unknown>;
};

export type ChatToolDeps = {
  knowledge: KnowledgeService | null;
  documents: DocumentRepository;
  memory: WorkspaceMemoryRepository;
};

/**
 * The tools chat may call.
 *
 * Every one reads. None writes. The workspace never comes from the model's
 * arguments — it comes from the request context, for the same reason
 * knowledge.search takes it from the task: an id the caller can name is an id
 * the caller can change.
 */
export function createChatTools(deps: ChatToolDeps): ChatTool[] {
  const tools: ChatTool[] = [
    {
      name: "liet_ke_tai_lieu",
      description:
        "Liệt kê các tài liệu workspace đã tải lên, kèm trạng thái lập chỉ mục. Dùng khi người dùng hỏi có những tài liệu gì, hoặc muốn biết một file đã tra cứu được chưa.",
      readOnly: true,
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      async run(_input, context) {
        const documents = await deps.documents.list(context.workspaceId, 20);
        return documents.map((document) => ({
          title: document.title,
          fileName: document.fileName,
          status: document.status,
          chunks: document.chunkCount,
        }));
      },
    },
    {
      name: "doc_ghi_nho",
      description:
        "Đọc những điều workspace đã dặn ghi nhớ (giọng văn, khách hàng mục tiêu, điều cấm kỵ...). Dùng khi cần biết workspace này muốn được phục vụ thế nào.",
      readOnly: true,
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      async run(_input, context) {
        const facts = await deps.memory.list(context.workspaceId);
        return facts.map((fact) => ({ key: fact.key, value: fact.value }));
      },
    },
  ];

  if (deps.knowledge) {
    tools.push({
      name: "tim_trong_tai_lieu",
      description:
        "Tìm những đoạn liên quan trong tài liệu nội bộ của workspace. Dùng khi câu hỏi cần nội dung cụ thể trong một tài liệu, đặc biệt khi các đoạn đã đưa sẵn chưa đủ trả lời.",
      readOnly: true,
      inputSchema: {
        type: "object",
        properties: {
          cau_hoi: {
            type: "string",
            description: "Câu cần tìm, viết đầy đủ chứ không phải từ khoá rời.",
          },
        },
        required: ["cau_hoi"],
        additionalProperties: false,
      },
      async run(input, context) {
        const query = typeof input.cau_hoi === "string" ? input.cau_hoi : "";
        // The workspace is the context's, never the model's. Everything else
        // in `input` is untrusted text.
        const hits = await deps.knowledge!.search({
          workspaceId: context.workspaceId,
          query,
          limit: 4,
        });

        return hits.map((hit) => ({
          title: hit.title,
          excerpt: hit.text.slice(0, 400),
          score: Number(hit.score.toFixed(3)),
        }));
      },
    });
  }

  return tools.map(assertReadOnly);
}

/**
 * Refuse a tool that is not read-only.
 *
 * A runtime check as well as a type, because the type only holds while
 * everything is written in TypeScript and reviewed. What this is really
 * guarding is the moment someone adds "post to Facebook" here because it is
 * the obvious next step: chat has no planner to review, no budget check, no
 * approval gate and no audit trail, and a tool that publishes from here routes
 * around all four.
 */
function assertReadOnly(tool: ChatTool): ChatTool {
  if (tool.readOnly !== true) {
    throw new Error(
      `Chat tool ${tool.name} is not read-only. Tools with side effects belong on the Goal path, which has approval and audit.`,
    );
  }
  return tool;
}
