import type {
  Metadata,
  OrganizationId,
  SoftDeletableEntity,
  UserId,
} from "@repo/core";
import type { EntityStatus } from "../shared/status";

/** Fields per docs/platform/05_ORGANIZATION.md. */
export type Organization = SoftDeletableEntity<OrganizationId> & {
  name: string;
  slug: string;
  description: string | null;
  ownerId: UserId;
  status: EntityStatus;
  metadata: Metadata;
};

export type CreateOrganizationInput = {
  name: string;
  slug: string;
  description?: string | null;
  ownerId: UserId;
  metadata?: Metadata;
};

export type UpdateOrganizationInput = {
  name?: string;
  description?: string | null;
  status?: EntityStatus;
  metadata?: Metadata;
};
