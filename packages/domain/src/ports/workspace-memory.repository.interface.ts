import type { UserId, WorkspaceId, WorkspaceMemoryId } from "@repo/core";
import type {
  CreateWorkspaceMemoryInput,
  WorkspaceMemory,
} from "../entities/workspace-memory.entity";

export interface WorkspaceMemoryRepository {
  /**
   * Everything this workspace remembers, most recently changed first.
   *
   * Bounded, because every one of these goes into a prompt. A workspace with
   * five hundred remembered facts would spend its whole context window on them
   * and have none left for the question — and the failure would look like the
   * model ignoring what it was asked.
   */
  list(workspaceId: WorkspaceId, limit?: number): Promise<WorkspaceMemory[]>;

  findById(
    workspaceId: WorkspaceId,
    id: WorkspaceMemoryId,
  ): Promise<WorkspaceMemory | null>;

  /**
   * Remember a fact, replacing whatever was remembered under that key.
   *
   * Upsert rather than insert: remembering the same thing twice must not leave
   * the model reconciling two answers to one question, and "what is our brand
   * voice" has exactly one answer at a time.
   */
  remember(
    input: CreateWorkspaceMemoryInput,
    actorId: UserId | null,
  ): Promise<WorkspaceMemory>;

  forget(
    workspaceId: WorkspaceId,
    id: WorkspaceMemoryId,
    actorId: UserId | null,
  ): Promise<boolean>;
}
