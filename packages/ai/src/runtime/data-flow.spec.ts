import { describe, expect, it } from "vitest";
import { enforceDataFlow, type FlowStep } from "./data-flow";

const step = (capability: string, dependsOn: number[] = []): FlowStep => ({
  capability,
  dependsOn,
});

/** The plan as capability ids, in the order it will run. */
const order = (steps: FlowStep[]) =>
  enforceDataFlow(steps).steps.map((s) => s.capability);

/** Which capabilities each step waits for, by name. */
function waits(steps: FlowStep[]): Record<string, string[]> {
  const flow = enforceDataFlow(steps);
  return Object.fromEntries(
    flow.steps.map((s, index) => [
      s.capability,
      (flow.dependsOn[index] ?? []).map((i) => flow.steps[i]!.capability),
    ]),
  );
}

describe("enforceDataFlow", () => {
  it("leaves a plan that already declares its dependencies alone", () => {
    const steps = [
      step("research.trend"),
      step("content.generate", [0]),
      step("social.publish", [1]),
    ];

    const flow = enforceDataFlow(steps);

    expect(flow.steps.map((s) => s.capability)).toEqual([
      "research.trend",
      "content.generate",
      "social.publish",
    ]);
    expect(flow.dependsOn).toEqual([[], [0], [1]]);
    expect(flow.addedEdges).toBe(0);
  });

  it("makes publishing wait for the content, even when the model said nothing", () => {
    // The failure this guards against — not one that has been observed, but
    // one with no symptom if it happens: the steps run in parallel, publish
    // fires with nothing to publish, and the execution reports COMPLETED.
    const steps = [step("content.generate"), step("social.publish")];

    expect(waits(steps)["social.publish"]).toEqual(["content.generate"]);
    expect(enforceDataFlow(steps).addedEdges).toBe(1);
  });

  it("reorders a producer that the model put after its consumer", () => {
    // Adding the edge alone would point forwards, which is a cycle — so the
    // producer has to move ahead of the consumer first.
    const steps = [
      step("knowledge.search"),
      step("social.publish"),
      step("content.generate"),
    ];

    expect(order(steps)).toEqual([
      "knowledge.search",
      "content.generate",
      "social.publish",
    ]);
    expect(waits(steps)["content.generate"]).toEqual(["knowledge.search"]);
    expect(waits(steps)["social.publish"]).toEqual(["content.generate"]);
  });

  it("feeds retrieved passages to the writer", () => {
    const steps = [step("knowledge.search"), step("content.generate")];

    expect(waits(steps)["content.generate"]).toEqual(["knowledge.search"]);
  });

  it("makes the writer wait for both gathering steps", () => {
    const steps = [
      step("research.trend"),
      step("knowledge.search"),
      step("content.generate"),
    ];

    expect(waits(steps)["content.generate"]).toEqual([
      "research.trend",
      "knowledge.search",
    ]);
  });

  it("makes publishing wait for the approval gate", () => {
    // An approval step the publish step does not wait on is decoration.
    const steps = [
      step("content.generate"),
      step("approval.request"),
      step("social.publish"),
    ];

    expect(waits(steps)["social.publish"]).toContain("approval.request");
    expect(waits(steps)["approval.request"]).toContain("content.generate");
  });

  it("leaves genuinely independent steps parallel", () => {
    const steps = [step("research.trend"), step("knowledge.search")];

    expect(enforceDataFlow(steps).dependsOn).toEqual([[], []]);
    expect(enforceDataFlow(steps).addedEdges).toBe(0);
  });

  it("does not chain two steps of the same capability", () => {
    // Two posts, not a pipeline. Chaining them would serialise work that has
    // no reason to be serial, and imply the second reads the first.
    const steps = [step("content.generate"), step("content.generate")];

    expect(enforceDataFlow(steps).dependsOn).toEqual([[], []]);
  });

  it("keeps a dependency the model declared that the table does not know", () => {
    // The model may know an ordering this table does not; what is added is
    // only what the data flow requires, never a replacement for its judgement.
    const steps = [step("research.trend"), step("notification.send", [0])];

    expect(waits(steps)["notification.send"]).toContain("research.trend");
  });

  it("counts only the edges it had to add", () => {
    const steps = [step("content.generate"), step("social.publish", [0])];

    expect(enforceDataFlow(steps).addedEdges).toBe(0);
  });

  it("handles a plan with one step", () => {
    expect(enforceDataFlow([step("content.generate")]).dependsOn).toEqual([[]]);
  });

  it("handles an empty plan", () => {
    expect(enforceDataFlow([])).toEqual({
      steps: [],
      dependsOn: [],
      addedEdges: 0,
    });
  });

  it("orders a full pipeline correctly however the model shuffled it", () => {
    const steps = [
      step("social.publish"),
      step("notification.send"),
      step("content.generate"),
      step("knowledge.search"),
      step("approval.request"),
    ];

    const result = order(steps);

    expect(result.indexOf("knowledge.search")).toBeLessThan(
      result.indexOf("content.generate"),
    );
    expect(result.indexOf("content.generate")).toBeLessThan(
      result.indexOf("approval.request"),
    );
    expect(result.indexOf("approval.request")).toBeLessThan(
      result.indexOf("social.publish"),
    );
    expect(result.indexOf("social.publish")).toBeLessThan(
      result.indexOf("notification.send"),
    );
  });

  it("never emits a dependency pointing forwards", () => {
    // What makes a cycle impossible by construction, and what validateDag
    // downstream assumes.
    const flow = enforceDataFlow([
      step("notification.send"),
      step("social.publish"),
      step("approval.request"),
      step("content.generate"),
      step("knowledge.search"),
    ]);

    flow.dependsOn.forEach((sources, index) => {
      for (const source of sources) expect(source).toBeLessThan(index);
    });
  });
});
