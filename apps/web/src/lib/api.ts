"use client";

import { ApiClient, type AuthTokens } from "@repo/sdk";

const TOKEN_KEY = "aisos.tokens";
const WORKSPACE_KEY = "aisos.workspace";

/**
 * Where the API lives. Defaults to the port docker-compose and .env.example
 * use, so a fresh clone works with no configuration.
 */
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3100/api/v1";

/**
 * Tokens survive a reload.
 *
 * localStorage is readable by any script on the origin, so this is only
 * appropriate while the platform is single-origin and pre-production. The
 * production answer is an httpOnly refresh cookie — noted here rather than in
 * a backlog because the next person to touch this file is the one who needs
 * to know.
 */
function browserTokenStore() {
  return {
    read(): AuthTokens | null {
      if (typeof window === "undefined") return null;
      const raw = window.localStorage.getItem(TOKEN_KEY);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as AuthTokens;
      } catch {
        // Corrupt or from an older shape: drop it rather than crash on boot.
        window.localStorage.removeItem(TOKEN_KEY);
        return null;
      }
    },
    write(tokens: AuthTokens | null): void {
      if (typeof window === "undefined") return;
      if (tokens) {
        window.localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
      } else {
        window.localStorage.removeItem(TOKEN_KEY);
      }
    },
  };
}

let client: ApiClient | null = null;

/**
 * One client for the tab.
 *
 * Shared on purpose: the single-flight refresh only works if every request
 * goes through the same instance. A per-component client would let several
 * refreshes race, and refresh tokens are one-time-use — the race would sign
 * the user out.
 */
export function getClient(): ApiClient {
  client ??= new ApiClient({
    baseUrl: API_BASE_URL,
    tokens: browserTokenStore(),
    workspaceId: readWorkspace(),
    onSignedOut: () => {
      writeWorkspace(null);
    },
  });
  return client;
}

export function readWorkspace(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(WORKSPACE_KEY);
}

export function writeWorkspace(workspaceId: string | null): void {
  if (typeof window === "undefined") return;
  if (workspaceId) {
    window.localStorage.setItem(WORKSPACE_KEY, workspaceId);
  } else {
    window.localStorage.removeItem(WORKSPACE_KEY);
  }
  getClient().setWorkspace(workspaceId);
}

/** `Nhà máy Nội dung` → `nha-may-noi-dung`, which is what the API's slug rules accept. */
export function slugify(value: string): string {
  return (
    value
      .normalize("NFD")
      // Strip Vietnamese diacritics; đ/Đ has no decomposed form, so it is
      // replaced separately below.
      .replace(/[̀-ͯ]/g, "")
      .replace(/[đĐ]/g, "d")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "workspace"
  );
}
