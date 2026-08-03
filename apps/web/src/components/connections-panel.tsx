"use client";

import {
  isApiError,
  type ConnectorSummary,
  type ManageablePage,
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
  const [manualOpen, setManualOpen] = useState(false);
  const [pageId, setPageId] = useState("");
  const [pageToken, setPageToken] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [userToken, setUserToken] = useState("");
  const [pages, setPages] = useState<ManageablePage[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);

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

  const attach = async () => {
    if (pageId.trim() === "" || pageToken.trim() === "") return;
    setBusy("manual");
    try {
      const connection = await getClient().attachConnection("facebook", {
        externalId: pageId.trim(),
        accessToken: pageToken.trim(),
      });
      // Cleared straight away. A live token sitting in an input is one
      // screenshot or shared screen away from being someone else's.
      setPageId("");
      setPageToken("");
      setManualOpen(false);
      setNotice(`Đã nối ${connection.displayName}.`);
      await load();
    } catch (caught) {
      setError(describe(caught));
    } finally {
      setBusy(null);
    }
  };

  /**
   * Read every Page one user token manages.
   *
   * The token stays in state until the Pages are actually connected, because
   * the second call needs it again — the list carries no Page tokens, so the
   * server re-reads them rather than trusting anything the browser sends back.
   */
  const discover = async () => {
    if (userToken.trim() === "") return;
    setBusy("discover");
    setError(null);
    try {
      const found = await getClient().listManageablePages(
        "facebook",
        userToken.trim(),
      );
      setPages(found);
      setPicked(
        found.filter((page) => !page.alreadyConnected).map((p) => p.externalId),
      );
    } catch (caught) {
      setError(describe(caught));
      setPages(null);
    } finally {
      setBusy(null);
    }
  };

  const attachPicked = async () => {
    if (picked.length === 0) return;
    setBusy("attach");
    try {
      const result = await getClient().attachPages("facebook", {
        userAccessToken: userToken.trim(),
        externalIds: picked,
      });

      // Cleared the moment it is no longer needed. A live token sitting in an
      // input is one shared screen away from being someone else's.
      setUserToken("");
      setPages(null);
      setPicked([]);
      setBulkOpen(false);

      // Both halves, always. Saying "connected 8" while two failed silently is
      // how somebody finds out weeks later, from a post that never went out.
      setNotice(
        `Đã nối ${result.connected.length} trang.` +
          (result.failed.length > 0
            ? ` Không nối được ${result.failed.length}: ${result.failed
                .map((entry) => `${entry.externalId} (${entry.reason})`)
                .join("; ")}`
            : ""),
      );
      await load();
    } catch (caught) {
      setError(describe(caught));
    } finally {
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

      <div className="mb-3">
        <button
          type="button"
          onClick={() => setBulkOpen((open) => !open)}
          className="text-xs text-neutral-500 underline hover:text-neutral-900"
        >
          {bulkOpen
            ? "Ẩn"
            : "Quản nhiều Page? Dán một user token, chọn trang để nối"}
        </button>

        {bulkOpen ? (
          <div className="mt-2 rounded-md border border-neutral-200 p-3">
            <div className="flex flex-wrap items-end gap-2">
              <input
                type="password"
                autoComplete="off"
                value={userToken}
                onChange={(event) => setUserToken(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void discover();
                }}
                placeholder="User access token"
                className="min-w-0 flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
              />
              <PrimaryButton
                busy={busy === "discover"}
                onClick={() => void discover()}
                disabled={userToken.trim() === ""}
              >
                Xem danh sách Page
              </PrimaryButton>
            </div>

            <p className="mt-2 text-xs text-neutral-500">
              Đây là user token, không phải Page token. Nền tảng đọc danh sách
              Page bạn quản, bạn tick trang nào thì chỉ trang đó được nối. Token
              của từng Page do máy chủ tự đọc lại — nó không bao giờ đi qua
              trình duyệt.
            </p>

            {pages !== null ? (
              pages.length === 0 ? (
                <p className="mt-3 text-sm text-neutral-500">
                  Token này không quản Page nào.
                </p>
              ) : (
                <div className="mt-3">
                  <ul className="flex flex-col gap-1">
                    {pages.map((page) => (
                      <li key={page.externalId} className="text-sm">
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            disabled={page.alreadyConnected}
                            checked={picked.includes(page.externalId)}
                            onChange={(event) =>
                              setPicked((current) =>
                                event.target.checked
                                  ? [...current, page.externalId]
                                  : current.filter(
                                      (id) => id !== page.externalId,
                                    ),
                              )
                            }
                          />
                          <span
                            className={
                              page.alreadyConnected ? "text-neutral-400" : ""
                            }
                          >
                            {page.displayName}
                          </span>
                          {/* Shown rather than filtered out: somebody looking
                              for a Page they connected last week should find
                              it here with a reason, not wonder whether the
                              token is wrong. */}
                          {page.alreadyConnected ? (
                            <span className="text-xs text-neutral-400">
                              đã nối rồi
                            </span>
                          ) : null}
                        </label>
                      </li>
                    ))}
                  </ul>

                  <div className="mt-3">
                    <PrimaryButton
                      busy={busy === "attach"}
                      onClick={() => void attachPicked()}
                      disabled={picked.length === 0}
                    >
                      Nối {picked.length} trang đã chọn
                    </PrimaryButton>
                  </div>
                </div>
              )
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="mb-3">
        <button
          type="button"
          onClick={() => setManualOpen((open) => !open)}
          className="text-xs text-neutral-500 underline hover:text-neutral-900"
        >
          {manualOpen ? "Ẩn" : "Đã có Page ID và access token? Nhập tay"}
        </button>

        {manualOpen ? (
          <div className="mt-2 flex flex-wrap items-end gap-2 rounded-md border border-neutral-200 p-3">
            {/* Here because getting a Meta app through review takes weeks.
                Beside the OAuth button, never replacing it: OAuth is what a
                tenant should use, since they never hand a credential over. */}
            <input
              value={pageId}
              onChange={(event) => setPageId(event.target.value)}
              placeholder="Page ID"
              className="w-48 rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
            />
            <input
              type="password"
              autoComplete="off"
              value={pageToken}
              onChange={(event) => setPageToken(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void attach();
              }}
              placeholder="Page access token"
              className="min-w-0 flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
            />
            <PrimaryButton
              busy={busy === "manual"}
              onClick={() => void attach()}
              disabled={pageId.trim() === "" || pageToken.trim() === ""}
            >
              Nối Page
            </PrimaryButton>
            <p className="w-full text-xs text-neutral-500">
              Token được kiểm tra với Facebook trước khi lưu, và mã hoá khi lưu.
              Không có đường nào đọc ngược ra.
            </p>
          </div>
        ) : null}
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
              {/* Shown apart because the remedy differs: an expired token is
                  fixed by reconnecting here, while a revoked one will refuse
                  the reconnection too until the permission is restored on the
                  platform itself. Telling someone to press a button that
                  cannot work is worse than telling them nothing. */}
              {connection.status === "EXPIRED" ? (
                <span className="shrink-0 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                  hết hạn — nối lại là được
                </span>
              ) : connection.status === "REVOKED" ? (
                <span className="shrink-0 rounded bg-red-100 px-2 py-0.5 text-xs text-red-800">
                  bị thu hồi — cấp lại quyền bên nền tảng trước
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
