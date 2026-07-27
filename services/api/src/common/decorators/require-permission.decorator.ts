import { SetMetadata } from "@nestjs/common";
import type { PermissionKey } from "@repo/domain";

export const REQUIRED_PERMISSION_KEY = "auth:requiredPermission";

/**
 * Declares the permission a route requires.
 *
 * The parameter is typed as `PermissionKey`, so a typo or a permission that
 * is not in the catalog fails to compile rather than silently never matching:
 *
 *   @RequirePermission("workspace.workflow.execute")   // ok
 *   @RequirePermission("workspace.workflow.teleport")  // compile error
 *
 * The scope segment also drives which id the guard looks for — `workspace.*`
 * resolves a workspace id from the route, `organization.*` an organization id.
 */
export const RequirePermission = (permission: PermissionKey) =>
  SetMetadata(REQUIRED_PERMISSION_KEY, permission);
