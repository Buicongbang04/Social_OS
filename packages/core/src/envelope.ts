import type { ErrorDetail } from "./errors";

/**
 * Response envelopes, per docs/api/03_REST_API.md (success) and
 * docs/api/02_API_DESIGN_GUIDELINES.md (error).
 */
export type SuccessEnvelope<TData> = {
  data: TData;
  meta?: Record<string, unknown>;
  links?: Record<string, string | null>;
};

export type ErrorEnvelope = {
  code: string;
  message: string;
  requestId: string;
  timestamp: string;
  /**
   * Field-level errors. Extends the 4-field envelope in the docs — 422
   * responses are unusable without per-field detail.
   */
  details?: ErrorDetail[];
};

/** Cursor pagination, per docs/api/02_API_DESIGN_GUIDELINES.md (`?cursor=&limit=`). */
export type CursorPage<TItem> = {
  items: TItem[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type CursorPageQuery = {
  cursor?: string;
  limit: number;
};

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

export function toSuccessEnvelope<TData>(
  data: TData,
  meta?: Record<string, unknown>,
  links?: Record<string, string | null>,
): SuccessEnvelope<TData> {
  return {
    data,
    ...(meta ? { meta } : {}),
    ...(links ? { links } : {}),
  };
}

export function toPagedEnvelope<TItem>(
  page: CursorPage<TItem>,
): SuccessEnvelope<TItem[]> {
  return {
    data: page.items,
    meta: { hasMore: page.hasMore, count: page.items.length },
    links: { next: page.nextCursor },
  };
}
