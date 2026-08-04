import type { PublicUser, Workspace } from "@repo/sdk";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell, SECTIONS } from "./app-shell";

const client = {
  isAuthenticated: vi.fn(),
  me: vi.fn(),
  listOrganizations: vi.fn(),
  listWorkspaces: vi.fn(),
  logout: vi.fn(),
  listConnections: vi.fn(),
  listContentPieces: vi.fn(),
};

const readWorkspace = vi.fn();
const writeWorkspace = vi.fn();

vi.mock("../lib/api", () => ({
  API_BASE_URL: "http://localhost:3100/api/v1",
  getClient: () => client,
  readWorkspace: () => readWorkspace(),
  writeWorkspace: (id: string | null) => writeWorkspace(id),
}));

let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const user = { id: "usr_1", email: "chu@tiximax.vn" } as PublicUser;
const workspace = { id: "wsp_1", name: "Tiximax" } as Workspace;

const signedIn = () => {
  client.isAuthenticated.mockReturnValue(true);
  client.me.mockResolvedValue(user);
  readWorkspace.mockReturnValue("wsp_1");
  client.listOrganizations.mockResolvedValue([{ id: "org_1" }]);
  client.listWorkspaces.mockResolvedValue([workspace]);
};

const show = async () => {
  render(<AppShell>{(ws) => <p>trang của {ws.name}</p>}</AppShell>);
  await screen.findByText("trang của Tiximax");
};

beforeEach(() => {
  pathname = "/";
  client.logout.mockResolvedValue(undefined);
  client.listConnections.mockResolvedValue([]);
  client.listContentPieces.mockResolvedValue([]);
  signedIn();
});

describe("AppShell", () => {
  it("shows every section, once, in the sidebar", async () => {
    await show();

    const sidebar = screen.getAllByRole("navigation", { name: "Khu vực" })[0]!;
    for (const section of SECTIONS) {
      expect(
        within(sidebar).getByRole("link", { name: section.label }),
      ).toBeVisible();
    }
  });

  it("keeps the parent lit while inside one of its sub-sections", async () => {
    // Matching "Viết bài" on its default child would make it go dark the
    // moment somebody opens the other one.
    pathname = "/viet/doi-thu";
    await show();

    const sidebar = screen.getAllByRole("navigation", { name: "Khu vực" })[0]!;
    expect(within(sidebar).getByRole("link", { name: "Viết bài" })).toHaveClass(
      "bg-neutral-900",
    );
    expect(
      within(sidebar).getByRole("link", { name: "Phân tích đối thủ" }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("hides sub-sections until somebody is inside that branch", async () => {
    // Showing every child of every section turns a list of eight into a list
    // of twelve — the wall this redesign took down.
    pathname = "/lich";
    await show();

    const sidebar = screen.getAllByRole("navigation", { name: "Khu vực" })[0]!;
    expect(
      within(sidebar).queryByRole("link", { name: "Phân tích đối thủ" }),
    ).toBeNull();
  });

  it("marks the section being looked at, and only that one", async () => {
    pathname = "/lich";
    await show();

    const sidebar = screen.getAllByRole("navigation", { name: "Khu vực" })[0]!;
    const current = within(sidebar)
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page");

    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent("Lịch đăng");
  });

  it("does not mark the overview as current on every other page", async () => {
    // "/" is a prefix of everything. Matching it by prefix would light up the
    // overview on all eight screens, which tells the reader nothing.
    pathname = "/so-lieu";
    await show();

    const sidebar = screen.getAllByRole("navigation", { name: "Khu vực" })[0]!;
    expect(
      within(sidebar).getByRole("link", { name: "Tổng quan" }),
    ).not.toHaveAttribute("aria-current");
  });

  it("marks a section from a page beneath it", async () => {
    pathname = "/lich/chi-tiet";
    await show();

    const sidebar = screen.getAllByRole("navigation", { name: "Khu vực" })[0]!;
    expect(
      within(sidebar).getByRole("link", { name: "Lịch đăng" }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("hands the workspace to the page", async () => {
    // Otherwise each page resolves the session again, and eight copies of a
    // guard is a guard that will be missing from one of them.
    await show();

    expect(screen.getByText("trang của Tiximax")).toBeVisible();
  });

  it("shows the alert banner on every page, not only the overview", async () => {
    // A dead channel makes whatever is below it misleading, whichever section
    // somebody happens to be on.
    pathname = "/tro-chuyen";
    client.listConnections.mockResolvedValue([
      {
        id: "sac_1",
        connectorId: "facebook",
        externalId: "p",
        displayName: "Trang một",
        avatarUrl: null,
        scopes: [],
        status: "EXPIRED",
        expiresAt: null,
        connectedAt: "2026-08-01T00:00:00.000Z",
      },
    ]);
    await show();

    expect(
      await screen.findByText(/Kênh "Trang một" đã hết hạn/),
    ).toBeVisible();
  });

  it("asks for a sign-in instead of rendering a page nothing can load", async () => {
    client.isAuthenticated.mockReturnValue(false);
    render(<AppShell>{() => <p>trang</p>}</AppShell>);

    await waitFor(() => expect(screen.queryByText("trang")).toBeNull());
  });

  it("treats a broken session as signed out rather than showing a dead console", async () => {
    client.me.mockRejectedValue(new Error("401"));
    render(<AppShell>{() => <p>trang</p>}</AppShell>);

    await waitFor(() => expect(screen.queryByText("trang")).toBeNull());
  });

  it("does not trust a stored workspace the account no longer has", async () => {
    // The id may belong to a session that is gone, or a workspace somebody was
    // removed from.
    client.listWorkspaces.mockResolvedValue([]);
    render(<AppShell>{(ws) => <p>trang của {ws.name}</p>}</AppShell>);

    await waitFor(() => expect(writeWorkspace).toHaveBeenCalledWith(null));
    expect(screen.queryByText(/trang của/)).toBeNull();
  });

  it("forgets the workspace on sign-out", async () => {
    await show();

    await userEvent.click(screen.getByRole("button", { name: "Đăng xuất" }));

    await waitFor(() => expect(client.logout).toHaveBeenCalled());
    expect(writeWorkspace).toHaveBeenCalledWith(null);
  });

  it("says which workspace is on screen", async () => {
    // With more than one, a page that does not name the workspace is a page
    // where somebody schedules a post to the wrong company.
    await show();

    expect(screen.getByText("Tiximax")).toBeVisible();
    expect(screen.getByText("chu@tiximax.vn")).toBeVisible();
  });
});
