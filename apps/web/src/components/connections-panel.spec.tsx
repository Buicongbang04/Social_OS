import type {
  ConnectorSummary,
  ManageablePage,
  SocialConnection,
} from "@repo/sdk";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionsPanel } from "./connections-panel";

const client = {
  listConnections: vi.fn(),
  connectorCatalog: vi.fn(),
  startConnection: vi.fn(),
  attachConnection: vi.fn(),
  listManageablePages: vi.fn(),
  attachPages: vi.fn(),
  disconnect: vi.fn(),
};

vi.mock("../lib/api", () => ({ getClient: () => client }));

const connection = (
  overrides: Partial<SocialConnection> = {},
): SocialConnection => ({
  id: "sac_1",
  connectorId: "facebook",
  externalId: "page-1",
  displayName: "Trang một",
  avatarUrl: null,
  scopes: ["pages_manage_posts"],
  status: "ACTIVE",
  expiresAt: null,
  connectedAt: "2026-08-01T00:00:00.000Z",
  ...overrides,
});

const catalog: ConnectorSummary[] = [
  { id: "facebook", name: "Facebook", configured: true } as ConnectorSummary,
  { id: "tiktok", name: "TikTok", configured: false } as ConnectorSummary,
];

const page = (
  externalId: string,
  displayName: string,
  alreadyConnected = false,
): ManageablePage => ({ externalId, displayName, alreadyConnected });

const show = async (connections: SocialConnection[] = []) => {
  client.listConnections.mockResolvedValue(connections);
  client.connectorCatalog.mockResolvedValue(catalog);
  render(<ConnectionsPanel />);
  await screen.findByRole("button", { name: "Kết nối Facebook" });
};

/** Open the bulk panel and list the Pages a user token manages. */
const discover = async (pages: ManageablePage[]) => {
  client.listManageablePages.mockResolvedValue(pages);
  await userEvent.click(
    screen.getByRole("button", { name: /Quản nhiều Page/ }),
  );
  await userEvent.type(
    screen.getByPlaceholderText("User access token"),
    "user-token-abcdefghijklmnop",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Xem danh sách Page" }),
  );
  await screen.findByText(pages[0]!.displayName);
};

beforeEach(() => {
  client.attachPages.mockResolvedValue({
    connected: [connection()],
    failed: [],
  });
  client.disconnect.mockResolvedValue(undefined);
});

describe("ConnectionsPanel", () => {
  it("shows a platform that has no app configured, but will not start it", async () => {
    // Hiding it would read as "not supported" and never tell the operator they
    // forgot to register an app.
    await show();

    expect(
      screen.getByRole("button", { name: "TikTok (chưa cấu hình)" }),
    ).toBeDisabled();
  });

  it("tells apart a token that expired from one that was revoked", async () => {
    // The remedy differs: an expired token is fixed by reconnecting here,
    // while a revoked one refuses the reconnection too until the permission is
    // restored on the platform. Telling somebody to press a button that cannot
    // work is worse than telling them nothing.
    await show([
      connection({ id: "sac_1", displayName: "Hết hạn", status: "EXPIRED" }),
      connection({ id: "sac_2", displayName: "Bị thu hồi", status: "REVOKED" }),
    ]);

    expect(screen.getByText(/nối lại là được/)).toBeVisible();
    expect(screen.getByText(/cấp lại quyền bên nền tảng trước/)).toBeVisible();
  });

  it("says nothing about status for a healthy connection", async () => {
    await show([connection()]);

    expect(screen.queryByText(/nối lại là được/)).toBeNull();
    expect(screen.queryByText(/thu hồi/)).toBeNull();
  });

  it("lists the Pages a user token manages", async () => {
    await show();

    await discover([page("page-1", "Trang một"), page("page-2", "Trang hai")]);

    expect(screen.getByText("Trang hai")).toBeVisible();
    expect(client.listManageablePages).toHaveBeenCalledWith(
      "facebook",
      "user-token-abcdefghijklmnop",
    );
  });

  it("ticks the Pages that can be connected, and only those", async () => {
    // An already-connected Page is shown rather than hidden — somebody looking
    // for one they connected last week should find it with a reason — but
    // connecting it again is not on offer.
    await show();

    await discover([
      page("page-1", "Trang một"),
      page("page-2", "Đã nối", true),
    ]);

    const boxes = screen.getAllByRole("checkbox");
    expect(boxes[0]).toBeChecked();
    expect(boxes[1]).toBeDisabled();
    expect(screen.getByText("đã nối rồi")).toBeVisible();
  });

  it("connects only the Pages that are ticked", async () => {
    await show();
    await discover([page("page-1", "Trang một"), page("page-2", "Trang hai")]);

    await userEvent.click(screen.getAllByRole("checkbox")[0]!);
    await userEvent.click(
      screen.getByRole("button", { name: /Nối 1 trang đã chọn/ }),
    );

    await waitFor(() =>
      expect(client.attachPages).toHaveBeenCalledWith("facebook", {
        userAccessToken: "user-token-abcdefghijklmnop",
        externalIds: ["page-2"],
      }),
    );
  });

  it("says how many failed as well as how many worked", async () => {
    // "Connected 8" while two failed silently is how somebody finds out weeks
    // later, from a post that never went out.
    await show();
    client.attachPages.mockResolvedValue({
      connected: [connection()],
      failed: [
        { externalId: "page-9", reason: "Token này không quản lý Page đó." },
      ],
    });

    await discover([page("page-1", "Trang một"), page("page-9", "Không quản")]);
    await userEvent.click(
      screen.getByRole("button", { name: /Nối 2 trang đã chọn/ }),
    );

    expect(await screen.findByText(/Không nối được 1/)).toBeVisible();
    expect(screen.getByText(/page-9/)).toBeVisible();
  });

  it("clears the user token once the Pages are connected", async () => {
    // A live credential in an input is one shared screen away from being
    // somebody else's.
    //
    // Checked by reopening the panel, not by the input disappearing: it
    // disappears anyway because the panel closes, so the first version of this
    // test passed whether or not the token was ever cleared.
    await show();
    await discover([page("page-1", "Trang một")]);

    await userEvent.click(
      screen.getByRole("button", { name: /Nối 1 trang đã chọn/ }),
    );
    await waitFor(() => expect(client.attachPages).toHaveBeenCalled());

    await userEvent.click(
      screen.getByRole("button", { name: /Quản nhiều Page/ }),
    );
    expect(screen.getByPlaceholderText("User access token")).toHaveValue("");
  });

  it("says plainly when a Page token was pasted into the user token box", async () => {
    // The likeliest mistake, and Facebook's own answer for it is useless.
    await show();
    client.listManageablePages.mockRejectedValue(
      new Error("Đây là Page access token, không phải user access token."),
    );

    await userEvent.click(
      screen.getByRole("button", { name: /Quản nhiều Page/ }),
    );
    await userEvent.type(
      screen.getByPlaceholderText("User access token"),
      "page-token-abcdefghijklmnop",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Xem danh sách Page" }),
    );

    expect(
      await screen.findByText(/Page access token, không phải user/),
    ).toBeVisible();
  });

  it("attaches one Page from an id and a token", async () => {
    await show();
    client.attachConnection.mockResolvedValue(connection());

    await userEvent.click(
      screen.getByRole("button", { name: /Đã có Page ID và access token/ }),
    );
    await userEvent.type(
      screen.getByPlaceholderText("Page ID"),
      "589788187548879",
    );
    await userEvent.type(
      screen.getByPlaceholderText("Page access token"),
      "EAAtoken-abcdefghijklmnop",
    );
    await userEvent.click(screen.getByRole("button", { name: "Nối Page" }));

    await waitFor(() =>
      expect(client.attachConnection).toHaveBeenCalledWith("facebook", {
        externalId: "589788187548879",
        accessToken: "EAAtoken-abcdefghijklmnop",
      }),
    );
  });

  it("hides both pasted credentials while they are typed", async () => {
    await show();

    await userEvent.click(
      screen.getByRole("button", { name: /Đã có Page ID và access token/ }),
    );
    expect(screen.getByPlaceholderText("Page access token")).toHaveAttribute(
      "type",
      "password",
    );

    await userEvent.click(
      screen.getByRole("button", { name: /Quản nhiều Page/ }),
    );
    expect(screen.getByPlaceholderText("User access token")).toHaveAttribute(
      "type",
      "password",
    );
  });

  it("removes a connection and reads the list back", async () => {
    await show([connection()]);
    client.listConnections.mockClear();

    await userEvent.click(screen.getByRole("button", { name: "Gỡ" }));

    await waitFor(() =>
      expect(client.disconnect).toHaveBeenCalledWith("sac_1"),
    );
    await waitFor(() => expect(client.listConnections).toHaveBeenCalled());
  });

  it("says how many permissions a connection actually got", async () => {
    // What was granted can be less than what was asked for.
    await show([connection({ scopes: ["a", "b", "c"] })]);

    const row = screen.getByRole("listitem");
    expect(within(row).getByText("3 quyền")).toBeVisible();
  });
});
