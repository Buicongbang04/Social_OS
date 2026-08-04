import type { ChatMessage, Conversation } from "@repo/sdk";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatPanel } from "./chat-panel";

const client = {
  listConversations: vi.fn(),
  createConversation: vi.fn(),
  listChatMessages: vi.fn(),
  deleteConversation: vi.fn(),
  streamMessage: vi.fn(),
};

vi.mock("../lib/api", () => ({ getClient: () => client }));

const conversation = (overrides: Partial<Conversation> = {}): Conversation =>
  ({
    id: "cnv_1",
    title: "Hội thoại",
    summary: null,
    summarisedCount: 0,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  }) as Conversation;

const message = (overrides: Partial<ChatMessage> = {}): ChatMessage =>
  ({
    id: "msg_1",
    role: "assistant",
    content: "Chào bạn.",
    truncated: false,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  }) as ChatMessage;

/** A stream that yields the events it is given, in order. */
const streamOf = (events: unknown[]) =>
   
  async function* () {
    for (const event of events) yield event;
  };

const ask = async (text = "phí ship bao nhiêu?") => {
  await userEvent.type(screen.getByPlaceholderText("Hỏi gì đó…"), text);
  await userEvent.click(screen.getByRole("button", { name: "Gửi" }));
};

beforeEach(() => {
  client.listConversations.mockResolvedValue([]);
  client.createConversation.mockResolvedValue(conversation());
  client.listChatMessages.mockResolvedValue([]);
  client.deleteConversation.mockResolvedValue(undefined);
  client.streamMessage.mockImplementation(
    streamOf([
      { type: "delta", text: "Phí " },
      { type: "delta", text: "ship là 50k." },
      { type: "done", message: message({ content: "Phí ship là 50k." }) },
    ]),
  );
});

describe("ChatPanel", () => {
  it("shows the question straight away, before any answer arrives", async () => {
    // A question that vanishes while the answer is being written reads as the
    // app having lost it.
    render(<ChatPanel />);
    await ask("phí ship bao nhiêu?");

    expect(await screen.findByText("phí ship bao nhiêu?")).toBeVisible();
  });

  it("shows the answer arriving, then the finished message", async () => {
    render(<ChatPanel />);
    await ask();

    expect(await screen.findByText("Phí ship là 50k.")).toBeVisible();
  });

  it("starts a conversation on the first message, without being asked", async () => {
    render(<ChatPanel />);
    await ask();

    await waitFor(() => expect(client.createConversation).toHaveBeenCalled());
    await waitFor(() =>
      expect(client.streamMessage).toHaveBeenCalledWith(
        "cnv_1",
        "phí ship bao nhiêu?",
        expect.anything(),
      ),
    );
  });

  it("empties the box when the question is sent", async () => {
    render(<ChatPanel />);
    await ask();

    await waitFor(() =>
      expect(screen.getByPlaceholderText("Hỏi gì đó…")).toHaveValue(""),
    );
  });

  it("will not send an empty question", async () => {
    render(<ChatPanel />);

    expect(screen.getByRole("button", { name: "Gửi" })).toBeDisabled();
  });

  it("keeps the partial answer when the stream breaks", async () => {
    // The reader saw it, and the server recorded it for the same reason.
    client.streamMessage.mockImplementation(
      streamOf([
        { type: "delta", text: "Phí ship " },
        {
          type: "error",
          message: "provider ngắt giữa chừng",
          partial: message({ content: "Phí ship ", truncated: true }),
        },
      ]),
    );
    render(<ChatPanel />);
    await ask();

    expect(await screen.findByText("Phí ship")).toBeVisible();
    expect(screen.getByText(/provider ngắt giữa chừng/)).toBeVisible();
    expect(screen.getByText(/bị đứt giữa chừng/)).toBeVisible();
  });

  it("says what the answer was based on", async () => {
    client.streamMessage.mockImplementation(
      streamOf([
        {
          type: "sources",
          citations: [
            {
              documentId: "doc_1",
              title: "Bảng phí",
              excerpt: "Ship nội thành 50k",
              score: 0.87,
            },
          ],
        },
        { type: "delta", text: "50k." },
        { type: "done", message: message({ content: "50k." }) },
      ]),
    );
    render(<ChatPanel />);
    await ask();

    expect(await screen.findByText(/Dựa trên 1 đoạn/)).toBeVisible();
  });

  it("says which tools it used to answer", async () => {
    client.streamMessage.mockImplementation(
      streamOf([
        { type: "tool", run: { name: "social.stats", result: { posts: 3 } } },
        { type: "delta", text: "Ba bài." },
        { type: "done", message: message({ content: "Ba bài." }) },
      ]),
    );
    render(<ChatPanel />);
    await ask();

    expect(await screen.findByText(/Đã dùng 1 công cụ/)).toBeVisible();
  });

  it("says out loud when the earlier turns have been summarised", async () => {
    // Past the window the model reads a summary instead of the original turns.
    // A reader who does not know that reads a worse answer as carelessness.
    client.listConversations.mockResolvedValue([
      conversation({ summary: "Khách hỏi về phí ship.", summarisedCount: 12 }),
    ]);
    client.listChatMessages.mockResolvedValue([message()]);
    render(<ChatPanel />);

    await userEvent.click(
      await screen.findByRole("button", { name: "Hội thoại" }),
    );

    expect(
      await screen.findByText(/đã được tóm tắt lại \(12 tin nhắn\)/),
    ).toBeVisible();
  });

  it("reads a thread's history back rather than showing what this tab last saw", async () => {
    // A thread continued from the phone would otherwise look like it had lost
    // messages.
    client.listConversations.mockResolvedValue([conversation()]);
    client.listChatMessages.mockResolvedValue([
      message({ content: "Tin nhắn từ máy khác" }),
    ]);
    render(<ChatPanel />);

    await userEvent.click(
      await screen.findByRole("button", { name: "Hội thoại" }),
    );

    expect(await screen.findByText("Tin nhắn từ máy khác")).toBeVisible();
  });

  it("clears one thread's sources before showing another", async () => {
    // Left on screen they would attach to an answer they had nothing to do
    // with.
    client.listConversations.mockResolvedValue([
      conversation(),
      conversation({ id: "cnv_2", title: "Hội thoại hai" }),
    ]);
    client.streamMessage.mockImplementation(
      streamOf([
        {
          type: "sources",
          citations: [
            { documentId: "d", title: "Bảng phí", excerpt: "x", score: 0.9 },
          ],
        },
        { type: "done", message: message() },
      ]),
    );
    render(<ChatPanel />);
    await ask();
    await screen.findByText(/Dựa trên 1 đoạn/);

    await userEvent.click(
      screen.getByRole("button", { name: "Hội thoại hai" }),
    );

    expect(screen.queryByText(/Dựa trên 1 đoạn/)).toBeNull();
  });

  it("offers a way to stop an answer that is still arriving", async () => {
    let release: (() => void) | undefined;
    client.streamMessage.mockImplementation(
       
      async function* () {
        yield { type: "delta", text: "Đang…" };
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      },
    );
    render(<ChatPanel />);
    await ask();

    expect(await screen.findByRole("button", { name: "Dừng" })).toBeVisible();
    release?.();
  });

  it("deletes a thread and reads the list back", async () => {
    client.listConversations.mockResolvedValue([conversation()]);
    render(<ChatPanel />);
    await screen.findByRole("button", { name: "Hội thoại" });

    await userEvent.click(
      screen.getByRole("button", { name: "Xoá hội thoại Hội thoại" }),
    );

    await waitFor(() =>
      expect(client.deleteConversation).toHaveBeenCalledWith("cnv_1"),
    );
  });

  it("says nothing is there yet rather than showing an empty box", async () => {
    render(<ChatPanel />);

    expect(await screen.findByText(/Chưa có tin nhắn nào/)).toBeVisible();
  });
});
