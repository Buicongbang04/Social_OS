import { RuntimeError } from "@repo/runtime";
import { describe, expect, it } from "vitest";
import { PromptRegistry } from "./registry";

const GREETING = {
  id: "test.greeting",
  version: "1",
  template: "Xin chào {{name}}, hôm nay là {{day}}.",
};

describe("PromptRegistry", () => {
  it("fills the placeholders in", () => {
    const registry = new PromptRegistry([GREETING]);

    expect(registry.render("test.greeting", { name: "Bằng", day: "thứ Ba" }))
      .toEqual({
        id: "test.greeting",
        version: "1",
        text: "Xin chào Bằng, hôm nay là thứ Ba.",
      });
  });

  it("tolerates whitespace inside the braces", () => {
    const registry = new PromptRegistry([
      { id: "x", version: "1", template: "A {{ name }} B" },
    ]);

    expect(registry.render("x", { name: "C" }).text).toBe("A C B");
  });

  it("refuses to render with a variable missing", () => {
    // Not an empty string. "Chủ đề: " reads to the model as a complete
    // instruction, so it answers about nothing in particular and the result
    // looks like a bad model rather than a bug.
    const registry = new PromptRegistry([GREETING]);

    expect(() => registry.render("test.greeting", { name: "Bằng" })).toThrow(
      /day/,
    );
  });

  it("names every missing variable, not just the first", () => {
    const registry = new PromptRegistry([GREETING]);

    expect(() => registry.render("test.greeting")).toThrow(/name.*day/);
  });

  it("substitutes a number without the caller stringifying it", () => {
    const registry = new PromptRegistry([
      { id: "x", version: "1", template: "Tối đa {{limit}} bài." },
    ]);

    expect(registry.render("x", { limit: 5 }).text).toBe("Tối đa 5 bài.");
  });

  it("leaves a template with no placeholders alone", () => {
    const registry = new PromptRegistry([
      { id: "x", version: "1", template: "Không có biến nào." },
    ]);

    expect(registry.render("x").text).toBe("Không có biến nào.");
  });

  it("says which prompt is missing, and what it does have", () => {
    const registry = new PromptRegistry([GREETING]);

    expect(() => registry.render("test.absent")).toThrow(RuntimeError);
    try {
      registry.render("test.absent");
    } catch (error) {
      expect((error as RuntimeError).context.registered).toEqual([
        "test.greeting",
      ]);
    }
  });

  it("refuses a duplicate registration rather than overwriting", () => {
    // Same rule as the capability registry: a second registration silently
    // changing what the platform says is worse than a loud failure at startup.
    const registry = new PromptRegistry([GREETING]);

    expect(() => registry.register({ ...GREETING, template: "khác" })).toThrow(
      /already registered/,
    );
  });

  it("versions each prompt on its own", () => {
    // The defect this replaces: one shared version string meant editing the
    // planner's wording also stamped a new version onto every intent record,
    // so a quality comparison saw a boundary where nothing had changed.
    const registry = new PromptRegistry([
      { id: "a", version: "3", template: "A" },
      { id: "b", version: "1", template: "B" },
    ]);

    expect(registry.render("a").version).toBe("3");
    expect(registry.render("b").version).toBe("1");
  });

  it("lists what it holds", () => {
    const registry = new PromptRegistry([GREETING]);

    expect(registry.list().map((prompt) => prompt.id)).toEqual([
      "test.greeting",
    ]);
  });
});
