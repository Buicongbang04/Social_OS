import type {
  CursorPage,
  CursorPageQuery,
  OrganizationId,
  UserId,
  WorkspaceId,
} from "@repo/core";
import type {
  CreateWorkspaceInput,
  UpdateWorkspaceInput,
  Workspace,
} from "../entities/workspace.entity";

/**
 * Repository port. The concrete Drizzle implementation lives in
 * @repo/database; services depend on this interface so they can be unit
 * tested without a database.
 */
export interface WorkspaceRepository {
  /**
   * Look up a workspace the given user may see. `userId` is mandatory rather
   * than optional so a caller cannot accidentally fetch across tenants — a
   * workspace the user has no membership in resolves to null (surfaced as 404,
   * never 403, so foreign tenants' existence is not leaked).
   */
  findByIdForUser(id: WorkspaceId, userId: UserId): Promise<Workspace | null>;

  findBySlug(
    organizationId: OrganizationId,
    slug: string,
  ): Promise<Workspace | null>;

  /** Only workspaces the user is an active member of. */
  listForUser(
    userId: UserId,
    query: CursorPageQuery,
  ): Promise<CursorPage<Workspace>>;

  create(input: CreateWorkspaceInput, actorId: UserId): Promise<Workspace>;

  /**
   * Compare-and-swap on `version`; resolves to null when the expected version
   * no longer matches so the caller can raise 409 VERSION_CONFLICT.
   */
  update(
    id: WorkspaceId,
    expectedVersion: number,
    input: UpdateWorkspaceInput,
    actorId: UserId,
  ): Promise<Workspace | null>;

  softDelete(
    id: WorkspaceId,
    expectedVersion: number,
    actorId: UserId,
  ): Promise<boolean>;
}
