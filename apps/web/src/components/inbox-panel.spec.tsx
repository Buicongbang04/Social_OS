import type { Inbox } from "@repo/sdk";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InboxPanel } from "./inbox-panel";

const client = { inbox: vi.fn() };
vi.mock("../lib/api", () => ({ getClient: () => client }));

const thread = (
  overrides: Partial<Inbox["threads"][number]> = {},
): Inbox["threads"][number] => ({
  id: "t_1",
  account: "Trang một",
  accountId: "sac_1",
  participant: "Nguyễn Văn A",
  lastMessage: "Cho hỏi phí ship về Hà Nội?",
  updatedAt: new Date(Date.now() - 30 * 60_000).toISOString(),
  unread: true,
  ...overrides,
});

const show = async (inbox: Partial<Inbox> = {}) => {
  client.inbox.mockResolvedValue({ threads: [], failed: [], ...inbox });
  render(<InboxPanel />);
  await screen.findByRole("button", { name: "Tải lại" });
};

beforeEach(() => {
  client.inbox.mockResolvedValue({ threads: [], failed: [] });
});

describe("InboxPanel", () => {
  it("puts the number waiting in the title, where it is read first", async () => {
    await show({ threads: [thread(), thread({ id: "t_2", unread: false })] });

    expect(screen.getByText("Hộp thư — 1 chưa đọc")).toBeVisible();
  });

  it("says just Hộp thư when nothing is waiting", async () => {
    await show({ threads: [thread({ unread: false })] });

    expect(screen.getByText("Hộp thư")).toBeVisible();
  });

  it("marks the unread ones apart from the rest", async () => {
    await show({ threads: [thread(), thread({ id: "t_2", unread: false })] });

    expect(screen.getAllByText("chưa đọc")).toHaveLength(1);
  });

  it("names a channel it could not read", async () => {
    // An empty inbox and an inbox nobody could open look the same on screen,
    // and only one of them means there is nothing waiting.
    await show({
      failed: [{ account: "Trang hai", reason: "token hết hạn" }],
    });

    expect(
      screen.getByText(/Không đọc được Trang hai: token hết hạn/),
    ).toBeVisible();
  });

  it("still shows the messages it could read when another channel failed", async () => {
    await show({
      threads: [thread()],
      failed: [{ account: "Trang hai", reason: "token hết hạn" }],
    });

    expect(screen.getByText("Nguyễn Văn A")).toBeVisible();
    expect(screen.getByText(/Không đọc được Trang hai/)).toBeVisible();
  });

  it("says how long somebody has been waiting, not when they wrote", async () => {
    // "3 ngày trước" answers the question people actually have about a waiting
    // customer; an ISO timestamp makes them do the arithmetic.
    await show({
      threads: [
        thread({
          id: "t_1",
          updatedAt: new Date(Date.now() - 3 * 24 * 60 * 60_000).toISOString(),
        }),
      ],
    });

    const row = screen.getByRole("listitem");
    expect(within(row).getByText(/3 ngày trước/)).toBeVisible();
  });

  it("says vừa xong for something that just arrived", async () => {
    await show({ threads: [thread({ updatedAt: new Date().toISOString() })] });

    expect(screen.getByText(/vừa xong/)).toBeVisible();
  });

  it("leaves an unreadable timestamp alone rather than showing NaN", async () => {
    await show({ threads: [thread({ updatedAt: "không phải ngày" })] });

    expect(screen.getByText(/không phải ngày/)).toBeVisible();
  });

  it("reads the inbox again when asked, rather than showing a cached copy", async () => {
    // A copy is wrong the moment somebody replies from the Facebook app.
    await show({ threads: [thread()] });
    client.inbox.mockClear();

    await userEvent.click(screen.getByRole("button", { name: "Tải lại" }));

    await waitFor(() => expect(client.inbox).toHaveBeenCalled());
  });

  it("says the inbox is empty rather than looking like it is still loading", async () => {
    await show({ threads: [] });

    expect(screen.getByText(/Không có tin nhắn nào/)).toBeVisible();
  });

  it("offers no way to reply, because nothing here can", async () => {
    // Deliberate rather than unfinished: answering somebody's customers on
    // their behalf is a far larger decision than showing who is waiting, and a
    // box that looked like a reply would promise one.
    await show({ threads: [thread()] });

    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("says what went wrong instead of an empty inbox", async () => {
    client.inbox.mockRejectedValue(new Error("chưa kết nối kênh nào"));
    render(<InboxPanel />);

    expect(await screen.findByText(/chưa kết nối kênh nào/)).toBeVisible();
  });
});
