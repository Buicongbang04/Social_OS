import type { Comments, Inbox } from "@repo/sdk";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InboxPanel } from "./inbox-panel";

const client = { inbox: vi.fn(), comments: vi.fn() };
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

const comment = (overrides: Partial<Comments["comments"][number]> = {}) => ({
  id: "c_1",
  account: "Trang một",
  accountId: "sac_1",
  author: "Bách Ngũ",
  message: "còn hàng không shop",
  createdAt: new Date(Date.now() - 10 * 60_000).toISOString(),
  postId: "page-1_10",
  postExcerpt: "Mua hộ hàng Nhật",
  ...overrides,
});

const show = async (
  inbox: Partial<Inbox> = {},
  comments: Partial<Comments> = {},
) => {
  client.inbox.mockResolvedValue({ threads: [], failed: [], ...inbox });
  client.comments.mockResolvedValue({ comments: [], failed: [], ...comments });
  render(<InboxPanel />);
  await screen.findByRole("button", { name: "Tải lại" });
};

beforeEach(() => {
  client.inbox.mockResolvedValue({ threads: [], failed: [] });
  client.comments.mockResolvedValue({ comments: [], failed: [] });
});

describe("InboxPanel", () => {
  it("counts unread messages and comments together in the title", async () => {
    // Both are somebody waiting for an answer. Counting only messages puts a
    // 0 on the screen while three customers are asking under a post.
    await show(
      { threads: [thread(), thread({ id: "t_2", unread: false })] },
      { comments: [comment(), comment({ id: "c_2" })] },
    );

    expect(screen.getByText("Hộp thư — 3 đang chờ")).toBeVisible();
  });

  it("says just Hộp thư when nothing is waiting", async () => {
    await show({ threads: [thread({ unread: false })] });

    expect(screen.getByText("Hộp thư")).toBeVisible();
  });

  it("shows a comment, who wrote it and what it sits under", async () => {
    // Without the post, "còn hàng không" is a question nobody can answer.
    await show({}, { comments: [comment()] });

    expect(screen.getByText("Bách Ngũ")).toBeVisible();
    expect(screen.getByText("còn hàng không shop")).toBeVisible();
    expect(screen.getByText(/dưới bài: Mua hộ hàng Nhật/)).toBeVisible();
  });

  it("links a comment to the post it is under", async () => {
    await show({}, { comments: [comment()] });

    expect(screen.getByRole("link", { name: /Trang một/ })).toHaveAttribute(
      "href",
      "https://www.facebook.com/page-1_10",
    );
  });

  it("says nothing about comments when there are none", async () => {
    await show({ threads: [thread()] }, { comments: [] });

    expect(screen.queryByText("Bình luận dưới bài đăng")).toBeNull();
  });

  it("names a channel whose comments could not be read", async () => {
    await show({}, { failed: [{ account: "Trang hai", reason: "hết quyền" }] });

    expect(
      screen.getByText(/Không đọc được Trang hai: hết quyền/),
    ).toBeVisible();
  });

  it("reads messages and comments in one go, not one after the other", async () => {
    // Sequentially the comments arrive after a round trip somebody is already
    // waiting through.
    await show();

    expect(client.inbox).toHaveBeenCalled();
    expect(client.comments).toHaveBeenCalled();
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
