import { RuntimeError } from "@repo/runtime";

/**
 * One prompt, versioned on its own.
 *
 * The version is per prompt and not per release, which is the whole reason
 * this type exists. A single shared PROMPT_VERSION meant that editing the
 * planner's wording also stamped a new version onto every intent record — so
 * anyone comparing quality across versions saw a boundary where nothing had
 * changed, and the one place that boundary mattered was exactly where it lied.
 */
export type PromptDefinition = {
  id: string;
  /** Bumped by hand whenever `template` changes in a way that alters output. */
  version: string;
  /**
   * The text, with `{{name}}` placeholders.
   *
   * Placeholders rather than string concatenation at the call site so a prompt
   * can be read, diffed and eventually edited without reading the code that
   * uses it.
   */
  template: string;
  /** What this prompt is for. Shown wherever prompts are listed. */
  description?: string;
};

export type RenderedPrompt = {
  id: string;
  version: string;
  text: string;
};

export type PromptVariables = Readonly<Record<string, string | number>>;

/** Matches `{{ name }}` with any surrounding whitespace. */
const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/**
 * The prompts this platform sends, in one place.
 *
 * Deliberately not a database yet. What a stored registry buys is editing a
 * prompt without a deploy, and that needs an editor, a review path and a way
 * to roll back a bad one — none of which exist. What it needs *first* is for
 * every prompt to be addressable and independently versioned, which is what
 * this is. The seam is the same either way: callers ask by id.
 */
export class PromptRegistry {
  private readonly prompts = new Map<string, PromptDefinition>();

  constructor(definitions: readonly PromptDefinition[] = []) {
    for (const definition of definitions) this.register(definition);
  }

  register(definition: PromptDefinition): void {
    if (this.prompts.has(definition.id)) {
      // Refused rather than overwritten, for the same reason the capability
      // registry refuses a duplicate: a second registration silently changing
      // what the platform says is worse than a loud failure at startup.
      throw new RuntimeError(
        "INTERNAL",
        `Prompt ${definition.id} is already registered.`,
        { retryable: false, context: { id: definition.id } },
      );
    }
    this.prompts.set(definition.id, definition);
  }

  list(): readonly PromptDefinition[] {
    return [...this.prompts.values()];
  }

  /**
   * The prompt with its variables filled in.
   *
   * A missing variable is an error, not an empty string. A prompt that renders
   * to "Chủ đề: " reads as a complete instruction to the model, which answers
   * about nothing in particular and looks like a bad model rather than a bug.
   */
  render(id: string, variables: PromptVariables = {}): RenderedPrompt {
    const definition = this.prompts.get(id);
    if (!definition) {
      throw new RuntimeError("INTERNAL", `No prompt registered as ${id}.`, {
        retryable: false,
        context: { id, registered: [...this.prompts.keys()] },
      });
    }

    const missing: string[] = [];
    const text = definition.template.replace(
      PLACEHOLDER,
      (_match, name: string) => {
        const value = variables[name];
        if (value === undefined) {
          missing.push(name);
          return "";
        }
        return String(value);
      },
    );

    if (missing.length > 0) {
      throw new RuntimeError(
        "INTERNAL",
        `Prompt ${id} needs ${missing.join(", ")}.`,
        { retryable: false, context: { id, missing } },
      );
    }

    return { id, version: definition.version, text };
  }
}
