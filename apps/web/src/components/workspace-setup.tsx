"use client";

import { isApiError, type Workspace } from "@repo/sdk";
import { useEffect, useState } from "react";
import { getClient, slugify, writeWorkspace } from "../lib/api";
import { ErrorNote, Field, Panel, PrimaryButton } from "./ui";

/**
 * Pick a workspace, or create the first one.
 *
 * A Goal is meaningless without a workspace — it is the tenancy boundary the
 * API authorises every runtime call against — so this stands between signing
 * in and the console rather than being buried in settings.
 */
export function WorkspaceSetup({
  onReady,
}: {
  onReady: (workspace: Workspace) => void;
}) {
  const [existing, setExisting] = useState<Workspace[] | null>(null);
  const [name, setName] = useState("Workspace của tôi");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const client = getClient();
        const organizations = await client.listOrganizations();
        const all: Workspace[] = [];
        for (const organization of organizations) {
          all.push(...(await client.listWorkspaces(organization.id)));
        }
        if (!cancelled) setExisting(all);
      } catch (caught) {
        if (!cancelled) {
          setExisting([]);
          setError(describe(caught));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const choose = (workspace: Workspace) => {
    writeWorkspace(workspace.id);
    onReady(workspace);
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const client = getClient();
      // Slugs are unique per scope, so a fresh suffix avoids colliding with a
      // workspace the user (or a previous run) already created.
      const suffix = Math.random().toString(36).slice(2, 7);
      const base = slugify(name);

      const organization = await client.createOrganization({
        name,
        slug: `${base}-${suffix}`,
      });
      const workspace = await client.createWorkspace({
        organizationId: organization.id,
        name,
        slug: `${base}-ws-${suffix}`,
      });

      choose(workspace);
    } catch (caught) {
      setError(describe(caught));
    } finally {
      setBusy(false);
    }
  };

  if (existing === null) {
    return (
      <Panel title="Workspace">
        <p className="text-sm text-neutral-500">Đang tải…</p>
      </Panel>
    );
  }

  return (
    <Panel
      title="Chọn workspace"
      subtitle="Mọi Goal đều thuộc về một workspace — đây là ranh giới phân tách dữ liệu giữa các tenant."
    >
      <div className="flex flex-col gap-4">
        {existing.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {existing.map((workspace) => (
              <li key={workspace.id}>
                <button
                  type="button"
                  onClick={() => choose(workspace)}
                  className="w-full rounded-md border border-neutral-200 px-3 py-2 text-left text-sm hover:border-neutral-400"
                >
                  <span className="font-medium">{workspace.name}</span>
                  <span className="ml-2 font-mono text-xs text-neutral-400">
                    {workspace.id}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-neutral-500">
            Chưa có workspace nào. Tạo một cái để bắt đầu.
          </p>
        )}

        <div className="border-t border-neutral-200 pt-4">
          <Field label="Tên workspace mới" value={name} onChange={setName} />
          <div className="mt-3">
            <PrimaryButton onClick={create} busy={busy}>
              Tạo workspace
            </PrimaryButton>
          </div>
        </div>

        <ErrorNote message={error} />
      </div>
    </Panel>
  );
}

function describe(caught: unknown): string {
  return isApiError(caught)
    ? `${caught.message} (${caught.code})`
    : `Không gọi được API: ${String(caught)}`;
}
