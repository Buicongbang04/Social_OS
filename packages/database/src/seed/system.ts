import {
  PERMISSIONS,
  WORKSPACE_ROLES,
  WORKSPACE_ROLE_PERMISSIONS,
} from "@repo/domain";
import type { DatabaseClient } from "../client";
import { permissions, rolePermissions, roles } from "../schema";

const ROLE_DESCRIPTIONS: Record<(typeof WORKSPACE_ROLES)[number], string> = {
  OWNER: "Toàn quyền Workspace",
  ADMIN: "Quản trị Workspace",
  DEVELOPER: "Tạo và chỉnh sửa tài nguyên",
  OPERATOR: "Thực thi và vận hành",
  VIEWER: "Chỉ xem",
  GUEST: "Quyền giới hạn",
};

/**
 * Mirror the permission catalog and workspace role matrix from @repo/domain
 * into the database. Idempotent — safe to re-run on every deploy.
 *
 * The database is the runtime source of truth for authorization; this seed is
 * what keeps it in step with the typed catalog, and `system.spec.ts` asserts
 * the two never drift.
 */
export async function seedSystemData(db: DatabaseClient): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .insert(permissions)
      .values(
        PERMISSIONS.map((permission) => ({
          key: permission.key,
          scope: permission.scope,
          resource: permission.resource,
          action: permission.action,
          description: permission.description,
        })),
      )
      .onConflictDoUpdate({
        target: permissions.key,
        set: {
          description: permissions.description,
          updatedAt: new Date(),
        },
      });

    await tx
      .insert(roles)
      .values(
        WORKSPACE_ROLES.map((key) => ({
          key,
          description: ROLE_DESCRIPTIONS[key],
        })),
      )
      .onConflictDoNothing();

    // Rebuild the mapping wholesale so a permission removed from a role in
    // code is actually removed in the database.
    await tx.delete(rolePermissions);

    const mappings = WORKSPACE_ROLES.flatMap((role) =>
      WORKSPACE_ROLE_PERMISSIONS[role].map((permissionKey) => ({
        roleKey: role,
        permissionKey,
      })),
    );

    if (mappings.length > 0) {
      await tx.insert(rolePermissions).values(mappings);
    }
  });
}
