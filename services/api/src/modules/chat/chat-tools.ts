import type { JsonSchema } from "@repo/ai";
import type { UserId, WorkspaceId } from "@repo/core";
import type { ConnectionsService } from "../connections/connections.service";
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
  /**
   * Reading the connected channels. Null when the vault is not configured, in
   * which case the tools are simply absent — an offered tool that fails on
   * every call teaches the model to stop trying, and it stops trying for the
   * workspaces where it would have worked too.
   */
  connections: ConnectionsService | null;
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
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
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
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      async run(_input, context) {
        const facts = await deps.memory.list(context.workspaceId);
        return facts.map((fact) => ({ key: fact.key, value: fact.value }));
      },
    },
  ];

  if (deps.connections) {
    tools.push(
      {
        name: "xem_hop_thu",
        description:
          "Xem tin nhắn khách gửi tới các kênh mạng xã hội đã kết nối. Dùng khi người dùng hỏi có ai nhắn gì không, ai đang chờ trả lời, hoặc khách hỏi về chuyện gì.",
        readOnly: true,
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        async run(_input, context) {
          const inbox = await deps.connections!.inbox(context.workspaceId);
          return {
            // Reported so the model can say "I could not read one channel"
            // rather than answering as though that channel had no messages.
            khong_doc_duoc: inbox.failed.map((f) => f.account),
            luong: inbox.threads.map((thread) => ({
              nguoi_gui: thread.participant,
              kenh: thread.account,
              chua_doc: thread.unread,
              luc: thread.updatedAt,
              tin_cuoi: thread.lastMessage,
            })),
          };
        },
      },
      {
        name: "so_lieu_bai_dang",
        description:
          "Xem tương tác của các bài đã đăng trên kênh đã kết nối: lượt thích, bình luận, chia sẻ. Dùng khi người dùng hỏi bài nào hiệu quả, hoặc muốn so sánh các bài gần đây.",
        readOnly: true,
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        async run(_input, context) {
          const report = await deps.connections!.stats(context.workspaceId);
          return {
            khong_doc_duoc: report.failed.map((f) => f.account),
            // Reach is deliberately absent rather than reported as zero. A
            // model handed a column of zeros will conclude nobody saw the
            // posts and say so, which would be a claim the data cannot make.
            bai: report.posts.map((post) => ({
              noi_dung: post.message,
              kenh: post.account,
              luc: post.createdAt,
              thich: post.likes,
              binh_luan: post.comments,
              chia_se: post.shares,
              link: post.url,
            })),
          };
        },
      },
    );
  }

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
