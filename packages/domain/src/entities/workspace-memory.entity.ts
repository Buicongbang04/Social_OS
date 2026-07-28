import type {
  Metadata,
  SoftDeletableEntity,
  WorkspaceId,
  WorkspaceMemoryId,
} from "@repo/core";

/**
 * Where a remembered fact came from.
 *
 * Only `MANUAL` is written today, and the distinction exists now rather than
 * later because of what the other value costs. A fact the model decided to
 * remember, with nobody reviewing it, is something the workspace never agreed
 * to that then shapes every answer it gets — and the only way anyone finds out
 * it was wrong is by noticing the output has quietly been wrong for a while.
 * When a learned path does arrive, the column already says which is which.
 */
export const MEMORY_SOURCES = ["MANUAL", "LEARNED"] as const;
export type MemorySource = (typeof MEMORY_SOURCES)[number];

/**
 * One durable fact about a workspace.
 *
 * Long-term memory in the taxonomy of docs/ai/06_AGENT_MEMORY.md: brand voice,
 * standing preferences, constraints that outlive any one conversation. What a
 * document says is not this — that is Semantic Memory and it lives in Qdrant,
 * retrieved per question rather than carried in every prompt.
 */
export type WorkspaceMemory = SoftDeletableEntity<WorkspaceMemoryId> & {
  workspaceId: WorkspaceId;
  /**
   * What the fact is about, e.g. "giọng văn" or "khách hàng mục tiêu".
   *
   * Unique per workspace, so remembering the same thing twice replaces it
   * rather than leaving the model to reconcile two answers to one question.
   */
  key: string;
  value: string;
  source: MemorySource;
  metadata: Metadata;
};

export type CreateWorkspaceMemoryInput = {
  workspaceId: WorkspaceId;
  key: string;
  value: string;
  source?: MemorySource;
  metadata?: Metadata;
};
