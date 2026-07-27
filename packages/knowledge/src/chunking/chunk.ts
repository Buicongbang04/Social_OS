/**
 * Split a document into retrievable pieces.
 *
 * Retrieval quality is decided here, before any model is involved. A chunk cut
 * mid-sentence embeds as something nobody wrote, and the answer built from it
 * reads as though the source said it — so the split points are chosen at
 * boundaries a human would recognise, and the failure mode of a very long
 * unbroken run is a hard cut rather than an unbounded chunk.
 */

/** Roughly a paragraph and a half of prose. */
export const DEFAULT_CHUNK_SIZE = 1_000;

/**
 * How much of the previous chunk each chunk repeats.
 *
 * Overlap exists because the sentence that answers a question is often the one
 * straddling a boundary. Repeating the tail means it is whole in at least one
 * chunk. The cost is duplicate storage and the odd duplicate hit, which the
 * search side deduplicates by document position.
 */
export const DEFAULT_CHUNK_OVERLAP = 150;

export type ChunkOptions = {
  /** Target characters per chunk. Never exceeded except by an unbreakable run. */
  size?: number;
  /** Characters of the previous chunk repeated at the start of the next. */
  overlap?: number;
};

export type TextChunk = {
  /** Position in the document, from 0. Stable for a given text and options. */
  index: number;
  text: string;
  /** Character offset into the original text, so a citation can point at it. */
  startOffset: number;
  endOffset: number;
};

/**
 * Boundaries in descending order of how much a reader would agree with them.
 *
 * Tried in turn: a blank line is a real break in the author's structure, a
 * sentence end is a break in meaning, and a space is merely a break in
 * rendering. Only when none is available inside the window does the text get
 * cut mid-word.
 */
const BOUNDARIES: readonly RegExp[] = [
  /\n\s*\n/g,
  /(?<=[.!?…])\s+/g,
  /\n/g,
  /\s+/g,
];

/**
 * How far back from the size limit a boundary is still worth taking.
 *
 * Without this, a paragraph break near the very start of the window would win
 * over a sentence break near the end, and chunks would come out a fraction of
 * the requested size — many more embedding calls for less context each.
 */
const BOUNDARY_SEARCH_FRACTION = 0.4;

export function chunkText(
  text: string,
  options: ChunkOptions = {},
): TextChunk[] {
  const size = Math.max(1, options.size ?? DEFAULT_CHUNK_SIZE);
  const overlap = Math.max(0, options.overlap ?? DEFAULT_CHUNK_OVERLAP);

  const chunks: TextChunk[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const limit = Math.min(cursor + size, text.length);
    const end = limit === text.length ? limit : findBreak(text, cursor, limit);
    const piece = text.slice(cursor, end);
    const trimmed = piece.trim();

    if (trimmed.length > 0) {
      // Offsets point at the trimmed text, not the slice, so a citation
      // highlights the words rather than the whitespace around them.
      const lead = piece.length - piece.trimStart().length;
      chunks.push({
        index: chunks.length,
        text: trimmed,
        startOffset: cursor + lead,
        endOffset: cursor + lead + trimmed.length,
      });
    }

    if (end >= text.length) break;
    // Stepped back by at most half of the chunk just emitted, never half of
    // the *requested* size. The two differ whenever a boundary lands early in
    // the window: with size 100 and a sentence ending at 57, an overlap of 50
    // advances the cursor by 7, so a one-page document becomes hundreds of
    // near-identical chunks — hundreds of embedding calls, and retrieval that
    // returns the same sentence over and over. Tying the step-back to what was
    // actually produced bounds the count at two chunks per chunk-length of
    // text, and makes non-termination impossible rather than merely unlikely.
    cursor = end - Math.min(overlap, Math.floor((end - cursor) / 2));
  }

  return chunks;
}

/** The latest acceptable boundary inside the window, or the window's end. */
function findBreak(text: string, from: number, limit: number): number {
  const earliest = from + Math.floor((limit - from) * BOUNDARY_SEARCH_FRACTION);
  const window = text.slice(from, limit);

  for (const pattern of BOUNDARIES) {
    let best = -1;
    // A fresh regex per call: these are global, and a shared `lastIndex`
    // across calls would silently skip matches.
    const search = new RegExp(pattern.source, "g");
    let match: RegExpExecArray | null;

    while ((match = search.exec(window)) !== null) {
      const candidate = from + match.index + match[0].length;
      if (candidate > earliest && candidate < limit) best = candidate;
      // Zero-length matches cannot happen with these patterns, but a guard
      // here is cheaper than an infinite loop if one is ever added.
      if (match[0].length === 0) search.lastIndex += 1;
    }

    if (best > 0) return best;
  }

  return limit;
}
