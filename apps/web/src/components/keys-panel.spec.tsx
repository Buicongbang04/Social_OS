import type { StoredSecret } from "@repo/sdk";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KeysPanel } from "./keys-panel";

const client = {
  listSecrets: vi.fn(),
  providerKeys: vi.fn(),
  putSecret: vi.fn(),
  deleteSecret: vi.fn(),
};

vi.mock("../lib/api", () => ({ getClient: () => client }));

const secret = (overrides: Partial<StoredSecret> = {}): StoredSecret =>
  ({
    id: "sec_1",
    name: "providers/anthropic",
    scope: "WORKSPACE",
    hint: "••••••••a1b2",
    activeVersion: 1,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  }) as StoredSecret;

const show = async (
  secrets: StoredSecret[] = [],
  source: "workspace" | "platform" = "platform",
) => {
  client.listSecrets.mockResolvedValue(secrets);
  client.providerKeys.mockResolvedValue({
    source,
    providers: source === "workspace" ? ["anthropic"] : [],
  });
  render(<KeysPanel />);
  await screen.findByRole("button", { name: "Kết nối" });
};

beforeEach(() => {
  client.putSecret.mockResolvedValue(secret());
  client.deleteSecret.mockResolvedValue(undefined);
});

describe("KeysPanel", () => {
  it("says whose key the next message will spend", async () => {
    // The question the API deliberately cannot answer: nothing reads a stored
    // value back, so a key that was saved but is not being used looks exactly
    // like one that works.
    await show([], "platform");

    expect(screen.getByText(/key chung của nền tảng/)).toBeVisible();
  });

  it("says when the workspace is on its own key, and which provider", async () => {
    await show([secret()], "workspace");

    expect(screen.getByText(/key của workspace \(anthropic\)/)).toBeVisible();
  });

  it("stores a key under the provider that was chosen", async () => {
    await show();

    await userEvent.selectOptions(screen.getByRole("combobox"), "openai");
    await userEvent.type(screen.getByPlaceholderText("sk-…"), "sk-live-123456");
    await userEvent.click(screen.getByRole("button", { name: "Kết nối" }));

    await waitFor(() =>
      expect(client.putSecret).toHaveBeenCalledWith({
        name: "providers/openai",
        value: "sk-live-123456",
      }),
    );
  });

  it("clears the key out of the input the moment it is stored", async () => {
    // A live credential left in a box is one screenshot, one shoulder or one
    // shared screen away from being somebody else's.
    await show();

    const input = screen.getByPlaceholderText("sk-ant-…");
    await userEvent.type(input, "sk-ant-secret-value");
    await userEvent.click(screen.getByRole("button", { name: "Kết nối" }));

    await waitFor(() => expect(input).toHaveValue(""));
  });

  it("hides the key while it is being typed", async () => {
    await show();

    expect(screen.getByPlaceholderText("sk-ant-…")).toHaveAttribute(
      "type",
      "password",
    );
  });

  it("will not send an empty key", async () => {
    await show();

    expect(screen.getByRole("button", { name: "Kết nối" })).toBeDisabled();
  });

  it("shows only the masked tail of a stored key", async () => {
    // All anyone gets, and enough to tell two keys apart when replacing one.
    await show([secret({ hint: "••••••••a1b2" })]);

    // Scoped to the row: "Anthropic" is also an option in the picker above,
    // so an unscoped query would pass without the key ever being listed.
    const row = screen.getByRole("listitem");
    expect(within(row).getByText("••••••••a1b2")).toBeVisible();
    expect(within(row).getByText("Anthropic")).toBeVisible();
  });

  it("leaves secrets that are not provider keys out of the list", async () => {
    // The vault also holds connection tokens. Showing them here would invite
    // somebody to remove a Facebook connection from the AI keys panel.
    await show([
      secret(),
      secret({ id: "sec_2", name: "connections/facebook/page-1" }),
    ]);

    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("says which version a rotated key is on", async () => {
    await show([secret({ activeVersion: 3 })]);

    expect(screen.getByText("bản 3")).toBeVisible();
  });

  it("says nothing about a version when there has only been one", async () => {
    await show([secret({ activeVersion: 1 })]);

    expect(screen.queryByText(/^bản /)).toBeNull();
  });

  it("removes a key and reads the list back", async () => {
    await show([secret()]);
    client.listSecrets.mockClear();

    await userEvent.click(screen.getByRole("button", { name: "Gỡ" }));

    await waitFor(() =>
      expect(client.deleteSecret).toHaveBeenCalledWith("sec_1"),
    );
    await waitFor(() => expect(client.listSecrets).toHaveBeenCalled());
  });

  it("promises the key cannot be read back, where somebody is deciding to paste one", async () => {
    await show([]);

    expect(screen.getByText(/không có đường nào đọc ngược ra/)).toBeVisible();
  });

  it("says what went wrong instead of failing silently", async () => {
    await show();
    client.putSecret.mockRejectedValue(new Error("khoá mã hoá chưa cấu hình"));

    await userEvent.type(screen.getByPlaceholderText("sk-ant-…"), "sk-ant-x");
    await userEvent.click(screen.getByRole("button", { name: "Kết nối" }));

    expect(await screen.findByText(/khoá mã hoá chưa cấu hình/)).toBeVisible();
  });
});
