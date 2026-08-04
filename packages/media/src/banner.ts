import sharp from "sharp";

/**
 * What a share image is for.
 *
 * Sizes are named after where they go rather than by their pixels, because
 * "1200×630" tells nobody what it is for and the platforms change the numbers
 * more often than they change the shapes.
 */
export const BANNER_SIZES = {
  /** The link-preview shape every platform reuses. */
  "facebook-post": { width: 1200, height: 630 },
  /** Square, which is what a feed crops to on a phone. */
  square: { width: 1080, height: 1080 },
  /** Full-height, for stories. */
  story: { width: 1080, height: 1920 },
} as const;

export type BannerSize = keyof typeof BANNER_SIZES;

export type Brand = {
  /** Background. Anything CSS accepts, which is what SVG accepts. */
  background: string;
  foreground: string;
  /** The rule above the title, and anything else that needs to catch an eye. */
  accent: string;
};

export const DEFAULT_BRAND: Brand = {
  background: "#0f172a",
  foreground: "#f8fafc",
  accent: "#38bdf8",
};

export type BannerInput = {
  title: string;
  /** A line under the title. Left out when there is nothing to say. */
  subtitle?: string;
  /** Who is saying it — a page name, usually. */
  footer?: string;
  size?: BannerSize;
  brand?: Partial<Brand>;
};

/**
 * A post, as a picture of itself.
 *
 * SVG rendered to PNG rather than a canvas API: the layout is text on a
 * rectangle, which SVG describes directly, and a canvas would mean drawing
 * the same thing imperatively with more room to get it wrong.
 *
 * What this is not: image generation. There is no model here and nothing is
 * invented — it renders words somebody already wrote. Generating a picture of
 * a product that does not exist is a different feature with a different risk,
 * and calling both "image" would hide that.
 */
export async function renderBanner(input: BannerInput): Promise<Buffer> {
  return sharp(Buffer.from(bannerSvg(input)))
    .png()
    .toBuffer();
}

/** The SVG, exposed so a test can read the layout without rasterising it. */
export function bannerSvg(input: BannerInput): string {
  const { width, height } = BANNER_SIZES[input.size ?? "facebook-post"];
  const brand = { ...DEFAULT_BRAND, ...input.brand };

  const padding = Math.round(width * 0.08);
  const titleSize = Math.round(width * 0.062);
  const subtitleSize = Math.round(titleSize * 0.5);
  const footerSize = Math.round(titleSize * 0.34);

  const titleLines = wrap(
    input.title,
    charactersPerLine(width, titleSize),
  ).slice(
    0,
    // Beyond four lines the text is smaller than the picture is worth, and a
    // title that long is a title that needs editing rather than shrinking.
    4,
  );
  const subtitleLines = input.subtitle
    ? wrap(input.subtitle, charactersPerLine(width, subtitleSize)).slice(0, 2)
    : [];

  const titleLeading = Math.round(titleSize * 1.25);
  const subtitleLeading = Math.round(subtitleSize * 1.35);

  const blockHeight =
    titleLines.length * titleLeading +
    (subtitleLines.length > 0
      ? subtitleLines.length * subtitleLeading + Math.round(titleSize * 0.5)
      : 0);
  // Centred on the image rather than pinned to the top: a one-line title
  // otherwise floats in a large empty rectangle.
  let cursor = Math.round((height - blockHeight) / 2) + titleSize;

  const parts: string[] = [
    `<rect width="${width}" height="${height}" fill="${escape(brand.background)}"/>`,
    // A rule the width of a word, above the title. Enough to look deliberate
    // without pretending to be a logo we do not have.
    `<rect x="${padding}" y="${cursor - titleSize - Math.round(titleSize * 0.9)}" width="${Math.round(
      width * 0.09,
    )}" height="${Math.max(4, Math.round(height * 0.008))}" fill="${escape(brand.accent)}"/>`,
  ];

  for (const line of titleLines) {
    parts.push(text(line, padding, cursor, titleSize, brand.foreground, 700));
    cursor += titleLeading;
  }

  if (subtitleLines.length > 0) {
    cursor += Math.round(titleSize * 0.35);
    for (const line of subtitleLines) {
      parts.push(
        text(line, padding, cursor, subtitleSize, brand.foreground, 400, 0.75),
      );
      cursor += subtitleLeading;
    }
  }

  if (input.footer) {
    parts.push(
      text(
        input.footer,
        padding,
        height - padding,
        footerSize,
        brand.accent,
        500,
      ),
    );
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    ...parts,
    "</svg>",
  ].join("");
}

function text(
  content: string,
  x: number,
  y: number,
  size: number,
  fill: string,
  weight: number,
  opacity = 1,
): string {
  return (
    `<text x="${x}" y="${y}" font-family="Noto Sans, DejaVu Sans, sans-serif" ` +
    `font-size="${size}" font-weight="${weight}" fill="${escape(fill)}"` +
    `${opacity === 1 ? "" : ` opacity="${opacity}"`}>${escape(content)}</text>`
  );
}

/**
 * How many characters fit on a line.
 *
 * An approximation from the average width of a glyph relative to its size,
 * because measuring properly needs font metrics and those live inside the
 * rasteriser.
 *
 * The 0.62 was measured, not guessed. At 0.52 a real title — "Mua hộ hàng
 * Nhật, phí rõ" — reached 1165px on a 1200px image whose right padding starts
 * at 1104, so the words ran off where nobody sees them. Erring wide is the
 * safe direction: a line that wraps early looks fine, one that wraps late is
 * cut off.
 */
function charactersPerLine(width: number, fontSize: number): number {
  const usable = width * 0.84;
  return Math.max(8, Math.floor(usable / (fontSize * 0.62)));
}

/**
 * Break text into lines at word boundaries.
 *
 * A word longer than a whole line is placed alone rather than cut: a URL split
 * across two lines is a URL nobody can read, and it is better for one line to
 * overflow than for every reader to have to reassemble it.
 */
export function wrap(input: string, perLine: number): string[] {
  const lines: string[] = [];
  let line = "";

  for (const word of input.trim().split(/\s+/).filter(Boolean)) {
    if (line === "") {
      line = word;
      continue;
    }
    if (line.length + 1 + word.length <= perLine) {
      line = `${line} ${word}`;
      continue;
    }
    lines.push(line);
    line = word;
  }

  if (line !== "") lines.push(line);
  return lines;
}

/**
 * XML-escape, because a title is somebody's text.
 *
 * A post about "phí & thuế" would otherwise produce SVG that is not
 * well-formed, and the rasteriser answers that with a parse error rather than
 * a picture — a banner that fails on an ampersand fails on a normal Tuesday.
 */
function escape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
