import { InMemoryUsageRecorder, LlmIntentAnalyzer, LlmPlanner } from "@repo/ai";
import {
  InMemoryCapabilityRegistry,
  KeywordIntentAnalyzer,
  TemplatePlanner,
} from "@repo/runtime";
import { describe, expect, it } from "vitest";
import { buildAiEngines } from "./ai-engines";

function build(env: NodeJS.ProcessEnv) {
  return buildAiEngines({
    capabilities: new InMemoryCapabilityRegistry(),
    recorder: new InMemoryUsageRecorder(),
    env,
  });
}

describe("AI engine selection", () => {
  it("falls back to the deterministic engines when nothing is configured", () => {
    // The runtime has to boot and run a goal end to end with no API key: CI
    // has no credential, and a platform nobody can start without paying for
    // one is a platform most people never see working.
    const engines = build({});

    expect(engines.mode).toBe("keyword");
    expect(engines.intentAnalyzer).toBeInstanceOf(KeywordIntentAnalyzer);
    expect(engines.planner).toBeInstanceOf(TemplatePlanner);
  });

  it("uses the LLM engines once a provider and its key are present", () => {
    const engines = build({
      AI_PROVIDER: "anthropic",
      ANTHROPIC_API_KEY: "sk-test",
    });

    expect(engines.mode).toBe("llm");
    expect(engines.intentAnalyzer).toBeInstanceOf(LlmIntentAnalyzer);
    expect(engines.planner).toBeInstanceOf(LlmPlanner);
    expect(engines.providers).toEqual(["anthropic"]);
  });

  it("drops a provider whose key is missing rather than queuing a certain 401", () => {
    // Registering it would put a guaranteed failure in the fallback chain: the
    // request still succeeds via the next provider, but only after paying a
    // round trip for something knowable at startup.
    const engines = build({
      AI_PROVIDER: "anthropic,openai",
      OPENAI_API_KEY: "sk-test",
    });

    expect(engines.providers).toEqual(["openai"]);
  });

  it("keeps the configured order as the fallback chain", () => {
    const engines = build({
      AI_PROVIDER: "openai,anthropic",
      OPENAI_API_KEY: "sk-a",
      ANTHROPIC_API_KEY: "sk-b",
    });

    expect(engines.providers).toEqual(["openai", "anthropic"]);
  });

  it("stays on the deterministic engines when every named provider lacks a key", () => {
    const engines = build({ AI_PROVIDER: "anthropic,openai" });

    expect(engines.mode).toBe("keyword");
  });

  it("ignores an unknown provider name instead of failing to boot", () => {
    const engines = build({
      AI_PROVIDER: "kimi,anthropic",
      ANTHROPIC_API_KEY: "sk-test",
    });

    expect(engines.providers).toEqual(["anthropic"]);
  });

  it("accepts Ollama with no key, since it is local and unauthenticated", () => {
    const engines = build({ AI_PROVIDER: "ollama" });

    expect(engines.mode).toBe("llm");
    expect(engines.providers).toEqual(["ollama"]);
  });

  it("does not register the same provider twice", () => {
    // ProviderRegistry throws on a duplicate, so a sloppy env value would
    // otherwise crash the process at boot.
    const engines = build({
      AI_PROVIDER: "anthropic, anthropic",
      ANTHROPIC_API_KEY: "sk-test",
    });

    expect(engines.providers).toEqual(["anthropic"]);
  });
});

describe("blank environment variables", () => {
  it("treats a declared-but-empty AI_MODEL as unset", () => {
    // `.env` files declare a variable and leave it blank to show it exists —
    // `AI_MODEL=`. That reaches the process as an empty string, which `??`
    // does not catch, so the adapter is built with no model at all and the
    // first request comes back "model is required" — an error that reads as a
    // bug in the gateway rather than in the configuration.
    const engines = build({ AI_PROVIDER: "ollama", AI_MODEL: "   " });

    expect(engines.mode).toBe("llm");
    expect(engines.models.ollama).toBe("llama3.1");
  });

  it("keeps a real AI_MODEL", () => {
    const engines = build({ AI_PROVIDER: "ollama", AI_MODEL: "qwen2.5:7b" });

    expect(engines.models.ollama).toBe("qwen2.5:7b");
    expect(engines.gateway).not.toBeNull();
  });

  it("has no gateway in keyword mode", () => {
    expect(build({}).gateway).toBeNull();
  });
});
