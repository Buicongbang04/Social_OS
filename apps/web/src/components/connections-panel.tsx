"use client";

import {
  isApiError,
  type ConnectorSummary,
  type SocialConnection,
} from "@repo/sdk";
import { useCallback, useEffect, useState } from "react";
import { getClient } from "../lib/api";
import { ErrorNote, Panel, PrimaryButton } from "./ui";

/**
 * The platforms a workspace publishes to.
 *
 * The connect button hands the browser to the platform's own consent screen and
 * nothing else — no field to paste a token into, no password. That is the whole
 * point of doing OAuth rather than asking for credentials: the person types
 * their password only into the site that owns it, sees exactly what they are
 * granting, and can take it back from the platform's own settings without
 * coming here.
 */
export function ConnectionsPanel() {
  const [connections, setConnections] = useState<SocialConnection[] | null>(
    null,
  );
  const [catalog, setCatalog] = useState<ConnectorSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const client = getClient();
      const [connected, platforms] = await Promise.all([
        client.listConnections(),
        client.connectorCatalog(),
      ]);
      setConnections(connected);
      setCatalog(platforms);
      setError(null);
    } catch (caught) {
      setError(describe(caught));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Read the result the callback carried back in the URL.
   *
   * Cleared from the address bar afterwards, so a refresh does not replay a
   * message about something that happened once.
   */
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const outcome = query.get("connected");
    if (!outcome) return;

    setNotice(
      outcome === "ok"
        ? `Đã kết nối ${query.get("account") ?? query.get("connector") ?? ""}.`
        : outcome === "cancelled"
          ? "Bạn đã huỷ ở màn hình của nền tảng. Chưa kết nối gì."
          : "Kết nối không thành công. Hãy thử lại.",
    );

    window.history.replaceState({}, "", window.location.pathname);
    void load();
  }, [load]);

  const connect = async (connectorId: string) => {
    setBusy(connectorId);
    try {
      const { url } = await getClient().startConnection(connectorId);
      // The platform's consent screen, in this tab. A popup would be blocked
      // about as often as it worked, and these flows redirect several times.
      window.location.href = url;
    } catch (caught) {
      setError(describe(caught));
      setBusy(null);
    }
  };

  const remove = async (connection: SocialConnection) => {
    try {
      await getClient().disconnect(connection.id);
      await load();
    } catch (caught) {
      setError(describe(caught));
    }
  };

  return (
    <Panel
      title="Kênh mạng xã hội"
      subtitle="Kết nối để nền tảng đăng bài thay bạn. Không chỗ nào hỏi mật khẩu của bạn."
    >
      {notice ? (
        <p className="mb-3 rounded-md bg-neutral-100 px-3 py-2 text-sm text-neutral-800">
          {notice}
        </p>
      ) : null}

      <div className="mb-3 flex flex-wrap gap-2">
        {catalog.map((platform) => (
          <PrimaryButton
            key={platform.id}
            busy={busy === platform.id}
            disabled={!platform.configured}
            onClick={() => void connect(platform.id)}
          >
            {/* An unconfigured platform stays visible but disabled. Hiding it
                would read as "not supported" and never tell the operator they
                forgot to register an app. */}
            {platform.configured
              ? `Kết nối ${platform.name}`
              : `${platform.name} (chưa cấu hình)`}
          </PrimaryButton>
        ))}
      </div>

      {connections === null ? (
        <p className="text-sm text-neutral-500">Đang tải…</p>
      ) : connections.length === 0 ? (
        <p className="text-sm text-neutral-500">
          Chưa kết nối kênh nào. Bấm một nút ở trên để tới màn hình cấp quyền
          của chính nền tảng đó.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {connections.map((connection) => (
            <li
              key={connection.id}
              className="flex flex-wrap items-center gap-3 rounded-md border border-neutral-200 px-3 py-2 text-sm"
            >
              <span className="shrink-0 rounded bg-neutral-100 px-2 py-0.5 text-xs">
                {nameOf(catalog, connection.connectorId)}
              </span>
              <span className="min-w-0 flex-1 font-medium">
                {connection.displayName}
              </span>
              {/* Expired and revoked are shown apart because the fix differs:
                  expired is reconnecting, revoked needs the permission put back
                  on the platform first. */}
              {connection.status === "EXPIRED" ? (
                <span className="shrink-0 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                  hết hạn — kết nối lại
                </span>
              ) : null}
              <span
                className="shrink-0 text-xs text-neutral-500"
                title={connection.scopes.join(", ")}
              >
                {connection.scopes.length} quyền
              </span>
              <button
                type="button"
                onClick={() => void remove(connection)}
                className="shrink-0 text-xs text-neutral-500 underline hover:text-red-700"
              >
                Gỡ
              </button>
            </li>
          ))}
        </ul>
      )}

      <ErrorNote message={error} />
    </Panel>
  );
}

function nameOf(catalog: ConnectorSummary[], id: string): string {
  return catalog.find((entry) => entry.id === id)?.name ?? id;
}

function describe(error: unknown): string {
  return isApiError(error) ? `${error.message} (${error.code})` : String(error);
}
