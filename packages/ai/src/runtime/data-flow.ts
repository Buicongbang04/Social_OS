/**
 * Which capabilities read which other capabilities' output.
 *
 * Defence in depth, and honestly labelled as such: in every run observed so
 * far the Planner has produced these dependencies correctly by itself, and
 * this table changed nothing. It is here because the Planner is a model and
 * nothing makes the alternative impossible — and because of what the
 * alternative looks like. A plan whose steps all have an empty `dependsOn`
 * still runs: the steps go in parallel, the publish step fires with nothing to
 * publish, and the execution reports COMPLETED. There is no error to notice.
 *
 * "You cannot publish content that does not exist yet" is not a matter of
 * model judgement, so a consumer is reordered after its producers and given
 * the dependency regardless of what the model said. `addedEdges` reports how
 * often that was necessary; if it is ever non-zero in practice, the model is
 * doing worse than it has been.
 */
/**
 * No entry lists itself, and none may: two `content.generate` steps are two
 * independent posts, not a chain, and a self-entry would make the step
 * unschedulable rather than merely mis-ordered.
 */
const CONSUMES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  // Writing needs whatever was gathered for it to be grounded in.
  "content.generate": ["knowledge.search", "research.trend"],
  "media.generate-image": ["content.generate"],
  // Approval is about the thing being approved.
  "approval.request": ["content.generate", "media.generate-image"],
  // Publishing needs the content, the image if there is one, and the approval
  // if one was asked for — an approval gate that the publish step does not
  // wait on is decoration.
  "social.publish": [
    "content.generate",
    "media.generate-image",
    "approval.request",
  ],
  "notification.send": ["social.publish"],
});

export type FlowStep = {
  capability: string;
  /** Indices into the ORIGINAL array, as the model gave them. */
  dependsOn: readonly number[];
};

export type FlowResult<T extends FlowStep> = {
  /** Reordered so every producer precedes its consumers. */
  steps: T[];
  /** Per new index, the new indices it depends on. */
  dependsOn: number[][];
  /** Producer→consumer edges the model omitted. For the plan's metadata. */
  addedEdges: number;
};

/**
 * Reorder steps so producers come first, then add the missing dependencies.
 *
 * The model's own `dependsOn` is kept — it may know about an ordering this
 * table does not. What is added is only what the data flow requires.
 */
export function enforceDataFlow<T extends FlowStep>(steps: T[]): FlowResult<T> {
  const required = requiredEdges(steps);
  const order = topologicalOrder(steps, required);

  const positionOf = new Map<number, number>();
  order.forEach((original, position) => positionOf.set(original, position));

  let addedEdges = 0;
  const dependsOn = order.map((original) => {
    const declared = steps[original]?.dependsOn ?? [];
    const merged = new Set<number>();

    for (const source of declared) {
      const position = positionOf.get(source);
      // Backward-only: a dependency on a step that now comes later would be a
      // cycle, and the model's indices refer to the order it produced.
      if (position !== undefined && position < positionOf.get(original)!) {
        merged.add(position);
      }
    }

    for (const source of required.get(original) ?? []) {
      const position = positionOf.get(source)!;
      if (!merged.has(position)) addedEdges += 1;
      merged.add(position);
    }

    return [...merged].sort((a, b) => a - b);
  });

  return {
    steps: order.map((original) => steps[original]!),
    dependsOn,
    addedEdges,
  };
}

/** For each step index, the indices whose output it reads. */
function requiredEdges(steps: readonly FlowStep[]): Map<number, number[]> {
  const byCapability = new Map<string, number[]>();
  steps.forEach((step, index) => {
    const list = byCapability.get(step.capability) ?? [];
    list.push(index);
    byCapability.set(step.capability, list);
  });

  const edges = new Map<number, number[]>();

  steps.forEach((step, index) => {
    const producers = CONSUMES[step.capability] ?? [];
    const sources: number[] = [];

    for (const producer of producers) {
      sources.push(...(byCapability.get(producer) ?? []));
    }

    if (sources.length > 0) edges.set(index, sources);
  });

  return edges;
}

/**
 * Producers before consumers, keeping the model's order where it does not
 * conflict.
 *
 * Kahn's algorithm over the required edges only. If the table ever describes a
 * cycle, the remaining steps are appended in their original order rather than
 * dropped — a plan missing steps is worse than a plan in a debatable order,
 * and `validateDag` downstream will still refuse a genuine cycle.
 */
function topologicalOrder(
  steps: readonly FlowStep[],
  required: Map<number, number[]>,
): number[] {
  const remaining = new Map<number, Set<number>>();
  steps.forEach((_, index) => {
    remaining.set(index, new Set(required.get(index) ?? []));
  });

  const order: number[] = [];
  const emitted = new Set<number>();

  while (order.length < steps.length) {
    // Lowest original index first, so a plan needing no reordering comes back
    // exactly as the model wrote it.
    const next = [...remaining.keys()]
      .filter((index) => !emitted.has(index))
      .find((index) => remaining.get(index)!.size === 0);

    if (next === undefined) break;

    order.push(next);
    emitted.add(next);
    for (const pending of remaining.values()) pending.delete(next);
  }

  for (let index = 0; index < steps.length; index += 1) {
    if (!emitted.has(index)) order.push(index);
  }

  return order;
}
