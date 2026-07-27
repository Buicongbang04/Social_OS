import type {
  PolicyContext,
  PolicyDecision,
  PolicyEvaluator,
  SpendReader,
} from "../ports";

export type BudgetPolicyOptions = {
  spend: SpendReader;
  /**
   * Applied when a Goal states no budget of its own. Null means unlimited,
   * which is the current default: inventing a ceiling nobody asked for would
   * fail runs that were always meant to be expensive. A workspace-level
   * default belongs in workspace policy, which does not exist yet.
   */
  defaultMaxCostUsd?: number | null;
};

/**
 * Stops a run from spending more than its Goal allowed.
 *
 * Two checks, and the second is the one that matters. At plan time the only
 * figure available is an estimate, and an estimate that is wrong in the cheap
 * direction protects nothing. Before each task the actual spend so far is
 * known, so a run that drifts past its ceiling is stopped at the next step
 * rather than at the end.
 *
 * Deliberately not an LLM call, per docs/kernel/08_POLICY_ENGINE.md: an
 * authorization outcome has to be reproducible and auditable.
 */
export class BudgetPolicy implements PolicyEvaluator {
  constructor(private readonly options: BudgetPolicyOptions) {}

  async evaluate(context: PolicyContext): Promise<PolicyDecision> {
    const budget = this.budgetFor(context);
    if (budget === null) return { outcome: "ALLOW" };

    const spent = await this.options.spend.spentUsd(context.execution.id);

    // Compared as integers, never as floats. `5 - 4.98` is 0.019999999999999574
    // in binary floating point, which refuses a step costing exactly 0.02 by
    // four parts in 10^16 — and in the other direction would wave through a
    // step that does not fit. Money comparisons have to be exact, the same
    // reason the cost column is `numeric` rather than double precision.
    const spentUnits = toUnits(spent);
    const budgetUnits = toUnits(budget);

    // Already over. Stopping here is the whole point: the next task would
    // spend money the workspace did not authorise.
    if (spentUnits >= budgetUnits) {
      return {
        outcome: "DENY",
        code: "BUDGET_EXCEEDED",
        reason: `This run has spent $${spent.toFixed(4)} of its $${budget.toFixed(2)} budget.`,
      };
    }

    // Refuse a step whose own estimate cannot fit in what is left. Letting it
    // start and killing it mid-flight would still incur the provider charge.
    const remainingUnits = budgetUnits - spentUnits;
    if (toUnits(context.estimatedCostUsd) > remainingUnits) {
      return {
        outcome: "DENY",
        code: "BUDGET_WOULD_EXCEED",
        reason: `${context.capabilityId} is estimated at $${context.estimatedCostUsd.toFixed(4)} but only $${fromUnits(remainingUnits).toFixed(4)} of the budget remains.`,
      };
    }

    return { outcome: "ALLOW" };
  }

  private budgetFor(context: PolicyContext): number | null {
    const stated = context.goal.constraints.maxCostUsd;
    if (typeof stated === "number") return stated;
    return this.options.defaultMaxCostUsd ?? null;
  }
}

/**
 * USD as an integer, at the eight decimal places the cost column stores.
 *
 * A budget of $90,000,000 is still well inside Number.MAX_SAFE_INTEGER at this
 * scale, and the API caps `maxCostUsd` at 10,000 — so the conversion cannot
 * lose precision for any value that can reach here.
 */
const UNITS_PER_USD = 100_000_000;

function toUnits(usd: number): number {
  return Math.round(usd * UNITS_PER_USD);
}

function fromUnits(units: number): number {
  return units / UNITS_PER_USD;
}
