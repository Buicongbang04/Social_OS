"use client";

import type { ReactNode } from "react";

export function Panel({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-neutral-900">{title}</h2>
          {subtitle ? (
            <p className="mt-1 text-sm text-neutral-500">{subtitle}</p>
          ) : null}
        </div>
        {actions}
      </header>
      {children}
    </section>
  );
}

export function Field({
  label,
  value,
  onChange,
  type = "text",
  error,
  hint,
  ...rest
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  error?: string | undefined;
  hint?: string | undefined;
  autoComplete?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-neutral-700">{label}</span>
      <input
        {...rest}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-900/10 ${
          error ? "border-red-400" : "border-neutral-300"
        }`}
      />
      {error ? (
        <span className="text-xs text-red-600">{error}</span>
      ) : hint ? (
        <span className="text-xs text-neutral-500">{hint}</span>
      ) : null}
    </label>
  );
}

export function PrimaryButton({
  children,
  busy,
  type = "button",
  onClick,
  disabled,
}: {
  children: ReactNode;
  busy?: boolean;
  type?: "button" | "submit";
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={busy || disabled}
      className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-50"
    >
      {busy ? "Đang xử lý…" : children}
    </button>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      {message}
    </p>
  );
}

/**
 * Colour carries meaning here, so the label is always spelled out too — a
 * status conveyed by colour alone is invisible to anyone who cannot see it.
 */
const STATUS_TONES: Record<string, string> = {
  COMPLETED: "bg-emerald-100 text-emerald-800",
  SUCCESS: "bg-emerald-100 text-emerald-800",
  RUNNING: "bg-blue-100 text-blue-800",
  PLANNING: "bg-blue-100 text-blue-800",
  QUEUED: "bg-blue-100 text-blue-800",
  READY: "bg-blue-100 text-blue-800",
  RETRYING: "bg-amber-100 text-amber-800",
  WAITING: "bg-amber-100 text-amber-800",
  PAUSED: "bg-amber-100 text-amber-800",
  FAILED: "bg-red-100 text-red-800",
  DEAD_LETTER: "bg-red-100 text-red-800",
  CANCELLED: "bg-neutral-200 text-neutral-700",
  CANCELLING: "bg-neutral-200 text-neutral-700",
};

export function StatusBadge({ status }: { status: string }) {
  const tone = STATUS_TONES[status] ?? "bg-neutral-100 text-neutral-600";
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 font-mono text-xs font-medium ${tone}`}
    >
      {status}
    </span>
  );
}
