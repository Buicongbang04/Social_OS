import { Injectable } from "@nestjs/common";
import type { WorkspaceId } from "@repo/core";

/**
 * Says when a workspace's stored credentials have changed.
 *
 * Its only reason to exist is to break a dependency cycle: whoever caches a
 * resolved secret needs to hear from whoever writes one, and if they injected
 * each other directly neither could be constructed. This object depends on
 * nothing, so both can hold it.
 *
 * In-process only, and that limit is real: with more than one API instance
 * running, revoking a key here clears the cache here and nowhere else. What
 * bounds the damage is the cache's own expiry, not this — see
 * `WorkspaceGatewayFactory`.
 */
@Injectable()
export class SecretChanges {
  private readonly listeners = new Set<(workspaceId: WorkspaceId) => void>();

  onChange(listener: (workspaceId: WorkspaceId) => void): void {
    this.listeners.add(listener);
  }

  changed(workspaceId: WorkspaceId): void {
    for (const listener of this.listeners) listener(workspaceId);
  }
}
