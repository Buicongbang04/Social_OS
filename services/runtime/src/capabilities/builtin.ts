import { RuntimeError, type CapabilityImplementation } from "@repo/runtime";

/**
 * Deterministic capabilities for Phase 1.
 *
 * These are NOT the real thing. `content.generate` does not call an LLM and
 * `social.publish` does not call Facebook — those arrive in Phase 2 and Phase 3
 * respectively (docs/ROADMAP.md). What they do is exercise every path the
 * runtime has to get right: producing output, consuming an upstream task's
 * output, failing transiently, and failing permanently.
 *
 * Keeping them deterministic is deliberate: a scheduling or retry bug found
 * here is unambiguously a runtime bug.
 */

export const researchTrend: CapabilityImplementation = {
  descriptor: {
    id: "research.trend",
    name: "Research Trend",
    version: "0.1.0",
    category: "Research",
    supportedWorkers: ["FUNCTION"],
    permissions: ["workspace.workflow.execute"],
  },
  handler: async (context) => {
    const objective = String(context.inputs.objective ?? "");
    return {
      trends: ["ai-agents", "multi-modal", "on-device-inference"],
      source: "stub",
      derivedFrom: objective.slice(0, 120),
    };
  },
};

export const contentGenerate: CapabilityImplementation = {
  descriptor: {
    id: "content.generate",
    name: "Generate Content",
    version: "0.1.0",
    category: "AI",
    supportedWorkers: ["FUNCTION"],
    permissions: ["workspace.workflow.execute"],
  },
  handler: async (context) => {
    // Reads the upstream task's output — this is what proves dependency
    // ordering actually delivered data, not just ran in sequence.
    const research = context.previous["research.trend"];
    const trends = Array.isArray(research?.trends)
      ? (research.trends as string[])
      : [];

    return {
      title: trends.length > 0 ? `Xu hướng: ${trends[0]}` : "Bài viết",
      body:
        trends.length > 0
          ? `Nội dung về ${trends.join(", ")}.`
          : "Nội dung mặc định.",
      usedResearch: trends.length > 0,
    };
  },
};

export const mediaGenerateImage: CapabilityImplementation = {
  descriptor: {
    id: "media.generate-image",
    name: "Generate Image",
    version: "0.1.0",
    category: "Media",
    supportedWorkers: ["FUNCTION"],
    permissions: ["workspace.workflow.execute"],
  },
  handler: async (context) => {
    const content = context.previous["content.generate"];
    return { url: "stub://image.png", alt: String(content?.title ?? "image") };
  },
};

export const approvalRequest: CapabilityImplementation = {
  descriptor: {
    id: "approval.request",
    name: "Request Approval",
    version: "0.1.0",
    category: "Automation",
    supportedWorkers: ["FUNCTION"],
    permissions: ["workspace.workflow.execute"],
  },
  handler: async () => ({ approved: true, approver: "stub" }),
};

export const socialPublish: CapabilityImplementation = {
  descriptor: {
    id: "social.publish",
    name: "Publish to Social",
    version: "0.1.0",
    category: "Social",
    supportedWorkers: ["FUNCTION"],
    permissions: ["workspace.workflow.execute"],
  },
  handler: async (context) => {
    const content = context.previous["content.generate"];
    return {
      published: true,
      platform: context.inputs.platforms ?? ["stub"],
      title: content?.title ?? null,
    };
  },
};

export const notificationSend: CapabilityImplementation = {
  descriptor: {
    id: "notification.send",
    name: "Send Notification",
    version: "0.1.0",
    category: "Notification",
    supportedWorkers: ["FUNCTION"],
    permissions: ["workspace.workflow.execute"],
  },
  handler: async () => ({ sent: true }),
};

/**
 * Fails on the first attempt, succeeds afterwards.
 *
 * Exists so retry can be proven end to end against real state and a real
 * queue backoff, rather than asserted from a unit test of the policy table.
 */
export const flakyOnce: CapabilityImplementation = {
  descriptor: {
    id: "test.flaky-once",
    name: "Flaky Once",
    version: "0.1.0",
    category: "Automation",
    supportedWorkers: ["FUNCTION"],
    permissions: [],
  },
  handler: async (context) => {
    if (context.attempt < 1) {
      // NETWORK is an ALWAYS-retry class, so the engine will schedule another go.
      throw new RuntimeError(
        "NETWORK",
        "Simulated transient failure on first attempt.",
      );
    }
    return { recovered: true, attempt: context.attempt };
  },
};

/** Always fails with a retryable error, to prove retries are bounded. */
export const alwaysFails: CapabilityImplementation = {
  descriptor: {
    id: "test.always-fails",
    name: "Always Fails",
    version: "0.1.0",
    category: "Automation",
    supportedWorkers: ["FUNCTION"],
    permissions: [],
  },
  handler: async () => {
    throw new RuntimeError("NETWORK", "Simulated permanent outage.");
  },
};

export const BUILTIN_CAPABILITIES: readonly CapabilityImplementation[] = [
  researchTrend,
  contentGenerate,
  mediaGenerateImage,
  approvalRequest,
  socialPublish,
  notificationSend,
  flakyOnce,
  alwaysFails,
];
