"use client";

import { isApiError, type PublicUser } from "@repo/sdk";
import { useState } from "react";
import { getClient } from "../lib/api";
import { Field, Panel, PrimaryButton, ErrorNote } from "./ui";

/** The API's own floor. Stated here so the form can say so before submitting. */
const MIN_PASSWORD_LENGTH = 12;

export function SignIn({
  onSignedIn,
}: {
  onSignedIn: (user: PublicUser) => void;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});

    try {
      const client = getClient();
      const result =
        mode === "login"
          ? await client.login({ email, password })
          : await client.register({ email, password });
      onSignedIn(result.user);
    } catch (caught) {
      if (isApiError(caught)) {
        setFields(caught.fieldErrors());
        setError(
          // 401 on login is deliberately vague server-side so the endpoint
          // cannot be used to find out which emails are registered. Saying
          // "wrong email or password" keeps that property in the UI too.
          caught.status === 401
            ? "Email hoặc mật khẩu không đúng."
            : caught.message,
        );
      } else {
        setError(
          `Không gọi được API. Kiểm tra services/api đã chạy chưa. (${String(caught)})`,
        );
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title={mode === "login" ? "Đăng nhập" : "Tạo tài khoản"}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
          error={fields.email}
          required
        />
        <Field
          label="Mật khẩu"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          error={fields.password}
          hint={
            mode === "register"
              ? `Tối thiểu ${MIN_PASSWORD_LENGTH} ký tự.`
              : undefined
          }
          required
        />

        <ErrorNote message={error} />

        <PrimaryButton type="submit" busy={busy}>
          {mode === "login" ? "Đăng nhập" : "Tạo tài khoản"}
        </PrimaryButton>

        <button
          type="button"
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError(null);
            setFields({});
          }}
          className="text-sm text-neutral-500 underline-offset-4 hover:underline"
        >
          {mode === "login"
            ? "Chưa có tài khoản? Tạo mới"
            : "Đã có tài khoản? Đăng nhập"}
        </button>
      </form>
    </Panel>
  );
}
