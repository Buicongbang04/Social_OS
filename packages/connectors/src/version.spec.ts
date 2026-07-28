import { describe, expect, it } from "vitest";
import { CONNECTORS } from "./catalog";
import { GRAPH_VERSION, graphBase } from "./version";

describe("Graph version", () => {
  it("is used by every Meta URL, not most of them", () => {
    // The reason this file exists: the version appeared in five URLs, and a
    // bump that updated four would leave one endpoint on a version Meta stops
    // serving — a failure that arrives months later, on whichever call was
    // missed.
    const facebook = CONNECTORS.find((c) => c.id === "facebook")!;

    for (const url of [
      facebook.authorizeUrl,
      facebook.tokenUrl,
      facebook.identityUrl,
      graphBase({} as NodeJS.ProcessEnv),
    ]) {
      expect(url).toContain(GRAPH_VERSION);
    }
  });

  it("leaves no other Meta version behind in the catalog", () => {
    const facebook = CONNECTORS.find((c) => c.id === "facebook")!;
    const stale = [
      facebook.authorizeUrl,
      facebook.tokenUrl,
      facebook.identityUrl,
    ].filter(
      (url) => /\/v\d+\.\d+\//.test(url) && !url.includes(GRAPH_VERSION),
    );

    expect(stale).toEqual([]);
  });

  it("lets an operator point at a sandbox without editing code", () => {
    expect(
      graphBase({
        FACEBOOK_GRAPH_URL: "https://sandbox.test/v25.0/",
      } as NodeJS.ProcessEnv),
    ).toBe("https://sandbox.test/v25.0");
  });
});
