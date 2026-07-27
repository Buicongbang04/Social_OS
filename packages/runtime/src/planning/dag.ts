import type { TaskId } from "@repo/core";
import type { Task } from "../model/task";
import { RuntimeError } from "../errors/taxonomy";

export type DependencyGraph = Readonly<Record<string, readonly TaskId[]>>;

/**
 * Validates that a plan is a DAG with resolvable dependencies.
 *
 * A cycle would deadlock the scheduler silently — every task in the cycle
 * waits forever for another that is also waiting — so this must be caught at
 * plan time, not discovered by an execution that never finishes
 * (docs/kernel/06_PLANNING_ENGINE.md: "no circular dependency allowed").
 */
export function validateDag(tasks: readonly Task[]): void {
  const ids = new Set<string>(tasks.map((task) => task.id));

  if (ids.size !== tasks.length) {
    throw new RuntimeError(
      "PLANNING",
      "Execution plan contains duplicate task ids.",
    );
  }

  for (const task of tasks) {
    for (const dependency of task.dependencies) {
      if (!ids.has(dependency)) {
        throw new RuntimeError(
          "PLANNING",
          `Task ${task.id} depends on unknown task ${dependency}.`,
          { context: { taskId: task.id, dependency } },
        );
      }
      if (dependency === task.id) {
        throw new RuntimeError(
          "PLANNING",
          `Task ${task.id} depends on itself.`,
          {
            context: { taskId: task.id },
          },
        );
      }
    }
  }

  const cycle = findCycle(tasks);
  if (cycle) {
    throw new RuntimeError(
      "PLANNING",
      `Execution plan has a circular dependency: ${cycle.join(" → ")}.`,
      { context: { cycle } },
    );
  }
}

/** Returns the first cycle found as a path, or null when the graph is acyclic. */
export function findCycle(tasks: readonly Task[]): string[] | null {
  const dependencies = new Map<string, readonly TaskId[]>(
    tasks.map((task) => [task.id, task.dependencies]),
  );

  // Iterative DFS with an explicit colour map: WHITE unvisited, GREY on the
  // current path, BLACK fully explored. A GREY hit is a back edge — a cycle.
  const colour = new Map<string, "GREY" | "BLACK">();
  const path: string[] = [];

  function visit(id: string): string[] | null {
    const state = colour.get(id);
    if (state === "BLACK") return null;
    if (state === "GREY") {
      const start = path.indexOf(id);
      return [...path.slice(start), id];
    }

    colour.set(id, "GREY");
    path.push(id);

    for (const dependency of dependencies.get(id) ?? []) {
      const found = visit(dependency);
      if (found) return found;
    }

    path.pop();
    colour.set(id, "BLACK");
    return null;
  }

  for (const task of tasks) {
    const found = visit(task.id);
    if (found) return found;
  }

  return null;
}

/**
 * Groups tasks into waves that may run concurrently: everything in wave N
 * depends only on waves before it. Used for estimating duration and for
 * showing a user what will happen in parallel.
 */
export function parallelGroups(
  tasks: readonly Task[],
): readonly (readonly Task[])[] {
  validateDag(tasks);

  const remaining = new Map<string, Task>(tasks.map((task) => [task.id, task]));
  const settled = new Set<string>();
  const groups: Task[][] = [];

  while (remaining.size > 0) {
    const wave = [...remaining.values()].filter((task) =>
      task.dependencies.every((dependency) => settled.has(dependency)),
    );

    // validateDag already ruled out cycles, so a wave is always non-empty.
    if (wave.length === 0) {
      throw new RuntimeError(
        "PLANNING",
        "Execution plan cannot be layered; graph is not a DAG.",
      );
    }

    for (const task of wave) {
      remaining.delete(task.id);
    }
    for (const task of wave) {
      settled.add(task.id);
    }

    groups.push(wave);
  }

  return groups;
}

/** Tasks whose dependencies are all satisfied, given the ids already completed. */
export function dispatchableTasks(
  tasks: readonly Task[],
  completedIds: ReadonlySet<string>,
): readonly Task[] {
  return tasks.filter(
    (task) =>
      task.status === "PENDING" &&
      task.dependencies.every((dependency) => completedIds.has(dependency)),
  );
}
