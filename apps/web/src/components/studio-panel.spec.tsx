import type { SocialConnection } from "@repo/sdk";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StudioPanel } from "./studio-panel";

const client = {
  writeContent: vi.fn(),
  rewriteContent: vi.fn(),
  translateContent: vi.fn(),
  suggestSeo: vi.fn(),
  createContentPiece: vi.fn(),
  listConnections: vi.fn(),
  generateImages: vi.fn(),
};

vi.mock("../lib/api", () => ({ getClient: () => client }));

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

/** Write a draft, so the save controls exist to act on. */
const withDraft = async (connections: SocialConnection[] = []) => {
  client.listConnections.mockResolvedValue(connections);
  client.writeContent.mockResolvedValue({
    object: { title: "Tiêu đề", body: "Thân bài", hashtags: ["muahang"] },
    costUsd: "0.00012",
    model: "qwen2.5:7b",
  });

  render(<StudioPanel />);
  await userEvent.type(
    screen.getByPlaceholderText(/Viết gì\?/),
    "giới thiệu dịch vụ",
  );
  await userEvent.click(screen.getByRole("button", { name: "Viết" }));
  await screen.findByText("Tiêu đề");
};

beforeEach(() => {
  client.listConnections.mockResolvedValue([]);
  client.createContentPiece.mockResolvedValue({ id: "cnt_1" });
  client.generateImages.mockResolvedValue({
    images: [
      { key: "a.png", url: "http://x/a.png" },
      { key: "b.png", url: "http://x/b.png" },
    ],
    costUsd: "0.0780",
  });
});

/** Draw the pictures, so there is a grid to pick from. */
const withImages = async (count?: string) => {
  await withDraft();
  if (count) {
    const input = screen.getByRole("spinbutton", { name: "Số ảnh" });
    await userEvent.clear(input);
    await userEvent.type(input, count);
  }
  await userEvent.click(screen.getByRole("button", { name: "Sinh ảnh" }));
  await screen.findAllByRole("img");
};

describe("StudioPanel — sinh ảnh", () => {
  it("draws from the post itself, not from a description somebody types", async () => {
    // Describing your own post back to a machine produced worse pictures than
    // the post did.
    await withImages();

    expect(client.generateImages).toHaveBeenCalledWith("Thân bài", 1);
  });

  it("draws as many as were asked for", async () => {
    // One at a time meant the only way to see a second option was to lose the
    // first, so nobody ever compared two.
    await withImages("4");

    expect(client.generateImages).toHaveBeenCalledWith("Thân bài", 4);
  });

  it("attaches nothing until somebody picks one", async () => {
    // A picture attached without being looked at is a picture that goes out
    // without being looked at.
    await withImages();

    await userEvent.click(screen.getByRole("button", { name: "Lưu vào lịch" }));

    await waitFor(() => expect(client.createContentPiece).toHaveBeenCalled());
    expect(client.createContentPiece.mock.calls[0]![0]).not.toHaveProperty(
      "imageKey",
    );
  });

  it("saves the picture that was picked", async () => {
    await withImages();

    await userEvent.click(
      screen.getAllByRole("button", { name: "Dùng ảnh này" })[1]!,
    );
    await userEvent.click(screen.getByRole("button", { name: "Lưu vào lịch" }));

    await waitFor(() =>
      expect(client.createContentPiece).toHaveBeenCalledWith(
        expect.objectContaining({ imageKey: "b.png" }),
      ),
    );
  });

  it("says in words which picture will be posted", async () => {
    // A border is a thing somebody has to notice, and a picture posted by
    // accident is not undoable.
    await withImages();

    await userEvent.click(
      screen.getAllByRole("button", { name: "Dùng ảnh này" })[0]!,
    );

    expect(screen.getByText("Sẽ đăng kèm")).toBeVisible();
  });

  it("opens a picture full size, rather than picking it", async () => {
    // Full size is the only way to see whether the model wrote text into it.
    await withImages();

    await userEvent.click(
      screen.getAllByRole("button", { name: "Xem ảnh cỡ lớn" })[0]!,
    );

    expect(
      await screen.findByRole("dialog", { name: "Ảnh cỡ lớn" }),
    ).toBeVisible();
    // Looking is not choosing.
    expect(screen.queryByText("Sẽ đăng kèm")).toBeNull();
  });

  it("takes a discarded picture off the list", async () => {
    await withImages();

    await userEvent.click(
      screen.getAllByRole("button", { name: "Bỏ ảnh này" })[0]!,
    );

    expect(
      screen.getAllByRole("button", { name: "Xem ảnh cỡ lớn" }),
    ).toHaveLength(1);
  });

  it("treats discarding everything else as the choice it is", async () => {
    // Making somebody delete three pictures and then still click "Dùng" on
    // the one they kept is asking twice for one decision.
    await withImages();

    await userEvent.click(
      screen.getAllByRole("button", { name: "Bỏ ảnh này" })[0]!,
    );

    expect(screen.getByText("Sẽ đăng kèm")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Lưu vào lịch" }));

    await waitFor(() =>
      expect(client.createContentPiece).toHaveBeenCalledWith(
        expect.objectContaining({ imageKey: "b.png" }),
      ),
    );
  });

  it("takes the number of pictures as a number somebody types", async () => {
    await withDraft();

    const count = screen.getByRole("spinbutton", { name: "Số ảnh" });
    await userEvent.clear(count);
    await userEvent.type(count, "6");
    await userEvent.click(screen.getByRole("button", { name: "Sinh ảnh" }));

    await waitFor(() =>
      expect(client.generateImages).toHaveBeenCalledWith("Thân bài", 6),
    );
  });

  it("will not let a typo become a bill", async () => {
    // Each picture is about four cents. "99" is somebody reaching for a
    // number, not a request for four dollars of pictures.
    await withDraft();

    const count = screen.getByRole("spinbutton", { name: "Số ảnh" });
    await userEvent.clear(count);
    await userEvent.type(count, "99");
    await userEvent.click(screen.getByRole("button", { name: "Sinh ảnh" }));

    await waitFor(() =>
      expect(client.generateImages).toHaveBeenCalledWith("Thân bài", 8),
    );
    // And the box corrects itself rather than leaving 99 on screen.
    await userEvent.click(document.body);
    expect(count).toHaveValue(8);
  });

  it("says what a picture costs before anybody spends it", async () => {
    await withDraft();

    expect(screen.getByText(/\$0\.04 mỗi ảnh/)).toBeVisible();
  });

  it("says what went wrong when the model refuses", async () => {
    client.generateImages.mockRejectedValue(
      new Error("Model không vẽ ảnh mà trả lời bằng chữ"),
    );
    await withDraft();

    await userEvent.click(screen.getByRole("button", { name: "Sinh ảnh" }));

    expect(await screen.findByText(/không vẽ ảnh/)).toBeVisible();
  });
});

describe("StudioPanel", () => {
  it("writes for Facebook without asking, because there is nothing to choose", async () => {
    // The one network this platform can publish to. A dropdown with one real
    // answer in it costs a click and a decision to arrive back where it
    // started.
    await withDraft();

    expect(screen.queryByLabelText("Kênh")).toBeNull();
    expect(client.writeContent).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "facebook" }),
    );
  });

  it("saves the piece against Facebook too, not only writes it there", async () => {
    // A draft written for Facebook and filed under something else is a post
    // the calendar will try to send down a channel it was not written for.
    await withDraft();

    await userEvent.click(screen.getByRole("button", { name: "Lưu vào lịch" }));

    await waitFor(() =>
      expect(client.createContentPiece).toHaveBeenCalledWith(
        expect.objectContaining({ channel: "facebook" }),
      ),
    );
  });

  it("saves a draft with no date rather than defaulting to now", async () => {
    // "Written, not scheduled yet" is a real state, and the calendar shows it.
    await withDraft();

    await userEvent.click(screen.getByRole("button", { name: "Lưu vào lịch" }));

    await waitFor(() =>
      expect(client.createContentPiece).toHaveBeenCalledWith(
        expect.objectContaining({ scheduledAt: undefined }),
      ),
    );
  });

  it("sends the schedule as an absolute instant", async () => {
    // A datetime-local input has no timezone. The server must never be handed
    // a wall-clock time and left to guess whose clock it was.
    await withDraft();

    const input = document.querySelector(
      'input[type="datetime-local"]',
    ) as HTMLInputElement;
    await userEvent.type(input, "2026-08-15T09:00");
    await userEvent.click(screen.getByRole("button", { name: "Lưu vào lịch" }));

    await waitFor(() => expect(client.createContentPiece).toHaveBeenCalled());
    const sent = client.createContentPiece.mock.calls[0]![0] as {
      scheduledAt: string;
    };
    expect(sent.scheduledAt).toBe(new Date("2026-08-15T09:00").toISOString());
    expect(sent.scheduledAt).toMatch(/Z$/);
  });

  it("offers no Page picker when there is nothing to choose", async () => {
    await withDraft([connection("sac_1", "Trang một")]);

    expect(screen.queryByRole("combobox", { name: "Trang đăng" })).toBeNull();
    expect(screen.getByRole("button", { name: "Lưu vào lịch" })).toBeEnabled();
  });

  it("will not save until a Page is chosen, when there are several", async () => {
    // Saving without one only defers the same question to a post that fails
    // later: the publisher refuses to pick somebody's audience.
    await withDraft([
      connection("sac_1", "Trang một"),
      connection("sac_2", "Trang hai"),
    ]);

    expect(screen.getByRole("button", { name: "Lưu vào lịch" })).toBeDisabled();

    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Trang đăng" }),
      "sac_2",
    );
    await userEvent.click(screen.getByRole("button", { name: "Lưu vào lịch" }));

    await waitFor(() =>
      expect(client.createContentPiece).toHaveBeenCalledWith(
        expect.objectContaining({ socialAccountId: "sac_2" }),
      ),
    );
  });

  it("leaves the account out entirely when none is picked", async () => {
    // An empty string is an account id matching nothing; leaving the field out
    // is what the server reads as "the only account on this channel".
    await withDraft([connection("sac_1", "Trang một")]);

    await userEvent.click(screen.getByRole("button", { name: "Lưu vào lịch" }));

    await waitFor(() => expect(client.createContentPiece).toHaveBeenCalled());
    expect(client.createContentPiece.mock.calls[0]![0]).not.toHaveProperty(
      "socialAccountId",
    );
  });

  it("takes a brief handed in from a trend", async () => {
    client.listConnections.mockResolvedValue([]);
    const { rerender } = render(
      <StudioPanel seed={{ text: "Xu hướng một", nonce: 1 }} />,
    );

    expect(screen.getByPlaceholderText(/Viết gì\?/)).toHaveValue(
      "Xu hướng một",
    );

    rerender(<StudioPanel seed={{ text: "Xu hướng hai", nonce: 2 }} />);
    expect(screen.getByPlaceholderText(/Viết gì\?/)).toHaveValue(
      "Xu hướng hai",
    );
  });

  it("re-seeds the same brief when it is clicked again", async () => {
    // The case the counter exists for: somebody edited the brief and wants the
    // original back. Comparing text alone would make the second click do
    // nothing.
    const { rerender } = render(
      <StudioPanel seed={{ text: "Xu hướng một", nonce: 1 }} />,
    );

    const box = screen.getByPlaceholderText(/Viết gì\?/);
    await userEvent.clear(box);
    await userEvent.type(box, "tôi sửa tay");

    rerender(<StudioPanel seed={{ text: "Xu hướng một", nonce: 2 }} />);

    expect(box).toHaveValue("Xu hướng một");
  });

  it("shows what a draft cost", async () => {
    // A studio whose price is invisible is one nobody can budget for.
    await withDraft();

    expect(screen.getByText(/qwen2\.5:7b · \$0\.00012/)).toBeVisible();
  });

  it("shows the notes a rewrite came back with", async () => {
    // The model saying it could not do what was asked without changing a fact
    // is the one thing a reviewer most needs to see.
    await withDraft();
    client.rewriteContent.mockResolvedValue({
      object: {
        body: "Ngắn hơn",
        notes: ["Đã bỏ con số không có trong brief"],
      },
      costUsd: "0.00003",
      model: "qwen2.5:7b",
    });

    await userEvent.type(
      screen.getByPlaceholderText("ngắn hơn một nửa"),
      "ngắn hơn",
    );
    await userEvent.click(screen.getByRole("button", { name: "Viết lại" }));

    expect(
      await screen.findByText(/Đã bỏ con số không có trong brief/),
    ).toBeVisible();
  });
});
