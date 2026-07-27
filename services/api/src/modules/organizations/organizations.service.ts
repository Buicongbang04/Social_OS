import { Inject, Injectable } from "@nestjs/common";
import type { CursorPage, OrganizationId, UserId } from "@repo/core";
import { ConflictError, NotFoundError } from "@repo/core";
import type { Organization, OrganizationRepository } from "@repo/domain";
import { canTransitionEntityStatus } from "@repo/domain";
import { ORGANIZATION_REPOSITORY } from "../../infra/database/database.module";
import { PermissionService } from "../authorization/permission.service";
import type { ListQuery } from "../workspaces/workspaces.dto";
import type {
  CreateOrganizationBody,
  UpdateOrganizationBody,
} from "./organizations.dto";

@Injectable()
export class OrganizationsService {
  constructor(
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizations: OrganizationRepository,
    private readonly permissions: PermissionService,
  ) {}

  /** Not a member → 404, so a foreign organization's existence is not leaked. */
  async getForUser(
    organizationId: OrganizationId,
    userId: UserId,
  ): Promise<Organization> {
    const organization = await this.organizations.findByIdForUser(
      organizationId,
      userId,
    );
    if (!organization) throw notFound();
    return organization;
  }

  async listForUser(
    userId: UserId,
    query: ListQuery,
  ): Promise<CursorPage<Organization>> {
    return this.organizations.listForUser(userId, query);
  }

  /**
   * Any authenticated user may create an organization — it is the entry point
   * into the tenant model, so there is no pre-existing scope to check against.
   * The creator becomes OWNER inside the repository transaction.
   */
  async create(
    body: CreateOrganizationBody,
    actorId: UserId,
  ): Promise<Organization> {
    const existing = await this.organizations.findBySlug(body.slug);
    if (existing) {
      throw new ConflictError(
        "An organization with this slug already exists.",
        "ORGANIZATION_SLUG_TAKEN",
      );
    }

    const organization = await this.organizations.create({
      name: body.name,
      slug: body.slug,
      description: body.description ?? null,
      ownerId: actorId,
    });

    await this.permissions.invalidateOrganization(organization.id, actorId);

    return organization;
  }

  async update(
    organizationId: OrganizationId,
    body: UpdateOrganizationBody,
    actorId: UserId,
  ): Promise<Organization> {
    const current = await this.getForUser(organizationId, actorId);

    if (body.status && body.status !== current.status) {
      if (!canTransitionEntityStatus(current.status, body.status)) {
        throw new ConflictError(
          `Cannot change status from ${current.status} to ${body.status}.`,
          "INVALID_STATUS_TRANSITION",
        );
      }
    }

    const updated = await this.organizations.update(
      organizationId,
      body.version,
      { name: body.name, description: body.description, status: body.status },
      actorId,
    );

    if (!updated) {
      throw new ConflictError(
        "This organization was modified by someone else. Reload and try again.",
        "VERSION_CONFLICT",
      );
    }

    return updated;
  }
}

function notFound(): NotFoundError {
  return new NotFoundError("Organization not found.", "ORGANIZATION_NOT_FOUND");
}
