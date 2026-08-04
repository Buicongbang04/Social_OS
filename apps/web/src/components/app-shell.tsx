"use client";

import type { PublicUser, Workspace } from "@repo/sdk";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  API_BASE_URL,
  getClient,
  readWorkspace,
  writeWorkspace,
} from "../lib/api";
import { AlertBanner } from "./alert-banner";
import { SignIn } from "./sign-in";
import { WorkspaceSetup } from "./workspace-setup";

/**
 * The sections, in the order somebody works through them.
 *
 * Grouped by what a person is doing, not by which API each panel calls. Trends
 * and the studio sit together because a trend becomes a brief in one click and
 * a page boundary between them would break that; settings are one place
 * because nobody visits them in the course of a day.
 */
type Section = {
  href: string;
  label: string;
  hint: string;
  /** Sub-sections, shown only while somebody is inside this branch. */
  children?: { href: string; label: string }[];
};

export const SECTIONS: Section[] = [
  { href: "/", label: "Tổng quan", hint: "Có gì hỏng, và mọi thứ đang ra sao" },
  {
    href: "/viet/soan",
    label: "Viết bài",
    hint: "Phân tích đối thủ rồi soạn nội dung",
    children: [
      { href: "/viet/doi-thu", label: "Phân tích đối thủ" },
      { href: "/viet/soan", label: "Soạn nội dung" },
    ],
  },
  { href: "/lich", label: "Lịch đăng", hint: "Bài nào đi lúc nào" },
  {
    href: "/hop-thu",
    label: "Hộp thư",
    hint: "Tin nhắn và bình luận của khách",
  },
  { href: "/so-lieu", label: "Số liệu", hint: "Bài đã đăng và chi tiêu" },
  { href: "/tro-chuyen", label: "Trò chuyện", hint: "Hỏi đáp với trợ lý" },
  { href: "/tu-dong", label: "Tự động", hint: "Goal và lịch sử chạy" },
  { href: "/cai-dat", label: "Cài đặt", hint: "Kênh, khoá, ghi nhớ, tài liệu" },
];

type Stage =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "no-workspace"; user: PublicUser }
  | { kind: "ready"; user: PublicUser; workspace: Workspace };

/**
 * Everything that is the same on every screen.
 *
 * Sign-in, the workspace, the navigation and the alert banner live here rather
 * than in each page, because a guard repeated eight times is a guard that will
 * be missing from one of them.
 *
 * `children` is a function rather than a node: the pages need the workspace,
 * and passing it down is how they get it without every one of them resolving
 * the session again.
 */
export function AppShell({
  children,
}: {
  children: (workspace: Workspace) => ReactNode;
}) {
  const [stage, setStage] = useState<Stage>({ kind: "loading" });
  const pathname = usePathname();

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const client = getClient();
      if (!client.isAuthenticated()) {
        if (!cancelled) setStage({ kind: "signed-out" });
        return;
      }

      try {
        const user = await client.me();
        if (cancelled) return;

        // A stored workspace id is only a hint: it may belong to a session
        // that is gone, or to a workspace the user was removed from. It is
        // re-resolved against the API rather than trusted.
        const stored = readWorkspace();
        if (!stored) {
          setStage({ kind: "no-workspace", user });
          return;
        }

        const organizations = await client.listOrganizations();
        for (const organization of organizations) {
          const workspaces = await client.listWorkspaces(organization.id);
          const match = workspaces.find((w) => w.id === stored);
          if (match) {
            if (!cancelled) setStage({ kind: "ready", user, workspace: match });
            return;
          }
        }

        if (!cancelled) {
          writeWorkspace(null);
          setStage({ kind: "no-workspace", user });
        }
      } catch {
        // Any failure here means the stored session is unusable. Showing the
        // sign-in form is more honest than a console that cannot call
        // anything.
        if (!cancelled) setStage({ kind: "signed-out" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const signOut = async () => {
    await getClient()
      .logout()
      .catch(() => undefined);
    writeWorkspace(null);
    setStage({ kind: "signed-out" });
  };

  if (stage.kind === "loading") {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <p className="text-sm text-neutral-500">Đang tải…</p>
      </main>
    );
  }

  if (stage.kind === "signed-out") {
    return (
      <main className="mx-auto max-w-lg px-6 py-16">
        <Brand />
        <SignIn
          onSignedIn={(user) => setStage({ kind: "no-workspace", user })}
        />
      </main>
    );
  }

  if (stage.kind === "no-workspace") {
    return (
      <main className="mx-auto max-w-lg px-6 py-16">
        <Brand />
        <WorkspaceSetup
          onReady={(workspace) => {
            writeWorkspace(workspace.id);
            setStage({ kind: "ready", user: stage.user, workspace });
          }}
        />
      </main>
    );
  }

  return (
    <div className="flex min-h-screen">
      <nav
        aria-label="Khu vực"
        className="hidden w-56 shrink-0 border-r border-neutral-200 bg-white p-4 md:block"
      >
        <Brand compact />

        <ul className="mt-6 flex flex-col gap-0.5">
          {SECTIONS.map((section) => {
            // Exact for the overview, prefix for the rest: otherwise "/" is
            // marked current on every page, which tells the reader nothing.
            // A section with children owns a whole branch, so it is matched
            // on that branch rather than on its own default child — otherwise
            // "Viết bài" goes dark the moment somebody opens the sub-section
            // that is not the default.
            const branch = section.children
              ? section.href.slice(0, section.href.lastIndexOf("/"))
              : section.href;
            const current =
              branch === "/" ? pathname === "/" : pathname.startsWith(branch);

            return (
              <li key={section.href}>
                <Link
                  href={section.href}
                  aria-current={
                    current && !section.children ? "page" : undefined
                  }
                  className={`block rounded-md px-3 py-2 text-sm ${
                    current
                      ? "bg-neutral-900 text-white"
                      : "text-neutral-700 hover:bg-neutral-100"
                  }`}
                >
                  {section.label}
                </Link>

                {/* Sub-sections only while inside them. Showing every child of
                    every section turns a list of eight into a list of twelve,
                    which is the wall this redesign took down. */}
                {section.children && current ? (
                  <ul className="mt-0.5 flex flex-col gap-0.5">
                    {section.children.map((child) => (
                      <li key={child.href}>
                        <Link
                          href={child.href}
                          aria-current={
                            pathname === child.href ? "page" : undefined
                          }
                          className={`block rounded-md py-1.5 pl-6 pr-3 text-sm ${
                            pathname === child.href
                              ? "font-medium text-neutral-900"
                              : "text-neutral-600 hover:text-neutral-900"
                          }`}
                        >
                          {child.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="min-w-0 flex-1 bg-neutral-50">
        <header className="flex flex-wrap items-center gap-3 border-b border-neutral-200 bg-white px-6 py-3">
          {/* On a phone the sidebar is gone, so the sections become a strip
              that scrolls. A hamburger would hide the one thing this redesign
              exists to make visible. */}
          <nav
            aria-label="Khu vực"
            className="flex gap-1 overflow-x-auto md:hidden"
          >
            {SECTIONS.map((section) => (
              <Link
                key={section.href}
                href={section.href}
                className={`shrink-0 rounded px-2 py-1 text-xs ${
                  pathname === section.href
                    ? "bg-neutral-900 text-white"
                    : "text-neutral-600"
                }`}
              >
                {section.label}
              </Link>
            ))}
          </nav>

          <span className="ml-auto text-xs text-neutral-500">
            {stage.workspace.name}
          </span>
          <span className="text-xs text-neutral-400">{stage.user.email}</span>
          <button
            type="button"
            onClick={() => void signOut()}
            className="text-xs text-neutral-500 underline-offset-4 hover:underline"
          >
            Đăng xuất
          </button>
        </header>

        <main className="mx-auto flex max-w-4xl flex-col gap-5 px-6 py-6">
          {/* Above the section's own content, on every page. What it reports —
              a dead channel, posts that never went out — makes whatever is
              below it misleading until somebody deals with it. */}
          <AlertBanner />
          {children(stage.workspace)}
        </main>
      </div>
    </div>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "" : "mb-6"}>
      <p className="text-base font-semibold text-neutral-900">AI Social OS</p>
      {compact ? null : (
        <p className="mt-1 font-mono text-xs text-neutral-400">
          {API_BASE_URL}
        </p>
      )}
    </div>
  );
}

/** A heading for a section, so a page says what it is without a panel doing it. */
export function SectionHeader({
  title,
  hint,
}: {
  title: string;
  hint?: string;
}) {
  return (
    <div>
      <h1 className="text-lg font-semibold text-neutral-900">{title}</h1>
      {hint ? <p className="mt-0.5 text-sm text-neutral-500">{hint}</p> : null}
    </div>
  );
}
