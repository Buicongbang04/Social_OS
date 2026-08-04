"use client";

/**
 * A brief on its way from one page to another.
 *
 * The competitor reader and the composer are separate sections now, so the
 * handoff crosses a navigation. `sessionStorage` rather than a query string:
 * a brief is a paragraph of somebody's own words, and a paragraph in a URL
 * ends up in history, in logs, and in whatever is pasted into a chat later.
 *
 * Read once and cleared, so going back to the composer later does not silently
 * refill the box with something written an hour ago.
 */
const KEY = "aisos.brief";

export function handOffBrief(text: string): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(KEY, text);
}

export function takeBrief(): string | null {
  if (typeof window === "undefined") return null;
  const text = window.sessionStorage.getItem(KEY);
  if (text !== null) window.sessionStorage.removeItem(KEY);
  return text;
}
