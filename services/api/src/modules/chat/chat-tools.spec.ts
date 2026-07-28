import type { WorkspaceMemory } from "@repo/domain";
import { newId, type UserId, type WorkspaceId } from "@repo/core";
import { describe, expect, it } from "vitest";
import { createChatTools, type ChatToolDeps } from "./chat-tools";

const WORKSPACE = newId("workspace") as WorkspaceId;
const OTHER = newId("workspace") as WorkspaceId;
const USER = newId("user") as UserId;

/** Records which workspace each read was scoped to. */
function deps(): ChatToolDeps & { scopedTo: WorkspaceId[] } {
  const scopedTo: WorkspaceId[] = [];

  return {
    scopedTo,
    knowledge: {
      search: async (input: { workspaceId: WorkspaceId }) => {
        scopedTo.push(input.workspaceId);
        return [
          {
            id: "chk_1",
            workspaceId: input.workspaceId,
            documentId: "doc_1",
            chunkIndex: 0,
            text: "nội dung",
            startOffset: 0,
            endOffset: 8,
            title: "tài liệu",
            score: 0.9,
          },
        ];
      },
    } as unknown as ChatToolDeps["knowledge"],
    documents: {
      list: async (workspaceId: WorkspaceId) => {
        scopedTo.push(workspaceId);
        return [];
      },
    } as unknown as ChatToolDeps["documents"],
    memory: {
      list: async (workspaceId: WorkspaceId) => {
        scopedTo.push(workspaceId);
        return [] as WorkspaceMemory[];
      },
    } as unknown as ChatToolDeps["memory"],
    connections: {
      inbox: async (workspaceId: WorkspaceId) => {
        scopedTo.push(workspaceId);
        return { threads: [], failed: [] };
      },
      stats: async (workspaceId: WorkspaceId) => {
        scopedTo.push(workspaceId);
        return { posts: [], failed: [] };
      },
    } as unknown as ChatToolDeps["connections"],
  };
}

describe("chat tools", () => {
  it("offers only read-only tools", () => {
    // The rule this whole file exists for. A wrong answer is wrong and
    // visible; a wrong action has already happened by the time anyone reads
    // it — and chat has no planner to review, no budget check, no approval
    // gate and no audit trail.
    for (const tool of createChatTools(deps())) {
      expect(tool.readOnly).toBe(true);
    }
  });

  it("scopes every read to the caller's workspace", async () => {
    const dependencies = deps();
    const tools = createChatTools(dependencies);

    for (const tool of tools) {
      await tool.run(
        { cau_hoi: "cà phê" },
        {
          workspaceId: WORKSPACE,
          userId: USER,
        },
      );
    }

    // One recorded read per tool, not merely "none of them was wrong". A tool
    // that scoped to a hardcoded workspace would record the wrong id; a tool
    // that never touched its dependency at all would record nothing, and an
    // `every` over an empty list is true.
    expect(dependencies.scopedTo).toHaveLength(tools.length);
    expect(dependencies.scopedTo.every((id) => id === WORKSPACE)).toBe(true);
  });

  it("leaves out the channel tools when nothing is connected", async () => {
    // An offered tool that fails on every call teaches the model to stop
    // trying — and it stops trying for the workspaces where it would have
    // worked too.
    const tools = createChatTools({ ...deps(), connections: null });

    expect(tools.map((tool) => tool.name)).not.toContain("xem_hop_thu");
    expect(tools.map((tool) => tool.name)).not.toContain("so_lieu_bai_dang");
  });

  it("ignores a workspace the model puts in its arguments", async () => {
    // The model writes the arguments. An id it can name is an id it can
    // change, so the workspace comes from the request context and nowhere
    // else.
    const dependencies = deps();
    const search = createChatTools(dependencies).find(
      (tool) => tool.name === "tim_trong_tai_lieu",
    );

    await search!.run(
      { cau_hoi: "cà phê", workspaceId: OTHER, workspace_id: OTHER },
      { workspaceId: WORKSPACE, userId: USER },
    );

    expect(dependencies.scopedTo).toEqual([WORKSPACE]);
  });

  it("leaves out document search when there is no knowledge service", async () => {
    // Rather than offering a tool that always fails, which a model then keeps
    // retrying.
    const tools = createChatTools({ ...deps(), knowledge: null });

    expect(tools.map((tool) => tool.name)).not.toContain("tim_trong_tai_lieu");
    expect(tools.length).toBeGreaterThan(0);
  });

  it("describes each tool in terms of when to use it", () => {
    // The description is the only thing the model has to choose by. "Search
    // documents" says what it is; it does not say when it is the right move.
    for (const tool of createChatTools(deps())) {
      expect(tool.description.length).toBeGreaterThan(60);
      expect(tool.description).toMatch(/Dùng khi/);
    }
  });

  it("gives every tool a schema the provider can send", () => {
    for (const tool of createChatTools(deps())) {
      expect(tool.inputSchema.type).toBe("object");
      // Closed on purpose: an open schema invites the model to invent
      // arguments, and the ones it invents most readily are ids.
      expect(tool.inputSchema.additionalProperties).toBe(false);
    }
  });
});
