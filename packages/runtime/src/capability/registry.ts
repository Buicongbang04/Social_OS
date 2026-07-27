import { RuntimeError } from "../errors/taxonomy";
import type { CapabilityDescriptor, CapabilityRegistry } from "../ports";

/**
 * In-memory Capability Registry.
 *
 * Core capabilities, Plugin capabilities and MCP tools all land here through
 * the same `register` call — the engine deliberately cannot tell them apart
 * (docs/kernel/07_CAPABILITY_ENGINE.md), which is what lets a plugin extend
 * the system without the Planner knowing plugins exist.
 */
export class InMemoryCapabilityRegistry implements CapabilityRegistry {
  private readonly descriptors = new Map<string, CapabilityDescriptor>();

  register(descriptor: CapabilityDescriptor): void {
    assertValidCapabilityId(descriptor.id);

    // Re-registering the same id would let a plugin silently shadow a core
    // capability — the caller must remove it first if that is really intended.
    if (this.descriptors.has(descriptor.id)) {
      throw new RuntimeError(
        "PLANNING",
        `Capability "${descriptor.id}" is already registered.`,
        { context: { capabilityId: descriptor.id } },
      );
    }

    this.descriptors.set(descriptor.id, Object.freeze({ ...descriptor }));
  }

  get(capabilityId: string): CapabilityDescriptor | null {
    return this.descriptors.get(capabilityId) ?? null;
  }

  has(capabilityId: string): boolean {
    return this.descriptors.has(capabilityId);
  }

  list(): readonly CapabilityDescriptor[] {
    return [...this.descriptors.values()];
  }

  /** Present so a plugin can be unloaded; not part of the port. */
  unregister(capabilityId: string): boolean {
    return this.descriptors.delete(capabilityId);
  }
}

/** `category.action`, lowercase, dot-separated — see CapabilityDescriptor. */
const CAPABILITY_ID_PATTERN = /^[a-z][a-z0-9]*(?:\.[a-z0-9][a-z0-9-]*)+$/;

export function assertValidCapabilityId(capabilityId: string): void {
  if (!CAPABILITY_ID_PATTERN.test(capabilityId)) {
    throw new RuntimeError(
      "PLANNING",
      `Invalid capability id "${capabilityId}": expected lowercase dotted form, e.g. "content.generate".`,
      { context: { capabilityId } },
    );
  }
}
