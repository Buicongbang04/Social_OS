import { describe, expect, it } from "vitest";
import type { ExecutionId, GoalId, UserId, WorkspaceId } from "@repo/core";
import { isConfident, type Intent } from "../model/intent";
import type { Goal } from "../model/goal";
import { KeywordIntentAnalyzer } from "./keyword-analyzer";

const EXECUTION_ID = "exe_01HX8ZQ7P9K2M4N6R8T0V2W4Y6" as ExecutionId;

function goal(objective: string, overrides: Partial<Goal> = {}): Goal {
  return {
    id: "gol_01HX8ZQ7P9K2M4N6R8T0V2W4Y6" as GoalId,
    workspaceId: "wsp_01HX8ZQ7P9K2M4N6R8T0V2W4A1" as WorkspaceId,
    ownerId: "usr_01HX8ZQ7P9K2M4N6R8T0V2W4Y6" as UserId,
    title: "Test goal",
    objective,
    description: null,
    type: "CONTENT",
    priority: "NORMAL",
    constraints: {},
    inputs: {},
    outputs: [],
    schedule: null,
    status: "CREATED",
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: null,
    updatedBy: null,
    version: 1,
    ...overrides,
  };
}

const analyzer = new KeywordIntentAnalyzer();
const typesOf = (intents: readonly Intent[]) =>
  intents.map((intent) => intent.type).sort();

describe("KeywordIntentAnalyzer", () => {
  it("reads the multi-step objective from the product docs", async () => {
    // The example that appears throughout docs/00_VISION.md and the PRD.
    const intents = await analyzer.analyze(
      goal(
        "Tìm xu hướng AI mới, viết 5 bài Facebook, tạo hình ảnh minh họa, gửi Leader duyệt, sau đó đăng lên Facebook",
      ),
      EXECUTION_ID,
    );

    expect(typesOf(intents)).toEqual([
      "APPROVAL",
      "GENERATE_CONTENT",
      "GENERATE_IMAGE",
      "PUBLISH",
      "RESEARCH",
    ]);
  });

  it("extracts the platforms mentioned", async () => {
    const intents = await analyzer.analyze(
      goal("Viết bài rồi đăng lên facebook và telegram"),
      EXECUTION_ID,
    );

    expect(intents[0]!.entities.platforms).toEqual(["facebook", "telegram"]);
  });

  it("carries the goal's constraints onto every intent", async () => {
    const intents = await analyzer.analyze(
      goal("Viết bài và đăng", { constraints: { language: "vi", retry: 5 } }),
      EXECUTION_ID,
    );

    for (const intent of intents) {
      expect(intent.constraints).toMatchObject({ language: "vi", retry: 5 });
    }
    expect(intents[0]!.entities.language).toBe("vi");
  });

  it("picks up a stated time of day", async () => {
    const intents = await analyzer.analyze(
      goal("Mỗi sáng 08:00 viết bài"),
      EXECUTION_ID,
    );
    expect(intents[0]!.entities.time).toBe("08:00");
  });

  it("includes the schedule when the goal is recurring", async () => {
    const intents = await analyzer.analyze(
      goal("Viết bài", {
        schedule: { cron: "0 8 * * *", timezone: "Asia/Ho_Chi_Minh" },
      }),
      EXECUTION_ID,
    );

    expect(intents[0]!.entities.schedule).toBe("0 8 * * *");
    expect(intents[0]!.entities.timezone).toBe("Asia/Ho_Chi_Minh");
  });

  it("falls back to CHAT with low confidence when nothing is recognised", async () => {
    // Falling back rather than failing keeps a strange objective answerable;
    // the low confidence is what tells the caller to escalate.
    const intents = await analyzer.analyze(goal("xyzzy plugh"), EXECUTION_ID);

    expect(intents).toHaveLength(1);
    expect(intents[0]!.type).toBe("CHAT");
    expect(isConfident(intents[0]!)).toBe(false);
  });

  it("reports confident — but never certain — on a keyword match", async () => {
    // Keyword matching cannot see intent that was only implied, so it must not
    // claim certainty it has not earned.
    const intents = await analyzer.analyze(
      goal("Viết một bài về AI"),
      EXECUTION_ID,
    );

    expect(isConfident(intents[0]!)).toBe(true);
    expect(intents[0]!.confidence).toBeLessThan(1);
  });

  it("stamps every intent with the execution it belongs to", async () => {
    const intents = await analyzer.analyze(
      goal("Tìm hiểu xu hướng và viết bài"),
      EXECUTION_ID,
    );
    for (const intent of intents) {
      expect(intent.executionId).toBe(EXECUTION_ID);
    }
  });

  it("recognises English objectives too", async () => {
    const intents = await analyzer.analyze(
      goal("Research AI trends then write a post and publish it"),
      EXECUTION_ID,
    );

    expect(typesOf(intents)).toEqual([
      "GENERATE_CONTENT",
      "PUBLISH",
      "RESEARCH",
    ]);
  });
});
