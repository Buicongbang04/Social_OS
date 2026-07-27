import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";
import type {
  CursorPage,
  CursorPageQuery,
  OrganizationId,
  UserId,
} from "@repo/core";
import { MAX_PAGE_LIMIT, newId } from "@repo/core";
import type {
  CreateOrganizationInput,
  Organization,
  OrganizationRepository,
  UpdateOrganizationInput,
} from "@repo/domain";
import type { DatabaseClient } from "../client";
import { organizationMemberships, organizations } from "../schema";

type OrganizationRow = typeof organizations.$inferSelect;

function toEntity(row: OrganizationRow): Organization {
  return {
    id: row.id as OrganizationId,
    name: row.name,
    slug: row.slug,
    description: row.description,
    ownerId: row.ownerId as UserId,
    status: row.status,
    metadata: row.metadata as Record<string, unknown>,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    version: row.version,
    deletedAt: row.deletedAt,
    deletedBy: row.deletedBy,
  };
}

export class DrizzleOrganizationRepository implements OrganizationRepository {
  constructor(private readonly db: DatabaseClient) {}

  async findByIdForUser(
    id: OrganizationId,
    userId: UserId,
  ): Promise<Organization | null> {
    const rows = await this.db
      .select({ organization: organizations })
      .from(organizations)
      .innerJoin(
        organizationMemberships,
        and(
          eq(organizationMemberships.organizationId, organizations.id),
          eq(organizationMemberships.userId, userId),
          eq(organizationMemberships.status, "ACTIVE"),
          isNull(organizationMemberships.deletedAt),
        ),
      )
      .where(and(eq(organizations.id, id), isNull(organizations.deletedAt)))
      .limit(1);

    return rows[0] ? toEntity(rows[0].organization) : null;
  }

  async findBySlug(slug: string): Promise<Organization | null> {
    const rows = await this.db
      .select()
      .from(organizations)
      .where(and(eq(organizations.slug, slug), isNull(organizations.deletedAt)))
      .limit(1);

    return rows[0] ? toEntity(rows[0]) : null;
  }

  async listForUser(
    userId: UserId,
    query: CursorPageQuery,
  ): Promise<CursorPage<Organization>> {
    const limit = Math.min(query.limit, MAX_PAGE_LIMIT);

    const rows = await this.db
      .select({ organization: organizations })
      .from(organizations)
      .innerJoin(
        organizationMemberships,
        and(
          eq(organizationMemberships.organizationId, organizations.id),
          eq(organizationMemberships.userId, userId),
          eq(organizationMemberships.status, "ACTIVE"),
          isNull(organizationMemberships.deletedAt),
        ),
      )
      .where(
        and(
          isNull(organizations.deletedAt),
          query.cursor ? lt(organizations.id, query.cursor) : undefined,
        ),
      )
      .orderBy(desc(organizations.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((row) => toEntity(row.organization));

    return {
      items,
      hasMore,
      nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
    };
  }

  /** Organization + its OWNER membership are created atomically. */
  async create(input: CreateOrganizationInput): Promise<Organization> {
    return this.db.transaction(async (tx) => {
      const organizationId = newId("organization");

      const rows = await tx
        .insert(organizations)
        .values({
          id: organizationId,
          name: input.name,
          slug: input.slug,
          description: input.description ?? null,
          ownerId: input.ownerId,
          status: "ACTIVE",
          metadata: input.metadata ?? {},
          createdBy: input.ownerId,
          updatedBy: input.ownerId,
        })
        .returning();

      const row = rows[0];
      if (!row) throw new Error("Insert returned no row");

      await tx.insert(organizationMemberships).values({
        id: newId("membership"),
        organizationId,
        userId: input.ownerId,
        role: "OWNER",
        status: "ACTIVE",
        createdBy: input.ownerId,
        updatedBy: input.ownerId,
      });

      return toEntity(row);
    });
  }

  async update(
    id: OrganizationId,
    expectedVersion: number,
    input: UpdateOrganizationInput,
    actorId: UserId,
  ): Promise<Organization | null> {
    const rows = await this.db
      .update(organizations)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
        updatedBy: actorId,
        updatedAt: new Date(),
        version: sql`${organizations.version} + 1`,
      })
      .where(
        and(
          eq(organizations.id, id),
          eq(organizations.version, expectedVersion),
          isNull(organizations.deletedAt),
        ),
      )
      .returning();

    return rows[0] ? toEntity(rows[0]) : null;
  }
}
