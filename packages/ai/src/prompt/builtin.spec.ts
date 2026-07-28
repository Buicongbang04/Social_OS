import { describe, expect, it } from "vitest";
import { BUILTIN_PROMPTS, createDefaultPromptRegistry } from "./builtin";

describe("built-in prompts", () => {
  it("registers without a duplicate id", () => {
    expect(() => createDefaultPromptRegistry()).not.toThrow();
    expect(createDefaultPromptRegistry().list()).toHaveLength(
      BUILTIN_PROMPTS.length,
    );
  });

  it("renders every one of them with no variables", () => {
    // These are system prompts: they say what the model is, not what it was
    // asked. A placeholder here would mean a prompt that cannot render at all,
    // and the failure would only surface on the request that used it.
    const registry = createDefaultPromptRegistry();

    for (const prompt of BUILTIN_PROMPTS) {
      expect(() => registry.render(prompt.id)).not.toThrow();
      expect(registry.render(prompt.id).text.length).toBeGreaterThan(50);
    }
  });

  it("gives each prompt its own version", () => {
    // The defect this replaces: one shared string meant editing one prompt
    // marked every other as changed.
    const registry = createDefaultPromptRegistry();

    expect(registry.render("plan.system").version).not.toBe(
      registry.render("intent.system").version,
    );
  });

  it("describes each one", () => {
    // Whoever edits a prompt has to be able to tell which one it is without
    // reading the code that sends it.
    for (const prompt of BUILTIN_PROMPTS) {
      expect(prompt.description ?? "").not.toBe("");
    }
  });

  it("keeps the planner's dependency rule", () => {
    // A spot check that the extraction did not lose the body: this rule is
    // what stops a step reading a result it never waited for.
    expect(
      createDefaultPromptRegistry().render("plan.system").text,
    ).toContain("dependsOn");
  });

  it("keeps the writer's instruction to follow the documents", () => {
    expect(
      createDefaultPromptRegistry().render("content.generate.system").text,
    ).toContain("thẩm quyền");
  });
});
