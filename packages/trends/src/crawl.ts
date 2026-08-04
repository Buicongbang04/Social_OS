import { CRAWLER_AGENT, isAllowed, parseRobots } from "./robots";

/** What was found on one page. */
export type CrawledPage = {
  url: string;
  title: string | null;
  description: string | null;
  /** Section headings, in document order — the shape of what the page argues. */
  headings: string[];
  /** The readable text, with markup, script and style stripped. */
  text: string;
};

export class CrawlError extends Error {
  constructor(
    message: string,
    readonly reason: "ROBOTS" | "FETCH" | "TYPE" | "SIZE" | "URL",
  ) {
    super(message);
    this.name = "CrawlError";
  }
}

export type CrawlOptions = {
  fetchImpl?: typeof fetch;
  /** How much of a page to read before giving up on it. */
  maxBytes?: number;
  timeoutMs?: number;
};

const DEFAULTS = {
  // Generous for an article, far short of a video or a bundle somebody served
  // with the wrong content type.
  maxBytes: 2 * 1024 * 1024,
  timeoutMs: 15_000,
} as const;

/**
 * Read one page of somebody else's site.
 *
 * Everything here refuses rather than tries harder, because the thing being
 * fetched belongs to someone who did not ask us to fetch it: a site that says
 * no in robots.txt gets a no, a URL that is not http(s) is not fetched at all,
 * and a response that is not HTML is dropped rather than run through a parser
 * that would find "headings" in a PDF.
 *
 * The identifying user agent is not decoration either. A site owner looking at
 * their logs should be able to tell what this is and block it if they want to,
 * and a crawler that hides behind a browser's user agent has taken that away.
 */
export async function crawlPage(
  rawUrl: string,
  options: CrawlOptions = {},
): Promise<CrawledPage> {
  const call = options.fetchImpl ?? fetch;
  const maxBytes = options.maxBytes ?? DEFAULTS.maxBytes;
  const url = parseUrl(rawUrl);

  const rules = await readRobots(call, url, options);
  if (!isAllowed(rules, url.pathname)) {
    throw new CrawlError(
      `${url.hostname} không cho phép đọc ${url.pathname} (robots.txt).`,
      "ROBOTS",
    );
  }

  const response = await request(call, url.toString(), options);
  if (!response.ok) {
    throw new CrawlError(`${url.hostname} trả về ${response.status}.`, "FETCH");
  }

  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("html")) {
    throw new CrawlError(
      `${url} không phải trang HTML (${type || "không rõ kiểu"}).`,
      "TYPE",
    );
  }

  const html = await response.text();
  if (html.length > maxBytes) {
    throw new CrawlError(`${url} lớn hơn ${maxBytes} byte.`, "SIZE");
  }

  // Code stripped once, before anything reads structure out of the page.
  //
  // Headings used to be read from the raw HTML, and vnexpress.net showed what
  // that costs: its scripts build markup in template literals, so the "second
  // heading" of the front page came back as
  // `'+((articleData['privacy']&8)?' Live '...`. Every extractor has to see
  // the same prose-only document.
  const prose = withoutCode(html);

  return {
    url: url.toString(),
    title: firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i),
    description:
      meta(html, "description") ?? meta(html, "og:description", "property"),
    headings: headings(prose),
    text: readableText(prose),
  };
}

/**
 * The site's rules, or permission when there are none.
 *
 * A missing robots.txt means no restrictions — 404 is how most of the web says
 * "help yourself". A robots.txt that cannot be reached at all is different and
 * is treated as a refusal: proceeding would mean guessing, and guessing wrong
 * fetches something a site asked us not to.
 */
async function readRobots(
  call: typeof fetch,
  url: URL,
  options: CrawlOptions,
): Promise<{ allow: string[]; disallow: string[] }> {
  const robotsUrl = new URL("/robots.txt", url.origin).toString();

  let response: Response;
  try {
    response = await request(call, robotsUrl, options);
  } catch {
    // The message deliberately does not carry the underlying one: whether the
    // host refused, timed out or does not resolve, the answer is the same and
    // the fix is the same.
    throw new CrawlError(
      `Không đọc được robots.txt của ${url.hostname}, nên không đọc trang.`,
      "ROBOTS",
    );
  }

  if (response.status === 404 || response.status === 410) {
    return { allow: [], disallow: [] };
  }
  if (!response.ok) {
    throw new CrawlError(
      `robots.txt của ${url.hostname} trả về ${response.status}, nên không đọc trang.`,
      "ROBOTS",
    );
  }

  return parseRobots(await response.text());
}

async function request(
  call: typeof fetch,
  url: string,
  options: CrawlOptions,
): Promise<Response> {
  // A site that never answers must not hold a request open forever: this runs
  // inside an HTTP handler somebody is waiting on.
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DEFAULTS.timeoutMs,
  );

  try {
    return await call(url, {
      headers: {
        // Says what we are and how to reach us. A site owner reading their
        // logs can then block this deliberately rather than by guesswork.
        "user-agent": `${CRAWLER_AGENT}/1.0 (+https://github.com/Buicongbang04/Social_OS)`,
        accept: "text/html,application/xhtml+xml",
      },
      signal: controller.signal,
    });
  } catch (error) {
    throw new CrawlError(
      `Không gọi được ${url}: ${error instanceof Error ? error.message : String(error)}`,
      "FETCH",
    );
  } finally {
    clearTimeout(timer);
  }
}

function parseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new CrawlError(`"${raw}" không phải một địa chỉ hợp lệ.`, "URL");
  }

  // http(s) only. `file:` would read this machine's disk and `data:` would
  // make the platform parse whatever the caller pasted — neither is crawling.
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new CrawlError(
      `Chỉ đọc được http và https, không phải ${url.protocol}`,
      "URL",
    );
  }
  return url;
}

function firstMatch(html: string, pattern: RegExp): string | null {
  const found = pattern.exec(html)?.[1];
  return found ? decode(found).trim() || null : null;
}

function meta(html: string, name: string, attribute = "name"): string | null {
  const pattern = new RegExp(
    `<meta[^>]+${attribute}=["']${name}["'][^>]*content=["']([^"']*)["']`,
    "i",
  );
  const found = pattern.exec(html)?.[1];
  if (found) return decode(found).trim() || null;

  // Attribute order is not fixed, and plenty of pages write content first.
  const reversed = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]*${attribute}=["']${name}["']`,
    "i",
  );
  const other = reversed.exec(html)?.[1];
  return other ? decode(other).trim() || null : null;
}

function headings(html: string): string[] {
  return [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)]
    .map((match) => decode(strip(match[1]!)).trim())
    .filter((heading) => heading !== "")
    .slice(0, 40);
}

/**
 * The page with its code taken out.
 *
 * Removed before anything else looks at the markup: script and style contents
 * are not markup, so stripping tags first leaves a page's JavaScript in the
 * middle of the text and its template literals among the headings.
 */
function withoutCode(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
}

/** The page as a reader sees it. */
function readableText(html: string): string {
  return decode(strip(html)).replace(/\s+/g, " ").trim();
}

function strip(html: string): string {
  return html.replace(/<[^>]*>/g, " ");
}

/** The handful of entities that actually appear in prose. */
function decode(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    );
}
