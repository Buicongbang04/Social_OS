/**
 * Where a trend was read from.
 *
 * Not "the internet" — each source measures a different thing, and a screen
 * that mixed them without saying which is which would invite comparing a
 * search count to a view count.
 */
export const TREND_SOURCES = ["google", "youtube"] as const;
export type TrendSourceName = (typeof TREND_SOURCES)[number];

/**
 * One thing people are looking at right now.
 *
 * `volume` is deliberately a string. Google publishes "200+", "20K+" — a band,
 * not a number — and parsing that into 200 would turn a floor into a
 * measurement. YouTube gives a real view count, and it is rendered as a string
 * too so that nothing downstream can add the two together.
 */
export type TrendItem = {
  source: TrendSourceName;
  /** The search term, or the video title. */
  title: string;
  /** What it is worth looking at, in that source's own units. */
  volume: string | null;
  url: string | null;
  /** When the source says this surfaced, if it says. */
  at: Date | null;
  /** Something that gives the term meaning: a headline, or a channel name. */
  context: string | null;
};

export type TrendQuery = {
  /** ISO 3166-1 alpha-2. Defaults to Vietnam where a source needs one. */
  geo?: string;
  limit?: number;
};

/**
 * A place to read trends from.
 *
 * The port exists so the two sources — one an unauthenticated RSS feed, the
 * other a quota-metered API needing a key — are the same shape to everything
 * above, and a third can arrive without the screen changing.
 */
export interface TrendSource {
  readonly name: TrendSourceName;
  fetch(query: TrendQuery): Promise<TrendItem[]>;
}

/** Anything the source itself refused or could not answer. */
export class TrendSourceError extends Error {
  constructor(
    readonly source: TrendSourceName,
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "TrendSourceError";
  }
}
