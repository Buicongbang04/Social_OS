import { describe, expect, it } from "vitest";
import { CrawlError, crawlPage } from "./crawl";

const PAGE = `<!doctype html>
<html><head>
  <title>Mua hộ hàng Nhật &amp; Hàn</title>
  <meta name="description" content="Phí rõ ràng, giao tận nơi.">
  <script>window.tracking = "đừng đọc cái này";</script>
  <style>body { color: red }</style>
</head><body>
  <h1>Dịch vụ mua hộ</h1>
  <p>Chúng tôi mua hộ hàng từ Nhật.</p>
  <h2>Bảng phí</h2>
  <p>Phí 5% giá trị đơn.</p>
  <!-- ghi chú nội bộ -->
</body></html>`;

/** What the fake site was asked. */
type Seen = { urls: string[]; agent?: string | null };

/** A fake site: robots.txt at /robots.txt, the page anywhere else. */
const site = (
  robots: string | number,
  page: string | number = PAGE,
  seen: Seen = { urls: [] },
): typeof fetch =>
  (async (url: string, init: RequestInit = {}) => {
    seen.urls.push(String(url));
    seen.agent = new Headers(init.headers).get("user-agent");

    const isRobots = String(url).endsWith("/robots.txt");
    const body = isRobots ? robots : page;

    if (typeof body === "number") {
      return new Response("", { status: body });
    }
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": isRobots ? "text/plain" : "text/html; charset=utf-8",
      },
    });
  }) as unknown as typeof fetch;

const caught = async (run: Promise<unknown>): Promise<CrawlError> =>
  (await run.catch((error: unknown) => error)) as CrawlError;

describe("crawlPage", () => {
  it("reads the title, description and headings", async () => {
    const page = await crawlPage("https://example.com/dich-vu", {
      fetchImpl: site(404),
    });

    expect(page.title).toBe("Mua hộ hàng Nhật & Hàn");
    expect(page.description).toBe("Phí rõ ràng, giao tận nơi.");
    expect(page.headings).toEqual(["Dịch vụ mua hộ", "Bảng phí"]);
  });

  it("keeps script and style out of the text", async () => {
    // Stripping tags before removing these would leave the page's JavaScript
    // in the middle of the prose and hand it to a model as if a person had
    // written it.
    const page = await crawlPage("https://example.com/", {
      fetchImpl: site(404),
    });

    expect(page.text).toContain("Chúng tôi mua hộ hàng từ Nhật.");
    expect(page.text).not.toContain("window.tracking");
    expect(page.text).not.toContain("color: red");
    expect(page.text).not.toContain("ghi chú nội bộ");
  });

  it("does not read a heading out of a page's JavaScript", async () => {
    // Found against vnexpress.net, which builds markup in template literals:
    // the "second heading" of its front page came back as
    // `'+((articleData['privacy']&8)?' Live '...`. Headings have to be read
    // from the same prose-only document the text is.
    const html = [
      "<html><body>",
      "<h1>Tiêu đề thật</h1>",
      `<script>var t = '<h2>' + (a.x & 8 ? ' Live ' : '') + '</h2>';</script>`,
      "</body></html>",
    ].join("");

    const page = await crawlPage("https://example.com/", {
      fetchImpl: site(404, html),
    });

    expect(page.headings).toEqual(["Tiêu đề thật"]);
  });

  it("checks robots.txt before fetching the page", async () => {
    const seen: Seen = { urls: [] };
    await crawlPage("https://example.com/blog", {
      fetchImpl: site(404, PAGE, seen),
    });

    expect(seen.urls[0]).toBe("https://example.com/robots.txt");
  });

  it("refuses a page the site said not to read", async () => {
    const error = await caught(
      crawlPage("https://example.com/admin/users", {
        fetchImpl: site("User-agent: *\nDisallow: /admin"),
      }),
    );

    expect(error).toBeInstanceOf(CrawlError);
    expect(error.reason).toBe("ROBOTS");
  });

  it("treats a missing robots.txt as permission", async () => {
    // 404 is how most of the web says "help yourself".
    const page = await crawlPage("https://example.com/", {
      fetchImpl: site(404),
    });

    expect(page.title).not.toBeNull();
  });

  it("refuses when robots.txt cannot be read at all", async () => {
    // Different from missing. Proceeding would mean guessing, and guessing
    // wrong fetches something a site asked us not to.
    const error = await caught(
      crawlPage("https://example.com/", { fetchImpl: site(500) }),
    );

    expect(error.reason).toBe("ROBOTS");
  });

  it("says who it is, rather than pretending to be a browser", async () => {
    // A site owner reading their logs should be able to tell what this is and
    // block it deliberately.
    const seen: Seen = { urls: [] };
    await crawlPage("https://example.com/", {
      fetchImpl: site(404, PAGE, seen),
    });

    expect(seen.agent).toContain("AiSocialOsBot");
  });

  it("will not read anything that is not http or https", async () => {
    // `file:` would read this machine's disk and `data:` would parse whatever
    // the caller pasted. Neither is crawling.
    for (const url of ["file:///etc/passwd", "data:text/html,<h1>x</h1>"]) {
      const error = await caught(crawlPage(url, { fetchImpl: site(404) }));
      expect(error.reason).toBe("URL");
    }
  });

  it("refuses something that is not a web address at all", async () => {
    const error = await caught(
      crawlPage("đối thủ của tôi", { fetchImpl: site(404) }),
    );

    expect(error.reason).toBe("URL");
  });

  it("drops a response that is not HTML", async () => {
    // A parser run over a PDF finds "headings" that are not there.
    const pdf = (async () =>
      new Response("%PDF-1.4", {
        status: 200,
        headers: { "content-type": "application/pdf" },
      })) as unknown as typeof fetch;

    const error = await caught(
      crawlPage("https://example.com/report.pdf", {
        fetchImpl: (async (url: string) =>
          String(url).endsWith("/robots.txt")
            ? new Response("", { status: 404 })
            : pdf(url)) as unknown as typeof fetch,
      }),
    );

    expect(error.reason).toBe("TYPE");
  });

  it("gives up on a page bigger than it agreed to read", async () => {
    const error = await caught(
      crawlPage("https://example.com/", {
        fetchImpl: site(404, `<html><body>${"x".repeat(5_000)}</body></html>`),
        maxBytes: 1_000,
      }),
    );

    expect(error.reason).toBe("SIZE");
  });

  it("says what the site answered when it refuses the page", async () => {
    const error = await caught(
      crawlPage("https://example.com/gone", { fetchImpl: site(404, 404) }),
    );

    expect(error.reason).toBe("FETCH");
    expect(error.message).toContain("404");
  });

  it("reads a description written with the attributes the other way round", async () => {
    const html = `<html><head><meta content="Ngược thứ tự" name="description"></head><body>x</body></html>`;
    const page = await crawlPage("https://example.com/", {
      fetchImpl: site(404, html),
    });

    expect(page.description).toBe("Ngược thứ tự");
  });

  it("falls back to the Open Graph description", async () => {
    const html = `<html><head><meta property="og:description" content="Từ OG"></head><body>x</body></html>`;
    const page = await crawlPage("https://example.com/", {
      fetchImpl: site(404, html),
    });

    expect(page.description).toBe("Từ OG");
  });
});
