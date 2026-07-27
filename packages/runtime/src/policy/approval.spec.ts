import { describe, expect, it } from "vitest";
import { RuntimeError, isRetryable } from "../errors/taxonomy";
import { ApprovalRequired, isApprovalRequired } from "./approval";

describe("ApprovalRequired", () => {
  it("is not a RuntimeError, so the retry path cannot claim it", () => {
    // Routing it through the error path would retry it three times and then
    // dead-letter a task that is behaving exactly as designed.
    const signal = new ApprovalRequired("cần duyệt");

    expect(signal).not.toBeInstanceOf(RuntimeError);
    expect(isRetryable(signal)).toBe(false);
    expect(isApprovalRequired(signal)).toBe(true);
  });

  it("carries what the approver needs to decide on", () => {
    // A gate that says only "approve?" without showing what is being approved
    // trains people to click yes.
    const signal = new ApprovalRequired("chờ duyệt", {
      title: "Bài về cà phê",
      platforms: ["facebook"],
    });

    expect(signal.summary.title).toBe("Bài về cà phê");
    expect(signal.summary.platforms).toEqual(["facebook"]);
  });

  it("does not mistake an ordinary failure for an approval request", () => {
    expect(isApprovalRequired(new RuntimeError("WORKER", "boom"))).toBe(false);
    expect(isApprovalRequired(new Error("boom"))).toBe(false);
    expect(isApprovalRequired("boom")).toBe(false);
  });
});
