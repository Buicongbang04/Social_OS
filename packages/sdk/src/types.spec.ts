import {
  EXECUTION_STATUSES as RUNTIME_EXECUTION_STATUSES,
  TASK_STATUSES as RUNTIME_TASK_STATUSES,
} from "@repo/runtime";
import { describe, expect, it } from "vitest";
import { EXECUTION_STATUSES, TASK_STATUSES } from "./types";

/**
 * The wire types are hand-written rather than imported, because what crosses
 * the network is JSON — dates are strings and ids are plain strings, so the
 * server types would be a lie here. The cost of that choice is drift, and this
 * is what pays it: @repo/runtime is a devDependency only, so nothing of it
 * reaches the browser bundle.
 *
 * The bug this exists to prevent already happened once: TaskStatus was missing
 * WAITING, so the console could not recognise a run parked for approval and
 * silently never offered the button.
 */
describe("wire status unions", () => {
  it("lists exactly the execution statuses the runtime can produce", () => {
    expect([...EXECUTION_STATUSES].sort()).toEqual(
      [...RUNTIME_EXECUTION_STATUSES].sort(),
    );
  });

  it("lists exactly the task statuses the runtime can produce", () => {
    expect([...TASK_STATUSES].sort()).toEqual(
      [...RUNTIME_TASK_STATUSES].sort(),
    );
  });

  it("keeps the states the approval gate depends on", () => {
    // Named explicitly, because these two are what the console keys off to
    // decide whether to show the approve button at all.
    expect(TASK_STATUSES).toContain("WAITING");
    expect(EXECUTION_STATUSES).toContain("WAITING");
  });
});
