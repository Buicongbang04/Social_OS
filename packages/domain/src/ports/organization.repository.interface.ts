import type {
  CursorPage,
  CursorPageQuery,
  OrganizationId,
  UserId,
} from "@repo/core";
import type {
  CreateOrganizationInput,
  Organization,
  UpdateOrganizationInput,
} from "../entities/organization.entity";

export interface OrganizationRepository {
  findByIdForUser(
    id: OrganizationId,
    userId: UserId,
  ): Promise<Organization | null>;

  findBySlug(slug: string): Promise<Organization | null>;

  listForUser(
    userId: UserId,
    query: CursorPageQuery,
  ): Promise<CursorPage<Organization>>;

  /** Creates the organization plus its OWNER membership atomically. */
  create(input: CreateOrganizationInput): Promise<Organization>;

  update(
    id: OrganizationId,
    expectedVersion: number,
    input: UpdateOrganizationInput,
    actorId: UserId,
  ): Promise<Organization | null>;
}
