import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { BANNER_SIZES, bannerSvg, renderBanner, wrap } from "./banner";

/** How many bright pixels an image has — zero means nothing was drawn. */
async function ink(png: Buffer): Promise<number> {
  const { data, info } = await sharp(png)
    .raw()
    .toBuffer({ resolveWithObject: true });

  let bright = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i]! > 200) bright += 1;
  }
  return bright;
}

describe("wrap", () => {
  it("breaks at word boundaries, filling each line first", () => {
    // "một hai ba" is exactly ten characters, so it belongs on the first line.
    expect(wrap("một hai ba bốn năm", 10)).toEqual(["một hai ba", "bốn năm"]);
  });

  it("never runs a line past the width it was given", () => {
    const lines = wrap("mua hộ hàng Nhật Hàn Mỹ Đức phí rõ ràng tận nơi", 12);

    // The one property that matters: a line longer than this runs off the
    // edge of the picture, where nobody sees it.
    for (const line of lines) {
      if (!line.includes(" ")) continue; // a single long word is left alone
      expect(line.length).toBeLessThanOrEqual(12);
    }
  });

  it("leaves a word longer than a line alone rather than cutting it", () => {
    // A URL split across two lines is a URL nobody can read.
    expect(wrap("xem https://tiximax.vn/bang-gia ngay", 12)).toEqual([
      "xem",
      "https://tiximax.vn/bang-gia",
      "ngay",
    ]);
  });

  it("collapses the whitespace somebody pasted", () => {
    expect(wrap("  một   hai  ", 40)).toEqual(["một hai"]);
  });
});

describe("bannerSvg", () => {
  it("escapes the text, because a title is somebody else's words", () => {
    // "phí & thuế" would otherwise produce SVG that is not well-formed, and
    // the rasteriser answers that with a parse error rather than a picture.
    const svg = bannerSvg({ title: "Phí & thuế <b>rõ ràng</b>" });

    // Asserted per token rather than as one string: the title wraps, so the
    // escaped text is spread over several <text> elements and a single
    // contiguous match would break every time the layout changed.
    expect(svg).toContain("&amp;");
    expect(svg).toContain("&lt;b&gt;");
    expect(svg).not.toContain("<b>");
  });

  it("uses the size it was asked for", () => {
    const svg = bannerSvg({ title: "Vuông", size: "square" });

    expect(svg).toContain(`width="${BANNER_SIZES.square.width}"`);
    expect(svg).toContain(`height="${BANNER_SIZES.square.height}"`);
  });

  it("takes the brand colours it is given", () => {
    const svg = bannerSvg({
      title: "Màu riêng",
      brand: { background: "#ff0000" },
    });

    expect(svg).toContain('fill="#ff0000"');
  });

  it("leaves out a subtitle nobody supplied", () => {
    const withOne = bannerSvg({ title: "Tiêu đề", subtitle: "Phụ đề" });
    const without = bannerSvg({ title: "Tiêu đề" });

    expect(withOne).toContain("Phụ đề");
    expect(without.match(/<text/g)).toHaveLength(1);
  });

  it("stops a very long title rather than shrinking it to nothing", () => {
    // Past four lines the text is smaller than the picture is worth, and a
    // title that long needs editing rather than shrinking.
    const svg = bannerSvg({ title: "dài ".repeat(200) });

    expect(svg.match(/<text/g)!.length).toBeLessThanOrEqual(4);
  });
});

describe("renderBanner", () => {
  it("renders a PNG of the size asked for", async () => {
    const png = await renderBanner({ title: "Mua hộ hàng Nhật" });
    const meta = await sharp(png).metadata();

    expect(meta.format).toBe("png");
    expect(meta.width).toBe(BANNER_SIZES["facebook-post"].width);
    expect(meta.height).toBe(BANNER_SIZES["facebook-post"].height);
  });

  it("actually draws the text, rather than a blank rectangle", async () => {
    // The check that catches a missing font: sharp answers happily with an
    // image containing no glyphs at all, and only counting pixels tells them
    // apart. A container with no fonts installed fails exactly here.
    const blank = await renderBanner({ title: " " });
    const written = await renderBanner({ title: "Mua hộ hàng Nhật, phí rõ" });

    expect(await ink(written)).toBeGreaterThan((await ink(blank)) + 1_000);
  });

  it("draws Vietnamese diacritics, not boxes", async () => {
    // A font without Vietnamese coverage renders tofu — same shape for every
    // letter, and roughly the same amount of ink whatever the word. Comparing
    // a diacritic-heavy string against a plain one of the same length catches
    // that; identical ink means neither was really drawn.
    const plain = await renderBanner({ title: "aaaaaaaaaaaa" });
    const marked = await renderBanner({ title: "ệềếễểộồốỗổ" });

    expect(await ink(marked)).toBeGreaterThan(0);
    expect(await ink(marked)).not.toBe(await ink(plain));
  });

  it("keeps the text inside the picture", async () => {
    // The estimate of how wide a character is used to be too generous, and a
    // real title ran past the right edge — visible only by looking at the
    // rendered image. This measures it instead: the far-right column must stay
    // background.
    const png = await renderBanner({
      title: "Mua hộ hàng Nhật, phí rõ từng bước không phụ phí ẩn",
      subtitle: "Báo giá trước khi đặt, giao tận nơi trong bảy ngày",
    });

    const { data, info } = await sharp(png)
      .raw()
      .toBuffer({ resolveWithObject: true });

    let inMargin = 0;
    const from = Math.round(info.width * 0.95);
    for (let y = 0; y < info.height; y += 1) {
      for (let x = from; x < info.width; x += 1) {
        if (data[(y * info.width + x) * info.channels]! > 200) inMargin += 1;
      }
    }

    expect(inMargin).toBe(0);
  });

  it("renders a title with an ampersand instead of failing", async () => {
    const png = await renderBanner({ title: "Phí & thuế" });

    expect((await sharp(png).metadata()).format).toBe("png");
  });
});
