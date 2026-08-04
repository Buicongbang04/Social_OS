/**
 * Turning a written post into a description of the picture that goes with it.
 *
 * Assembled here rather than asked of a model. A second model call to write a
 * prompt for the first one costs money and latency to produce something a
 * template produces reliably — and the rules below are not the model's to
 * invent: they came off real posts.
 *
 * The rules themselves are what those posts taught:
 *
 * - **No text in the picture.** Image models write Vietnamese diacritics
 *   wrongly, and a banner reading "Mựa hộ hàng Nhật" is worse than one with no
 *   words at all. The words are in the post, where they are spelled right.
 * - **No logos, no brand marks, no real products with their names on.** A
 *   drawn logo is a fake logo, and a post carrying one is a post claiming a
 *   relationship that does not exist.
 * - **Room left empty.** These posts get their headline read first; a picture
 *   busy to all four edges leaves nowhere for the eye to start.
 */

/** How the picture should be framed, matching where the post is going. */
export type ImageShape = "facebook-post" | "square" | "story";

const ASPECT: Record<ImageShape, string> = {
  "facebook-post": "landscape 1.91:1",
  square: "square 1:1",
  story: "vertical 9:16",
};

export type ImagePromptInput = {
  /** The post the picture is for. */
  body: string;
  shape?: ImageShape;
  /**
   * What the workspace sells, in its own words.
   *
   * Passed in from the workspace's remembered facts. Without it the model
   * draws whatever the words suggest, which for a logistics post is usually a
   * stock photograph of a cardboard box on a white background.
   */
  brand?: string;
};

/**
 * The instruction sent to the image model.
 *
 * English, deliberately: the image models follow English composition terms
 * ("shallow depth of field", "soft daylight") far more reliably than the
 * Vietnamese equivalents, and nothing in this string is ever shown to a
 * reader. The post it is derived from stays in Vietnamese, because what the
 * picture is *about* is the one thing the model must not paraphrase.
 */
export function buildImagePrompt(input: ImagePromptInput): string {
  const shape = input.shape ?? "facebook-post";

  return [
    "Create a photorealistic marketing photograph for a Vietnamese social media post.",
    "",
    "THE POST IT ACCOMPANIES (Vietnamese — read it for the subject, do not render any of it as text):",
    input.body.trim().slice(0, 2_000),
    ...(input.brand ? ["", `THE BUSINESS: ${input.brand.trim()}`] : []),
    "",
    "REQUIREMENTS:",
    `- Aspect ratio: ${ASPECT[shape]}.`,
    // The single most common failure: the model letters the picture, in a
    // language it cannot spell, and the result is unusable at any size.
    "- ABSOLUTELY NO text, letters, words, numbers, captions or watermarks anywhere in the image.",
    "- No logos, no brand marks, no recognisable brand packaging, no real company names.",
    "- No recognisable real people or celebrities.",
    "- Clean, bright commercial photography: soft natural daylight, uncluttered background, shallow depth of field.",
    "- Leave one area calm and uncluttered, so a headline could sit over it.",
    "- Colours: cool blues and whites with a warm accent. Modern, trustworthy, not garish.",
    "- Show the subject the post is actually about — the goods, the parcels, the warehouse, the shopping — not an abstract concept.",
  ].join("\n");
}
