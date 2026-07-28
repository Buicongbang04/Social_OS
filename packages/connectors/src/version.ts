/**
 * Which Graph API version to talk to.
 *
 * In one place because it appears in five URLs, and a bump that updates four of
 * them leaves one endpoint on a version that will stop answering — the kind of
 * failure that arrives months later, on whichever call was missed.
 *
 * Meta guarantees a version for roughly two years and then stops serving it.
 * v21.0 was released in October 2024 and is expected to go in October 2026, so
 * pinning it any longer would be scheduling an outage.
 *
 * Verified on 28 July 2026 against a real Page: v21 through v25 all answer the
 * identity, feed and conversations reads this package makes; v26 does not exist
 * yet. Raising it is a code change on purpose — a new version can change
 * response shapes, and finding that out from an environment variable in
 * production is the wrong way.
 */
export const GRAPH_VERSION = "v25.0";

/** The Graph host, at the configured version. */
export function graphBase(env: NodeJS.ProcessEnv = process.env): string {
  return (
    env.FACEBOOK_GRAPH_URL?.trim() ||
    `https://graph.facebook.com/${GRAPH_VERSION}`
  ).replace(/\/+$/, "");
}
