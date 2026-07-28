"use client";

import {
  isApiError,
  type ProviderKeyStatus,
  type StoredSecret,
} from "@repo/sdk";
import { useCallback, useEffect, useState } from "react";
import { getClient } from "../lib/api";
import { ErrorNote, Panel, PrimaryButton } from "./ui";

/**
 * The providers a workspace can bring a key for.
 *
 * Ollama is absent on purpose: it runs locally and takes no credential, so a
 * field for one would be a box that does nothing.
 */
const PROVIDERS = [
  { id: "anthropic", label: "Anthropic", hint: "sk-ant-…" },
  { id: "openai", label: "OpenAI", hint: "sk-…" },
  { id: "google", label: "Google", hint: "AIza…" },
  { id: "openrouter", label: "OpenRouter", hint: "sk-or-…" },
] as const;

const secretName = (provider: string) => `providers/${provider}`;

/**
 * Where a workspace connects its own AI provider key.
 *
 * The screen has to answer a question the API deliberately cannot: nothing ever
 * reads a stored value back out, so a key that was saved but is not being used
 * looks exactly like one that works. That is what the banner at the top is for —
 * it says whose credential the next message will actually spend.
 */
export function KeysPanel() {
  const [secrets, setSecrets] = useState<StoredSecret[] | null>(null);
  const [status, setStatus] = useState<ProviderKeyStatus | null>(null);
  const [provider, setProvider] = useState<string>(PROVIDERS[0].id);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const client = getClient();
      const [stored, keys] = await Promise.all([
        client.listSecrets(),
        client.providerKeys(),
      ]);
      setSecrets(stored);
      setStatus(keys);
      setError(null);
    } catch (caught) {
      setError(describe(caught));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const connect = async () => {
    if (value.trim() === "") return;
    setBusy(true);
    try {
      await getClient().putSecret({
        name: secretName(provider),
        value: value.trim(),
      });
      // Cleared immediately. A key left sitting in an input is one screenshot,
      // one shoulder, or one shared screen away from being someone else's.
      setValue("");
      await load();
    } catch (caught) {
      setError(describe(caught));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (secret: StoredSecret) => {
    try {
      await getClient().deleteSecret(secret.id);
      await load();
    } catch (caught) {
      setError(describe(caught));
    }
  };

  const providerSecrets = (secrets ?? []).filter((secret) =>
    secret.name.startsWith("providers/"),
  );

  return (
    <Panel
      title="Khoá AI của workspace"
      subtitle="Kết nối key riêng để chạy trên hạn mức của bạn, không dùng chung của nền tảng."
    >
      {status === null ? null : status.source === "workspace" ? (
        <p className="mb-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          Đang chạy bằng key của workspace ({status.providers.join(", ")}).
        </p>
      ) : (
        <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Đang dùng key chung của nền tảng. Kết nối key riêng để tiêu hạn mức
          của chính bạn.
        </p>
      )}

      <div className="mb-3 flex flex-wrap items-end gap-2">
        <select
          value={provider}
          onChange={(event) => setProvider(event.target.value)}
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
        >
          {PROVIDERS.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ))}
        </select>
        <input
          // A password field, not because anyone is looking over your shoulder
          // right now, but because pasting a live credential into a visible box
          // puts it in every screen recording and screenshot from then on.
          type="password"
          autoComplete="off"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void connect();
          }}
          placeholder={
            PROVIDERS.find((entry) => entry.id === provider)?.hint ?? ""
          }
          className="min-w-0 flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
        />
        <PrimaryButton
          busy={busy}
          onClick={() => void connect()}
          disabled={value.trim() === ""}
        >
          Kết nối
        </PrimaryButton>
      </div>

      {secrets === null ? (
        <p className="text-sm text-neutral-500">Đang tải…</p>
      ) : providerSecrets.length === 0 ? (
        <p className="text-sm text-neutral-500">
          Chưa kết nối key nào. Key được mã hoá trước khi lưu và không có đường
          nào đọc ngược ra — kể cả bạn.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {providerSecrets.map((secret) => (
            <li
              key={secret.id}
              className="flex flex-wrap items-center gap-3 rounded-md border border-neutral-200 px-3 py-2 text-sm"
            >
              <span className="shrink-0 font-medium">{label(secret.name)}</span>
              {/* The masked tail, which is all anyone gets. Enough to tell two
                  keys apart when you are about to replace one. */}
              <span className="min-w-0 flex-1 font-mono text-neutral-500">
                {secret.hint}
              </span>
              {secret.activeVersion > 1 ? (
                <span className="shrink-0 text-xs text-neutral-500">
                  bản {secret.activeVersion}
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => void disconnect(secret)}
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

function label(name: string): string {
  const id = name.slice("providers/".length);
  return PROVIDERS.find((entry) => entry.id === id)?.label ?? id;
}

function describe(error: unknown): string {
  return isApiError(error) ? `${error.message} (${error.code})` : String(error);
}
