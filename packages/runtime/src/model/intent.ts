import type { ExecutionId, Metadata } from "@repo/core";

/**
 * Intent types, per docs/kernel/05_INTENT_ENGINE.md.
 * One Goal can yield several Intents ("find trends AND write a post").
 */
export const INTENT_TYPES = [
  "CHAT",
  "RESEARCH",
  "GENERATE_CONTENT",
  "GENERATE_IMAGE",
  "GENERATE_VIDEO",
  "PUBLISH",
  "AUTOMATION",
  "SCHEDULE",
  "KNOWLEDGE",
  "MEMORY",
  "ANALYTICS",
  "APPROVAL",
  "NOTIFICATION",
] as const;
export type IntentType = (typeof INTENT_TYPES)[number];

/**
 * Structured reading of one thing the user wants done.
 *
 * `entities` holds extracted values the doc names explicitly: platform, topic,
 * schedule, language, timezone. It is deliberately open — the extractor grows
 * without a type change.
 */
export type Intent = {
  id: string;
  executionId: ExecutionId;
  type: IntentType;
  /** snake_case verb from the doc's examples, e.g. "generate_content". */
  action: string;
  entities: Metadata;
  constraints: Metadata;
  /** 0..1. Below CONFIDENCE_THRESHOLD the runtime asks rather than guesses. */
  confidence: number;
  metadata: Metadata;
  timestamp: Date;
};

/**
 * The docs require low-confidence Intents to be escalated ("hỏi lại người
 * dùng / chọn Intent mặc định / chuyển Human Approval") but never give a
 * number. 0.5 is our choice: below an even chance of being right, acting
 * without asking is worse than asking.
 */
export const CONFIDENCE_THRESHOLD = 0.5;

export function isConfident(intent: Intent): boolean {
  return intent.confidence >= CONFIDENCE_THRESHOLD;
}

/**
 * Intent → Capability, per the doc's mapping table. Returns the capability id
 * a planner should schedule for this intent, or null when the intent needs no
 * capability of its own (CHAT is answered directly).
 */
export function capabilityForIntent(type: IntentType): string | null {
  return INTENT_CAPABILITY_MAP[type];
}

const INTENT_CAPABILITY_MAP: Readonly<Record<IntentType, string | null>> =
  Object.freeze({
    CHAT: null,
    RESEARCH: "research.trend",
    GENERATE_CONTENT: "content.generate",
    GENERATE_IMAGE: "media.generate-image",
    GENERATE_VIDEO: "media.generate-video",
    PUBLISH: "social.publish",
    AUTOMATION: "automation.run",
    SCHEDULE: "automation.schedule",
    KNOWLEDGE: "knowledge.search",
    MEMORY: "memory.search",
    ANALYTICS: "analytics.report",
    APPROVAL: "approval.request",
    NOTIFICATION: "notification.send",
  });
