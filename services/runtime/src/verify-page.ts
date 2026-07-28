/**
 * Check a Page token against the real Facebook.
 *
 * Read-only by default: it answers "does this credential work for this Page"
 * and nothing else. Publishing is a separate, outward-facing act that cannot be
 * undone by running the script again, so it needs `--publish` said out loud —
 * a script that posts to somebody's audience as a side effect of being run is
 * not a script anyone should trust.
 *
 *   pnpm --filter @repo/runtime-service verify:page
 *   pnpm --filter @repo/runtime-service verify:page -- --publish
 */
import {
  deleteFacebookPost,
  publishToFacebook,
  verifyPageToken,
} from "@repo/connectors";

async function main(): Promise<void> {
  const pageId = process.env.FB_TEST_PAGE_ID?.trim();
  const token = process.env.FB_TEST_PAGE_TOKEN?.trim();

  if (!pageId || !token) {
    console.error("Cần FB_TEST_PAGE_ID và FB_TEST_PAGE_TOKEN trong .env.");
    process.exitCode = 1;
    return;
  }

  try {
    const identity = await verifyPageToken(pageId, token);
    console.log(`✓ Token dùng được cho Page ${identity.externalId}`);
    console.log(`  Tên Page: ${identity.displayName}`);

    if (!process.argv.includes("--publish")) {
      console.log("  (Chưa đăng gì. Thêm --publish nếu muốn đăng thật.)");
      return;
    }

    // Marked as a test in the post itself, so anyone who sees it on the Page
    // knows what it is before asking.
    const post = await publishToFacebook(
      { externalId: identity.externalId, accessToken: token },
      { message: "test đăng bài" },
    );

    console.log(`✓ Đăng được thật`);
    console.log(`  id bài: ${post.externalId}`);
    console.log(`  link:   ${post.url}`);

    if (process.argv.includes("--keep")) return;

    // Taken down again unless asked to keep it. A verification that leaves
    // litter on somebody's Page is one nobody will run twice.
    await deleteFacebookPost(post.externalId, token);
    console.log("✓ Đã xoá lại bài test");
  } catch (error: unknown) {
    // The message only. The token is not echoed anywhere in this output.
    console.error(
      `✗ ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}

void main();
