import { newId, type ExecutionId } from "@repo/core";
import type { Goal } from "../model/goal";
import type { Intent, IntentType } from "../model/intent";
import type { IntentAnalyzer } from "../ports";

/**
 * Deterministic Intent Engine for Phase 1.
 *
 * AI Providers arrive in Phase 2 (docs/ROADMAP.md), so the runtime has to be
 * driveable — and testable — without one. This reads the objective with
 * keyword rules instead of a model. It is genuinely limited: it will not infer
 * an unstated step or resolve an ambiguous pronoun. What it does give is a
 * fully deterministic pipeline, so every scheduling, retry and state bug found
 * from here on is a runtime bug rather than model noise.
 *
 * Phase 2 replaces this class only — the IntentAnalyzer port stays put.
 */
type Rule = {
  type: IntentType;
  action: string;
  /** Matched against the lower-cased objective. */
  keywords: readonly string[];
};

/**
 * Order matters: the first matching rule wins per type, and more specific
 * intents are listed before the generic ones they would otherwise be
 * swallowed by (publishing before generic content, image before text).
 */
const RULES: readonly Rule[] = [
  {
    type: "RESEARCH",
    action: "research_trend",
    keywords: [
      "tìm xu hướng",
      "xu hướng",
      "nghiên cứu",
      "trend",
      "research",
      "tìm hiểu",
    ],
  },
  {
    type: "GENERATE_IMAGE",
    action: "generate_image",
    keywords: [
      "tạo ảnh",
      "tạo hình",
      "hình ảnh",
      "ảnh minh họa",
      "image",
      "picture",
    ],
  },
  {
    type: "GENERATE_VIDEO",
    action: "generate_video",
    keywords: ["tạo video", "làm video", "video", "clip"],
  },
  {
    type: "APPROVAL",
    action: "request_approval",
    keywords: ["duyệt", "phê duyệt", "approval", "approve"],
  },
  {
    type: "PUBLISH",
    action: "publish_post",
    keywords: ["đăng", "đăng bài", "publish", "post lên", "xuất bản"],
  },
  {
    type: "GENERATE_CONTENT",
    action: "generate_content",
    keywords: [
      "viết",
      "soạn",
      "content",
      "bài viết",
      "write",
      "draft",
      "caption",
    ],
  },
  {
    type: "NOTIFICATION",
    action: "send_notification",
    keywords: ["thông báo", "gửi tin", "notify", "notification"],
  },
  {
    type: "ANALYTICS",
    action: "generate_report",
    keywords: ["báo cáo", "thống kê", "analytics", "report"],
  },
];

/** Platform names the entity extractor recognises, per the doc's examples. */
const PLATFORMS = [
  "facebook",
  "instagram",
  "threads",
  "tiktok",
  "youtube",
  "telegram",
  "whatsapp",
  "zalo",
  "lark",
] as const;

/** `08:00`, `8h`, `8 giờ` — enough to spot a stated time of day. */
const TIME_PATTERN = /\b(\d{1,2})[:h giờ]{1,4}(\d{2})?\b/;

export class KeywordIntentAnalyzer implements IntentAnalyzer {
  async analyze(
    goal: Goal,
    executionId: ExecutionId,
  ): Promise<readonly Intent[]> {
    const objective = goal.objective.toLowerCase();
    const timestamp = new Date();

    const entities = this.extractEntities(objective, goal);
    const matched = RULES.filter((rule) =>
      rule.keywords.some((keyword) => objective.includes(keyword)),
    );

    // Nothing recognised — fall back to CHAT rather than failing outright, and
    // say so with a low confidence the caller can escalate on.
    if (matched.length === 0) {
      return [
        this.build({
          executionId,
          type: "CHAT",
          action: "chat",
          entities,
          goal,
          confidence: 0.3,
          timestamp,
        }),
      ];
    }

    return matched.map((rule) =>
      this.build({
        executionId,
        type: rule.type,
        action: rule.action,
        entities,
        goal,
        // Keyword matching is exact, but it cannot see intent the user only
        // implied — so this is deliberately short of certainty.
        confidence: 0.8,
        timestamp,
      }),
    );
  }

  private extractEntities(
    objective: string,
    goal: Goal,
  ): Record<string, unknown> {
    const entities: Record<string, unknown> = {};

    const platforms = PLATFORMS.filter((platform) =>
      objective.includes(platform),
    );
    if (platforms.length > 0) {
      entities.platforms = platforms;
    }

    const time = TIME_PATTERN.exec(objective);
    if (time) {
      entities.time = time[0];
    }

    if (goal.constraints.language) {
      entities.language = goal.constraints.language;
    }
    if (goal.schedule) {
      entities.schedule = goal.schedule.cron;
      entities.timezone = goal.schedule.timezone;
    }

    return entities;
  }

  private build(input: {
    executionId: ExecutionId;
    type: IntentType;
    action: string;
    entities: Record<string, unknown>;
    goal: Goal;
    confidence: number;
    timestamp: Date;
  }): Intent {
    return {
      id: newId("event"),
      executionId: input.executionId,
      type: input.type,
      action: input.action,
      entities: input.entities,
      constraints: { ...input.goal.constraints },
      confidence: input.confidence,
      metadata: { analyzer: "keyword", goalId: input.goal.id },
      timestamp: input.timestamp,
    };
  }
}
