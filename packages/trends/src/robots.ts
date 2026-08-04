/**
 * What a site says it does not want fetched.
 *
 * Checked before every crawl, not as politeness but because this platform
 * fetches somebody else's site on a customer's behalf. A crawler that ignores
 * robots.txt gets the customer's IP blocked and their name in a complaint, and
 * neither is something they asked for.
 *
 * Deliberately small. The full standard has wildcards, crawl-delay, sitemaps
 * and per-agent precedence; this handles user-agent groups, `Allow`, `Disallow`
 * and `*` wildcards, which is what real files use. Anything it cannot parse is
 * treated as permission refused rather than granted — the safe direction when
 * the alternative is fetching something a site asked us not to.
 */
export type RobotsRules = {
  /** Longest-match wins, which is what the standard says and what sites expect. */
  allow: string[];
  disallow: string[];
};

export const CRAWLER_AGENT = "AiSocialOsBot";

/**
 * Read the rules that apply to us.
 *
 * Our own agent's group wins over `*`, as the standard requires — a site that
 * blocks everything but names us specifically has said something deliberate,
 * and reading only `*` would ignore it.
 */
export function parseRobots(text: string, agent = CRAWLER_AGENT): RobotsRules {
  const groups = new Map<string, RobotsRules>();
  let current: string[] = [];

  for (const raw of text.split(/\r?\n/)) {
    // Comments can follow a directive, not only start a line.
    const line = raw.split("#")[0]!.trim();
    if (line === "") continue;

    const separator = line.indexOf(":");
    if (separator === -1) continue;

    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === "user-agent") {
      // Consecutive User-agent lines share one group of rules, which is how a
      // file says "these two crawlers, same rules".
      const name = value.toLowerCase();
      if (current.length > 0 && groups.has(current[0]!)) current = [];
      current.push(name);
      if (!groups.has(name)) groups.set(name, { allow: [], disallow: [] });
      continue;
    }

    if (field !== "allow" && field !== "disallow") continue;
    if (current.length === 0) continue;

    for (const name of current) {
      groups.get(name)![field].push(value);
    }
  }

  return (
    groups.get(agent.toLowerCase()) ??
    groups.get("*") ?? { allow: [], disallow: [] }
  );
}

/**
 * Whether a path may be fetched.
 *
 * Longest match wins, and `Allow` beats `Disallow` at equal length: that is
 * how a site carves one page out of a blocked directory, and getting it
 * backwards would refuse pages it deliberately opened.
 */
export function isAllowed(rules: RobotsRules, path: string): boolean {
  const longest = (patterns: string[]): number =>
    patterns.reduce(
      (best, pattern) =>
        matches(pattern, path) ? Math.max(best, pattern.length) : best,
      -1,
    );

  const blocked = longest(rules.disallow);
  if (blocked === -1) return true;

  return longest(rules.allow) >= blocked;
}

/**
 * A robots pattern, with `*` matching anything and `$` anchoring the end.
 *
 * An empty pattern matches nothing. That is what makes a bare `Disallow:` mean
 * "nothing is disallowed" — the standard's way of granting the whole site.
 * Treating "" as a prefix instead would match every path and block the site
 * entirely, which is the exact opposite of what it said.
 *
 * Handled here rather than when parsing, because this is where a pattern is
 * given its meaning. A second guard on the way in would look like protection
 * and be dead code: a break-check removing it changed nothing.
 */
function matches(pattern: string, path: string): boolean {
  if (pattern === "") return false;

  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;

  const expression = body
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");

  return new RegExp(`^${expression}${anchored ? "$" : ""}`).test(path);
}
