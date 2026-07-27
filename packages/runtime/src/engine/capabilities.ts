import type { Metadata } from "@repo/core";
import { RuntimeError } from "../errors/taxonomy";
import type { CapabilityDescriptor } from "../ports";

/** What a capability receives when it runs. */
export type CapabilityContext = {
  inputs: Metadata;
  /** Outputs of every completed dependency, keyed by capability id. */
  previous: Readonly<Record<string, Metadata>>;
  attempt: number;
};

export type CapabilityHandler = (
  context: CapabilityContext,
) => Promise<Metadata>;

/**
 * A capability's descriptor plus the function that actually performs it.
 *
 * Splitting descriptor from handler is what lets the Planner reason about a
 * capability (does it exist? what does it cost?) without being able to run it,
 * and lets a Plugin or MCP server supply the handler later without the Planner
 * changing at all.
 */
export type CapabilityImplementation = {
  descriptor: CapabilityDescriptor;
  handler: CapabilityHandler;
};

export class CapabilityExecutor {
  private readonly implementations = new Map<string, CapabilityHandler>();

  register(implementation: CapabilityImplementation): void {
    this.implementations.set(
      implementation.descriptor.id,
      implementation.handler,
    );
  }

  has(capabilityId: string): boolean {
    return this.implementations.has(capabilityId);
  }

  /**
   * Runs a capability under a timeout.
   *
   * The timeout is enforced here rather than inside each handler so a
   * capability that hangs — an unresponsive HTTP call, an infinite loop —
   * cannot pin a worker slot forever.
   */
  async execute(
    capabilityId: string,
    context: CapabilityContext,
    timeoutMs: number,
  ): Promise<Metadata> {
    const handler = this.implementations.get(capabilityId);

    if (!handler) {
      throw new RuntimeError(
        "PLANNING",
        `No implementation registered for capability "${capabilityId}".`,
        { context: { capabilityId } },
      );
    }

    return withTimeout(handler(context), timeoutMs, capabilityId);
  }
}

async function withTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(
        // WORKER class → retryable: a timeout is usually transient, and the
        // next attempt may well succeed.
        new RuntimeError(
          "WORKER",
          `Capability "${label}" timed out after ${timeoutMs}ms.`,
          {
            context: { capabilityId: label, timeoutMs },
          },
        ),
      );
    }, timeoutMs);
  });

  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
