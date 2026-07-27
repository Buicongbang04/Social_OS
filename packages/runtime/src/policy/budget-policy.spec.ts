import type { ExecutionId, GoalId, WorkspaceId } from "@repo/core";
import { describe, expect, it } from "vitest";
import type { Execution } from "../model/execution";
import type { Goal, GoalConstraints } from "../model/goal";
import type { PolicyContext } from "../ports";
import { BudgetPolicy } from "./budget-policy";

const WORKSPACE = "wsp_01HX8ZQ7P9K2M4N6R8T0V2W4Y6" as WorkspaceId;
const GOAL_ID = "gol_01HX8ZQ7P9K2M4N6R8T0V2W4Y8" as GoalId;
const EXECUTION_ID = "exe_01HX8ZQ7P9K2M4N6R8T0V2W4Y9" as ExecutionId;

function contextWith(
  constraints: GoalConstraints,
  estimatedCostUsd = 0,
): PolicyContext {
  const goal = { id: GOAL_ID, constraints } as Goal;
  const execution = { id: EXECUTION_ID, workspaceId: WORKSPACE } as Execution;

  return {
    workspaceId: WORKSPACE,
    execution,
    goal,
    capabilityId: "content.generate",
    estimatedCostUsd,
  };
}

const spendOf = (usd: number) => ({ spentUsd: async () => usd });

describe("BudgetPolicy", () => {
  it("allows a run whose Goal states no budget", async () => {
    // Inventing a ceiling nobody asked for would fail runs that were always
    // meant to be expensive.
    const policy = new BudgetPolicy({ spend: spendOf(999) });

    expect(await policy.evaluate(contextWith({}))).toEqual({
      outcome: "ALLOW",
    });
  });

  it("allows a run still inside its budget", async () => {
    const policy = new BudgetPolicy({ spend: spendOf(0.5) });

    expect(await policy.evaluate(contextWith({ maxCostUsd: 5 }))).toEqual({
      outcome: "ALLOW",
    });
  });

  it("stops a run that has already spent its budget", async () => {
    // This is the check that actually protects: a plan-time estimate that was
    // wrong in the cheap direction protects nothing.
    const policy = new BudgetPolicy({ spend: spendOf(5.2) });

    const decision = await policy.evaluate(contextWith({ maxCostUsd: 5 }));

    expect(decision.outcome).toBe("DENY");
    expect(decision).toMatchObject({ code: "BUDGET_EXCEEDED" });
  });

  it("treats spending exactly the budget as spent", async () => {
    // Off-by-one here means every budget is silently one call larger than it
    // says, and the last call is the one nobody authorised.
    const policy = new BudgetPolicy({ spend: spendOf(5) });

    expect(
      (await policy.evaluate(contextWith({ maxCostUsd: 5 }))).outcome,
    ).toBe("DENY");
  });

  it("refuses a step that cannot fit in what is left", async () => {
    // Starting it and killing it mid-flight would still incur the charge.
    const policy = new BudgetPolicy({ spend: spendOf(4.99) });

    const decision = await policy.evaluate(
      contextWith({ maxCostUsd: 5 }, 0.02),
    );

    expect(decision).toMatchObject({ code: "BUDGET_WOULD_EXCEED" });
  });

  it("allows a step that fits exactly in what is left", async () => {
    const policy = new BudgetPolicy({ spend: spendOf(4.98) });

    expect(
      (await policy.evaluate(contextWith({ maxCostUsd: 5 }, 0.02))).outcome,
    ).toBe("ALLOW");
  });

  it("says how much was spent and how much was allowed", async () => {
    // A denial a user cannot act on is barely better than a silent stop.
    const policy = new BudgetPolicy({ spend: spendOf(7.5) });

    const decision = await policy.evaluate(contextWith({ maxCostUsd: 5 }));

    expect("reason" in decision && decision.reason).toContain("7.5");
    expect("reason" in decision && decision.reason).toContain("5.00");
  });

  it("applies a configured default when the Goal is silent", async () => {
    const policy = new BudgetPolicy({
      spend: spendOf(2),
      defaultMaxCostUsd: 1,
    });

    expect((await policy.evaluate(contextWith({}))).outcome).toBe("DENY");
  });

  it("lets the Goal's own budget override the default", async () => {
    const policy = new BudgetPolicy({
      spend: spendOf(2),
      defaultMaxCostUsd: 1,
    });

    expect(
      (await policy.evaluate(contextWith({ maxCostUsd: 10 }))).outcome,
    ).toBe("ALLOW");
  });

  it("treats a zero budget as spending nothing at all", async () => {
    // Zero has to mean zero, not "unlimited because it is falsy" — that is a
    // classic bug and it fails open, in the direction that costs money.
    const policy = new BudgetPolicy({ spend: spendOf(0) });

    expect(
      (await policy.evaluate(contextWith({ maxCostUsd: 0 }))).outcome,
    ).toBe("DENY");
  });
});
