import type {
  Metadata,
  OrganizationId,
  SoftDeletableEntity,
  WorkspaceId,
} from "@repo/core";
import type { EntityStatus } from "../shared/status";

/**
 * Fields per docs/platform/03_WORKSPACE_MANAGEMENT.md.
 *
 * Workspace is the universal ownership/isolation boundary — every tenant
 * resource belongs to exactly one Workspace, and a Workspace belongs to
 * exactly one Organization.
 */
export type Workspace = SoftDeletableEntity<WorkspaceId> & {
  name: string;
  slug: string;
  description: string | null;
  organizationId: OrganizationId;
  status: EntityStatus;
  metadata: Metadata;
};

export type CreateWorkspaceInput = {
  name: string;
  slug: string;
  description?: string | null;
  organizationId: OrganizationId;
  metadata?: Metadata;
};

export type UpdateWorkspaceInput = {
  name?: string;
  description?: string | null;
  status?: EntityStatus;
  metadata?: Metadata;
};
