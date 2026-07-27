import { describe, expect, it } from "vitest";
import type { TaskId } from "@repo/core";
import { RuntimeError } from "../errors/taxonomy";
import {
  DEFAULT_RETRY_POLICY,
  DEFAULT_TASK_TIMEOUT_MS,
  type Task,
} from "../model/task";
import {
  dispatchableTasks,
  findCycle,
  parallelGroups,
  validateDag,
} from "./dag";

function task(
  id: string,
  dependencies: string[] = [],
  status: Task["status"] = "PENDING",
): Task {
  return {
    id: id as TaskId,
    executionId: "exe_01HX8ZQ7P9K2M4N6R8T0V2W4Y6" as Task["executionId"],
    workspaceId: "wsp_01HX8ZQ7P9K2M4N6R8T0V2W4A1" as Task["workspaceId"],
    capability: "content.generate",
    workerId: null,
    inputs: {},
    outputs: null,
    dependencies: dependencies as TaskId[],
    timeoutMs: DEFAULT_TASK_TIMEOUT_MS,
    retryPolicy: DEFAULT_RETRY_POLICY,
    priority: "NORMAL",
    status,
    attempt: 0,
    lastError: null,
    startedAt: null,
    finishedAt: null,
    metadata: {},
  };
}

describe("validateDag", () => {
  it("accepts a linear chain", () => {
    expect(() =>
      validateDag([task("a"), task("b", ["a"]), task("c", ["b"])]),
    ).not.toThrow();
  });

  it("accepts a diamond", () => {
    // a → {b, c} → d: the shape the doc's own worked example produces.
    const tasks = [
      task("a"),
      task("b", ["a"]),
      task("c", ["a"]),
      task("d", ["b", "c"]),
    ];
    expect(() => validateDag(tasks)).not.toThrow();
  });

  it("rejects a direct cycle", () => {
    // Without this check the scheduler would wait forever: every task in the
    // cycle is blocked on another that is also blocked.
    expect(() => validateDag([task("a", ["b"]), task("b", ["a"])])).toThrow(
      RuntimeError,
    );
  });

  it("rejects a longer cycle", () => {
    const tasks = [task("a", ["c"]), task("b", ["a"]), task("c", ["b"])];
    expect(() => validateDag(tasks)).toThrow(/circular dependency/i);
  });

  it("rejects self-dependency", () => {
    expect(() => validateDag([task("a", ["a"])])).toThrow(/depends on itself/i);
  });

  it("rejects a dependency on a task that is not in the plan", () => {
    expect(() => validateDag([task("a", ["ghost"])])).toThrow(/unknown task/i);
  });

  it("rejects duplicate task ids", () => {
    expect(() => validateDag([task("a"), task("a")])).toThrow(
      /duplicate task ids/i,
    );
  });

  it("classifies its failures as PLANNING errors, which are not blindly retried", () => {
    try {
      validateDag([task("a", ["b"]), task("b", ["a"])]);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(RuntimeError);
      expect((error as RuntimeError).errorClass).toBe("PLANNING");
      expect((error as RuntimeError).retryable).toBe(false);
    }
  });
});

describe("findCycle", () => {
  it("returns null for an acyclic graph", () => {
    expect(findCycle([task("a"), task("b", ["a"])])).toBeNull();
  });

  it("returns the offending path so the error can name it", () => {
    const cycle = findCycle([task("a", ["b"]), task("b", ["a"])]);
    expect(cycle).not.toBeNull();
    expect(cycle!.length).toBeGreaterThanOrEqual(2);
  });

  it("does not report a cycle for a diamond, where a node is reached twice", () => {
    // A shared dependency is not a cycle — a naive visited-set check gets this wrong.
    const tasks = [
      task("a"),
      task("b", ["a"]),
      task("c", ["a"]),
      task("d", ["b", "c"]),
    ];
    expect(findCycle(tasks)).toBeNull();
  });
});

describe("parallelGroups", () => {
  it("puts independent tasks in the same wave", () => {
    const groups = parallelGroups([
      task("a"),
      task("b"),
      task("c", ["a", "b"]),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.map((t) => t.id).sort()).toEqual(["a", "b"]);
    expect(groups[1]!.map((t) => t.id)).toEqual(["c"]);
  });

  it("layers a linear chain one task per wave", () => {
    const groups = parallelGroups([
      task("a"),
      task("b", ["a"]),
      task("c", ["b"]),
    ]);
    expect(groups.map((wave) => wave.length)).toEqual([1, 1, 1]);
  });

  it("never places a task before something it depends on", () => {
    const groups = parallelGroups([
      task("a"),
      task("b", ["a"]),
      task("c", ["a"]),
      task("d", ["b", "c"]),
    ]);

    const waveOf = new Map<string, number>();
    groups.forEach((wave, index) =>
      wave.forEach((t) => waveOf.set(t.id, index)),
    );

    for (const wave of groups) {
      for (const t of wave) {
        for (const dependency of t.dependencies) {
          expect(waveOf.get(dependency)!).toBeLessThan(waveOf.get(t.id)!);
        }
      }
    }
  });
});

describe("dispatchableTasks", () => {
  it("returns only PENDING tasks whose dependencies are all completed", () => {
    const tasks = [
      task("a", [], "COMPLETED"),
      task("b", ["a"]),
      task("c", ["b"]),
    ];
    const dispatchable = dispatchableTasks(tasks, new Set(["a"]));

    expect(dispatchable.map((t) => t.id)).toEqual(["b"]);
  });

  it("returns nothing while a dependency is still unfinished", () => {
    const tasks = [task("a", [], "RUNNING"), task("b", ["a"])];
    expect(dispatchableTasks(tasks, new Set())).toEqual([]);
  });

  it("ignores tasks that already left PENDING", () => {
    // Otherwise a running task would be dispatched a second time.
    const tasks = [task("a", [], "RUNNING"), task("b", [], "COMPLETED")];
    expect(dispatchableTasks(tasks, new Set(["b"]))).toEqual([]);
  });
});
