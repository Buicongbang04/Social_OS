"use client";

import type { PublicUser, Workspace } from "@repo/sdk";
import { useEffect, useState } from "react";
import { GoalConsole } from "../components/goal-console";
import { SignIn } from "../components/sign-in";
import { WorkspaceSetup } from "../components/workspace-setup";
import {
  API_BASE_URL,
  getClient,
  readWorkspace,
  writeWorkspace,
} from "../lib/api";

type Stage =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "no-workspace"; user: PublicUser }
  | { kind: "ready"; user: PublicUser; workspace: Workspace };

/**
 * Verification console.
 *
 * Deliberately one page rather than a dashboard: what this has to answer is
 * "does a natural-language Goal actually get understood, planned, run, and
 * paid for" — and every screen between the objective box and the result is a
 * place that question can get lost. The product surfaces described in
 * docs/frontend/ come later.
 */
export default function HomePage() {
  const [stage, setStage] = useState<Stage>({ kind: "loading" });

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
        // sign-in form is more honest than a console that cannot call anything.
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

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-10">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">
            AI Social OS
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            Bảng kiểm chứng runtime — mô tả mục tiêu, xem nó được hiểu, lập kế
            hoạch, chạy và tốn bao nhiêu.
          </p>
          <p className="mt-1 font-mono text-xs text-neutral-400">
            {API_BASE_URL}
          </p>
        </div>

        {stage.kind === "ready" || stage.kind === "no-workspace" ? (
          <div className="shrink-0 text-right">
            <p className="text-xs text-neutral-500">{stage.user.email}</p>
            <button
              type="button"
              onClick={() => void signOut()}
              className="text-xs text-neutral-500 underline-offset-4 hover:underline"
            >
              Đăng xuất
            </button>
          </div>
        ) : null}
      </header>

      {stage.kind === "loading" ? (
        <p className="text-sm text-neutral-500">Đang tải…</p>
      ) : null}

      {stage.kind === "signed-out" ? (
        <SignIn
          onSignedIn={(user) => setStage({ kind: "no-workspace", user })}
        />
      ) : null}

      {stage.kind === "no-workspace" ? (
        <WorkspaceSetup
          onReady={(workspace) =>
            setStage({ kind: "ready", user: stage.user, workspace })
          }
        />
      ) : null}

      {stage.kind === "ready" ? (
        <GoalConsole workspace={stage.workspace} />
      ) : null}
    </main>
  );
}
