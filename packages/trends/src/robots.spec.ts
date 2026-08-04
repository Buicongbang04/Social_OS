import { describe, expect, it } from "vitest";
import { isAllowed, parseRobots } from "./robots";

const allows = (text: string, path: string, agent?: string) =>
  isAllowed(parseRobots(text, agent), path);

describe("robots.txt", () => {
  it("lets everything through when there are no rules", async () => {
    expect(allows("", "/anything")).toBe(true);
  });

  it("refuses what a site said not to fetch", () => {
    expect(allows("User-agent: *\nDisallow: /admin", "/admin/users")).toBe(
      false,
    );
    expect(allows("User-agent: *\nDisallow: /admin", "/blog")).toBe(true);
  });

  it("reads an empty Disallow as permission, not as blocking everything", () => {
    // "Disallow:" with nothing after it is the standard's way of granting the
    // whole site. Storing "" as a pattern would match every path and block it
    // entirely — the exact opposite of what the site said.
    expect(allows("User-agent: *\nDisallow:", "/anything")).toBe(true);
  });

  it("lets Allow carve a page out of a blocked directory", () => {
    // Longest match wins, and at equal length Allow beats Disallow. Backwards,
    // this refuses pages a site deliberately opened.
    const text = "User-agent: *\nDisallow: /blog\nAllow: /blog/public";

    expect(allows(text, "/blog/private")).toBe(false);
    expect(allows(text, "/blog/public/post")).toBe(true);
  });

  it("prefers the rules written for us over the ones for everybody", () => {
    // A site that blocks everything but names us has said something
    // deliberate, and reading only `*` would ignore it.
    const text = [
      "User-agent: *",
      "Disallow: /",
      "",
      "User-agent: AiSocialOsBot",
      "Disallow: /admin",
    ].join("\n");

    expect(allows(text, "/blog")).toBe(true);
    expect(allows(text, "/admin")).toBe(false);
  });

  it("applies one block of rules to every agent named above it", () => {
    const text = [
      "User-agent: SomeBot",
      "User-agent: AiSocialOsBot",
      "Disallow: /private",
    ].join("\n");

    expect(allows(text, "/private")).toBe(false);
    expect(allows(text, "/public")).toBe(true);
  });

  it("understands a wildcard in the middle of a pattern", () => {
    const text = "User-agent: *\nDisallow: /*/edit";

    expect(allows(text, "/posts/edit")).toBe(false);
    expect(allows(text, "/posts/view")).toBe(true);
  });

  it("anchors a pattern ending in $", () => {
    const text = "User-agent: *\nDisallow: /*.pdf$";

    expect(allows(text, "/files/report.pdf")).toBe(false);
    expect(allows(text, "/files/report.pdf.html")).toBe(true);
  });

  it("ignores a comment, wherever it starts", () => {
    const text = [
      "# everything below is for crawlers",
      "User-agent: *   # any of them",
      "Disallow: /admin # staff only",
    ].join("\n");

    expect(allows(text, "/admin")).toBe(false);
    expect(allows(text, "/blog")).toBe(true);
  });

  it("ignores directives written before any user-agent line", () => {
    // A stray Disallow with no group belongs to nobody. Attaching it to
    // everyone would block a site over a typo in its file.
    expect(allows("Disallow: /\nUser-agent: *\nAllow: /", "/blog")).toBe(true);
  });

  it("ignores fields it does not understand", () => {
    const text = [
      "User-agent: *",
      "Crawl-delay: 10",
      "Sitemap: https://example.com/sitemap.xml",
      "Disallow: /admin",
    ].join("\n");

    expect(allows(text, "/admin")).toBe(false);
    expect(allows(text, "/")).toBe(true);
  });
});
