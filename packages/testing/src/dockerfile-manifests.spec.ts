import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every workspace manifest must be listed in the Dockerfile.
 *
 * The dependency layer copies package.json files one by one, because copying
 * sources there would make it miss its cache on every edit. The cost is a list
 * that has to stay in step with the workspace — and a new package that nobody
 * added fails the image build with a message about a checksum, which says
 * nothing about what is actually wrong.
 *
 * Found the hard way: two directories in `packages/` hold only a README, and
 * the first build died on one of them.
 */
const ROOT = join(__dirname, "..", "..", "..");

function manifests(): string[] {
  return ["apps", "packages", "services"].flatMap((group) =>
    readdirSync(join(ROOT, group))
      .map((name) => `${group}/${name}/package.json`)
      .filter((path) => existsSync(join(ROOT, path))),
  );
}

describe("Dockerfile", () => {
  it("copies every workspace manifest", () => {
    const dockerfile = readFileSync(join(ROOT, "Dockerfile"), "utf8");
    const missing = manifests().filter(
      (path) => !dockerfile.includes(`COPY ${path} `),
    );

    expect(missing).toEqual([]);
  });

  it("copies no manifest that does not exist", () => {
    // The other direction: a package that was removed leaves a COPY that fails
    // the build, and the message names a checksum rather than the deletion.
    const dockerfile = readFileSync(join(ROOT, "Dockerfile"), "utf8");
    const listed = [
      ...dockerfile.matchAll(/^COPY (\S+\/package\.json) /gm),
    ].map((match) => match[1]!);

    expect(listed.filter((path) => !existsSync(join(ROOT, path)))).toEqual([]);
  });
});
