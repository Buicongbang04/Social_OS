import type { ContentPiece, SocialConnection } from "@repo/sdk";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CalendarPanel } from "./calendar-panel";

/**
 * The calendar, as somebody sees it.
 *
 * These cover the decisions the screen makes on its own and nowhere else: which
 * button appears for which status, whether a Page picker is offered at all, and
 * what an approval sends. Getting those wrong shows up as a post that cannot be
 * approved or one sent to the wrong audience, and until now nothing caught it.
 */
const client = {
  listContentPieces: vi.fn(),
  listCampaigns: vi.fn(),
  listConnections: vi.fn(),
  createCampaign: vi.fn(),
  updateContentPiece: vi.fn(),
  archiveContentPiece: vi.fn(),
  contentImageUrl: vi.fn(),
  generateImages: vi.fn(),
};

vi.mock("../lib/api", () => ({ getClient: () => client }));

const piece = (overrides: Partial<ContentPiece> = {}): ContentPiece => ({
  id: "cnt_1",
  campaignId: null,
  socialAccountId: null,
  imageKey: null,
  title: "Bài viết",
  body: "Nội dung",
  hashtags: [],
  channel: "facebook",
  scheduledAt: "2026-08-15T02:00:00.000Z",
  status: "DRAFT",
  review: "DRAFT",
  publishedPostId: null,
  publishedAt: null,
  lastError: null,
  ...overrides,
});

const connection = (
  id: string,
  displayName: string,
  connectorId = "facebook",
): SocialConnection => ({
  id,
  connectorId,
  externalId: id,
  displayName,
  avatarUrl: null,
  scopes: [],
  status: "ACTIVE",
  expiresAt: null,
  connectedAt: "2026-08-01T00:00:00.000Z",
});

const show = async (
  pieces: ContentPiece[],
  connections: SocialConnection[] = [],
) => {
  client.listContentPieces.mockResolvedValue(pieces);
  client.listCampaigns.mockResolvedValue([]);
  client.listConnections.mockResolvedValue(connections);
  render(<CalendarPanel />);
  await screen.findByText("Bài viết");
};

beforeEach(() => {
  client.contentImageUrl.mockResolvedValue({ url: "http://x/anh.png" });
  client.generateImages.mockResolvedValue({
    images: [{ key: "moi.png", url: "http://x/moi.png" }],
    costUsd: "0.0390",
  });
  client.updateContentPiece.mockResolvedValue(piece());
  client.archiveContentPiece.mockResolvedValue(undefined);
});

describe("CalendarPanel", () => {
  it("offers all four verdicts, and sends the one that was picked", async () => {
    await show([piece({ review: "DRAFT" })]);

    const picker = screen.getByRole("combobox", {
      name: 'Trạng thái duyệt cho "Bài viết"',
    });
    expect(
      [...picker.querySelectorAll("option")].map((option) => option.value),
    ).toEqual(["DRAFT", "REVIEW", "APPROVED", "REJECTED"]);

    await userEvent.selectOptions(picker, "APPROVED");

    expect(client.updateContentPiece).toHaveBeenCalledWith("cnt_1", {
      review: "APPROVED",
    });
  });

  it("shows the verdict and the publish state as two separate things", async () => {
    // A rejected piece still has to be able to say the last attempt to send it
    // failed. Folded into one field, approving something erased what had
    // happened to it.
    await show([
      piece({ review: "REJECTED", status: "FAILED", lastError: "token hỏng" }),
    ]);

    expect(
      screen.getByRole("combobox", { name: /Trạng thái duyệt/ }),
    ).toHaveValue("REJECTED");
    expect(screen.getByText("Đăng thất bại")).toBeVisible();
    expect(screen.getByText("token hỏng")).toBeVisible();
  });

  it("says a piece has not gone out yet, whatever its verdict", async () => {
    await show([piece({ review: "APPROVED", status: "APPROVED" })]);

    expect(screen.getByText("Chưa đăng")).toBeVisible();
  });

  it("closes the verdict once the post is out", async () => {
    // Changing it then changes nothing except what the screen claims.
    await show([piece({ status: "PUBLISHED", publishedPostId: "p_1" })]);

    expect(
      screen.getByRole("combobox", { name: /Trạng thái duyệt/ }),
    ).toBeDisabled();
    expect(screen.getByText("Đăng thành công")).toBeVisible();
  });

  it("links to the post once there is one", async () => {
    // A calendar that says "đã đăng" with no way to go and look is asking to
    // be taken on trust.
    await show([piece({ status: "PUBLISHED", publishedPostId: "page_1_99" })]);

    expect(screen.getByRole("link", { name: "Xem bài" })).toHaveAttribute(
      "href",
      "https://www.facebook.com/page_1_99",
    );
  });

  it("offers no Page picker when there is nothing to choose", async () => {
    // A select with one option is a decision the screen is pretending to
    // offer.
    await show([piece()], [connection("sac_1", "Trang một")]);

    expect(screen.queryByRole("combobox", { name: /Trang đăng/ })).toBeNull();
  });

  it("offers a Page picker once a second Page is connected", async () => {
    await show(
      [piece()],
      [connection("sac_1", "Trang một"), connection("sac_2", "Trang hai")],
    );

    const picker = screen.getByRole("combobox", {
      name: 'Trang đăng cho "Bài viết"',
    });
    await userEvent.selectOptions(picker, "sac_2");

    expect(client.updateContentPiece).toHaveBeenCalledWith("cnt_1", {
      socialAccountId: "sac_2",
    });
  });

  it("sends null, not an empty string, when the Page is cleared", async () => {
    // "" is an account id that matches nothing. null is what the server reads
    // as "the only account on this channel".
    await show(
      [piece({ socialAccountId: "sac_2" })],
      [connection("sac_1", "Trang một"), connection("sac_2", "Trang hai")],
    );

    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: /Trang đăng/ }),
      "",
    );

    expect(client.updateContentPiece).toHaveBeenCalledWith("cnt_1", {
      socialAccountId: null,
    });
  });

  it("shows the Page as text once the post is out, not as a picker", async () => {
    // Which Page a published post went to is a fact. A dropdown over a fact
    // invites somebody to think they can move it.
    await show(
      [
        piece({
          status: "PUBLISHED",
          publishedPostId: "p_1",
          socialAccountId: "sac_2",
        }),
      ],
      [connection("sac_1", "Trang một"), connection("sac_2", "Trang hai")],
    );

    expect(screen.queryByRole("combobox", { name: /Trang đăng/ })).toBeNull();
    expect(screen.getByText("Trang hai")).toBeVisible();
  });

  it("ignores Pages on other channels when deciding to offer a picker", async () => {
    // Two connections, one Facebook and one TikTok, is not a choice for a
    // Facebook post.
    await show(
      [piece({ channel: "facebook" })],
      [
        connection("sac_1", "Trang một"),
        connection("sac_9", "Kênh TikTok", "tiktok"),
      ],
    );

    expect(screen.queryByRole("combobox", { name: /Trang đăng/ })).toBeNull();
  });

  it("keeps undated pieces out of the days, at the end", async () => {
    // A draft with no date shown on some arbitrary day would be lying about
    // when it goes out.
    await show([
      piece({ id: "cnt_1", title: "Bài viết", scheduledAt: null }),
      piece({
        id: "cnt_2",
        title: "Đã hẹn",
        scheduledAt: "2026-08-15T02:00:00.000Z",
      }),
    ]);

    const undated = screen.getByText("Chưa hẹn ngày").closest("div")!;
    expect(within(undated).getByText("Bài viết")).toBeVisible();
    expect(within(undated).queryByText("Đã hẹn")).toBeNull();
  });

  it("reloads after a change, so the row shows what the server stored", async () => {
    await show([piece({ review: "DRAFT" })]);
    client.listContentPieces.mockClear();

    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: /Trạng thái duyệt/ }),
      "APPROVED",
    );

    await waitFor(() => expect(client.listContentPieces).toHaveBeenCalled());
  });

  it("shows the post as it will look, text and picture together", async () => {
    // The only place the two can be seen together before somebody approves
    // them. Reading the body in a table cell is not looking at the post.
    await show([
      piece({
        body: "MỞ ĐẦU\n\nDòng hai",
        hashtags: ["Tiximax"],
        imageKey: "cnt_1.png",
      }),
    ]);

    await userEvent.click(
      screen.getByRole("button", { name: 'Xem trước "Bài viết"' }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/MỞ ĐẦU/)).toBeVisible();
    expect(within(dialog).getByText("#Tiximax")).toBeVisible();
    expect(await within(dialog).findByRole("img")).toHaveAttribute(
      "src",
      "http://x/anh.png",
    );
  });

  it("keeps the line breaks in the preview", async () => {
    // They are the format. A preview that collapses them shows a post nobody
    // is sending.
    await show([piece({ body: "MỞ ĐẦU\n\nDòng hai" })]);

    await userEvent.click(
      screen.getByRole("button", { name: 'Xem trước "Bài viết"' }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/MỞ ĐẦU/)).toHaveClass(
      "whitespace-pre-wrap",
    );
  });

  it("asks for no picture when the piece has none", async () => {
    // A presigned link costs a round trip, and there is nothing to sign.
    await show([piece({ imageKey: null })]);

    await userEvent.click(
      screen.getByRole("button", { name: 'Xem trước "Bài viết"' }),
    );

    await screen.findByRole("dialog");
    expect(client.contentImageUrl).not.toHaveBeenCalled();
  });

  it("offers a preview even for a post already out", async () => {
    // Reading what went out is the commonest reason to open it.
    await show([piece({ status: "PUBLISHED", publishedPostId: "p_1" })]);

    expect(
      screen.getByRole("button", { name: 'Xem trước "Bài viết"' }),
    ).toBeVisible();
  });

  it("edits the text of a piece already on the calendar", async () => {
    // The composer starts from a brief, not from a draft that exists, so
    // without this the only way to fix a paragraph is to write the post again.
    await show([piece({ body: "Nội dung cũ" })]);

    await userEvent.click(
      screen.getByRole("button", { name: 'Sửa "Bài viết"' }),
    );
    const dialog = await screen.findByRole("dialog");
    const body = within(dialog).getByLabelText("Nội dung");
    await userEvent.clear(body);
    await userEvent.type(body, "Nội dung mới");
    await userEvent.click(within(dialog).getByRole("button", { name: "Lưu" }));

    await waitFor(() =>
      expect(client.updateContentPiece).toHaveBeenCalledWith("cnt_1", {
        body: "Nội dung mới",
      }),
    );
  });

  it("sends only what actually changed", async () => {
    // A save that writes every field bumps the row and its audit columns for a
    // dialog somebody opened and closed.
    await show([piece()]);

    await userEvent.click(
      screen.getByRole("button", { name: 'Sửa "Bài viết"' }),
    );
    const dialog = await screen.findByRole("dialog");
    const title = within(dialog).getByLabelText("Tiêu đề");
    await userEvent.clear(title);
    await userEvent.type(title, "Tên mới");
    await userEvent.click(within(dialog).getByRole("button", { name: "Lưu" }));

    await waitFor(() =>
      expect(client.updateContentPiece).toHaveBeenCalledWith("cnt_1", {
        title: "Tên mới",
      }),
    );
  });

  it("says so instead of pretending to save nothing", async () => {
    // A dialog that closes having written nothing is indistinguishable from a
    // button that does not work.
    await show([piece()]);

    await userEvent.click(
      screen.getByRole("button", { name: 'Sửa "Bài viết"' }),
    );
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Lưu" }));

    expect(
      await within(dialog).findByText(/Chưa có gì thay đổi/),
    ).toBeVisible();
    expect(client.updateContentPiece).not.toHaveBeenCalled();
  });

  it("reports a failed save inside the dialog, not behind it", async () => {
    // The panel draws its errors under the list, which this overlay covers, so
    // a refused save looked exactly like a button that does nothing.
    client.updateContentPiece.mockRejectedValue(new Error("mạng hỏng"));
    await show([piece()]);

    await userEvent.click(
      screen.getByRole("button", { name: 'Sửa "Bài viết"' }),
    );
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Tiêu đề"), " thêm");
    await userEvent.click(within(dialog).getByRole("button", { name: "Lưu" }));

    expect(await within(dialog).findByText(/mạng hỏng/)).toBeVisible();
  });

  it("draws a picture for a piece that never got one", async () => {
    // The reason this button exists: a post saved before anybody thought
    // about the picture.
    await show([piece({ imageKey: null, body: "Thân bài" })]);

    await userEvent.click(
      screen.getByRole("button", { name: 'Sửa "Bài viết"' }),
    );
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Sinh ảnh" }),
    );

    await waitFor(() =>
      expect(client.generateImages).toHaveBeenCalledWith("Thân bài", 1),
    );

    // One candidate, and choosing it is explicit.
    await userEvent.click(
      await within(dialog).findByRole("button", { name: "Dùng ảnh này" }),
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Lưu" }));

    await waitFor(() =>
      expect(client.updateContentPiece).toHaveBeenCalledWith("cnt_1", {
        imageKey: "moi.png",
      }),
    );
  });

  it("draws from the text on screen, not from what was saved", async () => {
    // The usual reason for being in this dialog is that the saved text was
    // wrong, and a picture drawn from it would be wrong the same way.
    await show([piece({ body: "Cũ" })]);

    await userEvent.click(
      screen.getByRole("button", { name: 'Sửa "Bài viết"' }),
    );
    const dialog = await screen.findByRole("dialog");
    const body = within(dialog).getByLabelText("Nội dung");
    await userEvent.clear(body);
    await userEvent.type(body, "Mới");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Sinh ảnh" }),
    );

    await waitFor(() =>
      expect(client.generateImages).toHaveBeenCalledWith("Mới", 1),
    );
  });

  it("shows the picture a piece already has, so a replacement can be compared", async () => {
    await show([piece({ imageKey: "cu.png" })]);

    await userEvent.click(
      screen.getByRole("button", { name: 'Sửa "Bài viết"' }),
    );
    const dialog = await screen.findByRole("dialog");

    expect(await within(dialog).findByRole("img")).toHaveAttribute(
      "src",
      "http://x/anh.png",
    );
  });

  it("shows the schedule on the reader's own clock, not in UTC", async () => {
    // Handed back as UTC, a Vietnamese 09:00 post reads as 02:00 in the box
    // somebody is about to edit.
    await show([piece({ scheduledAt: "2026-08-15T02:00:00.000Z" })]);

    await userEvent.click(
      screen.getByRole("button", { name: 'Sửa "Bài viết"' }),
    );
    const dialog = await screen.findByRole("dialog");

    const expected = new Date("2026-08-15T02:00:00.000Z");
    const pad = (value: number) => String(value).padStart(2, "0");
    expect(within(dialog).getByLabelText("Hẹn đăng")).toHaveValue(
      `${expected.getFullYear()}-${pad(expected.getMonth() + 1)}-${pad(expected.getDate())}T${pad(expected.getHours())}:${pad(expected.getMinutes())}`,
    );
  });

  it("does not offer to edit a post that has already gone out", async () => {
    // Editing the row then changes nothing on Facebook. It only makes this
    // screen disagree with what was actually sent.
    await show([piece({ status: "PUBLISHED", publishedPostId: "p_1" })]);

    expect(
      screen.getByRole("button", { name: 'Sửa "Bài viết"' }),
    ).toBeDisabled();
  });

  it("has no way to throw a piece away from this screen", async () => {
    // Archiving sat one click from the verdict dropdown, on a row where the
    // usual action is a status change.
    await show([piece()]);

    expect(screen.queryByRole("button", { name: "Bỏ" })).toBeNull();
  });

  it("says what went wrong instead of failing silently", async () => {
    await show([piece({ review: "DRAFT" })]);
    client.updateContentPiece.mockRejectedValue(new Error("mạng hỏng"));

    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: /Trạng thái duyệt/ }),
      "APPROVED",
    );

    expect(await screen.findByText(/mạng hỏng/)).toBeVisible();
  });
});
