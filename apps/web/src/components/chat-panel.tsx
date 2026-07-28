"use client";

import {
  isApiError,
  type ChatMessage,
  type Citation,
  type Conversation,
} from "@repo/sdk";
import { useCallback, useEffect, useRef, useState } from "react";
import { getClient } from "../lib/api";
import { ErrorNote, Panel, PrimaryButton } from "./ui";

/**
 * A chat thread, streamed.
 *
 * The point of this panel is to make streaming visible: the answer has to
 * appear word by word, because that is the difference the whole SSE path
 * exists to deliver and the only way to see whether it actually works.
 */
export function ChatPanel() {
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  /** The answer currently arriving. Not yet a message — it has no id. */
  const [streaming, setStreaming] = useState<string | null>(null);
  /** What the answer being written is drawing on. */
  const [sources, setSources] = useState<Citation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Scrolls on every token rather than on every message: an answer that grows
  // below the fold is an answer nobody watches arrive.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, streaming]);

  const start = useCallback(async () => {
    setError(null);
    try {
      const created = await getClient().createConversation("Hội thoại");
      setConversation(created);
      setMessages([]);
    } catch (caught) {
      setError(describe(caught));
    }
  }, []);

  const send = async () => {
    const content = draft.trim();
    if (content === "" || busy) return;

    let thread = conversation;
    if (!thread) {
      try {
        thread = await getClient().createConversation("Hội thoại");
        setConversation(thread);
      } catch (caught) {
        setError(describe(caught));
        return;
      }
    }

    setBusy(true);
    setError(null);
    setDraft("");
    // Shown immediately rather than after the server confirms: the user typed
    // it, and a question that vanishes while the answer is being written reads
    // as the app having lost it.
    setMessages((current) => [...current, localUserMessage(content)]);
    setStreaming("");
    setSources([]);

    const abort = new AbortController();
    abortRef.current = abort;
    let answer = "";

    try {
      for await (const event of getClient().streamMessage(
        thread.id,
        content,
        abort.signal,
      )) {
        if (event.type === "sources") setSources(event.citations);
        if (event.type === "delta") {
          answer += event.text;
          setStreaming(answer);
        }
        if (event.type === "done") {
          setMessages((current) => [...current, event.message]);
          setStreaming(null);
          // Re-read the thread: the summary is written after the answer, so it
          // is only ever visible on the turn after it was made.
          void getClient()
            .listConversations()
            .then((all) => {
              const fresh = all.find((c) => c.id === thread.id);
              if (fresh) setConversation(fresh);
            })
            .catch(() => {
              // A stale summary banner is not worth an error message.
            });
        }
        if (event.type === "error") {
          // The partial answer is kept on screen: the reader saw it, and the
          // server recorded it for the same reason.
          if (event.partial) {
            setMessages((current) => [...current, event.partial!]);
          }
          setStreaming(null);
          setError(event.message);
        }
      }
    } catch (caught) {
      setStreaming(null);
      setError(describe(caught));
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  const stop = () => {
    abortRef.current?.abort();
  };

  return (
    <Panel
      title="Trò chuyện"
      subtitle="Câu trả lời hiện dần từng chữ — đó là điểm khác của streaming."
    >
      {conversation ? (
        <p className="mb-3 flex items-center gap-3 text-xs text-neutral-400">
          <span className="font-mono">{conversation.id}</span>
          <button
            type="button"
            onClick={() => void start()}
            className="underline hover:text-neutral-700"
          >
            Hội thoại mới
          </button>
        </p>
      ) : null}

      {/* Said out loud rather than left to be inferred. Past the window the
          model reads a summary instead of the original turns, and a reader who
          does not know that reads a worse answer as the model being careless. */}
      {conversation?.summary ? (
        <details className="mb-3 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
          <summary className="cursor-pointer">
            Phần đầu cuộc trò chuyện đã được tóm tắt lại (
            {conversation.summarisedCount} tin nhắn)
          </summary>
          <p className="mt-2 whitespace-pre-wrap">{conversation.summary}</p>
        </details>
      ) : null}

      <div className="mb-3 flex max-h-96 flex-col gap-2 overflow-y-auto">
        {messages.length === 0 && streaming === null ? (
          <p className="text-sm text-neutral-500">
            Chưa có tin nhắn nào. Hỏi một câu để bắt đầu.
          </p>
        ) : null}

        {messages.map((message) => (
          <Bubble
            key={message.id}
            role={message.role}
            text={message.content}
            truncated={message.truncated}
            meta={metaOf(message)}
          />
        ))}

        {sources.length > 0 ? (
          <details className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
            <summary className="cursor-pointer">
              Dựa trên {sources.length} đoạn trong tài liệu của workspace
            </summary>
            <ul className="mt-2 flex flex-col gap-2">
              {sources.map((citation, index) => (
                <li key={`${citation.documentId}-${index}`}>
                  <span className="font-medium">{citation.title}</span>{" "}
                  <span className="text-neutral-400">
                    ({citation.score.toFixed(2)})
                  </span>
                  <p className="mt-0.5 whitespace-pre-wrap text-neutral-500">
                    {citation.excerpt}
                  </p>
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        {streaming !== null ? (
          <Bubble
            role="assistant"
            // A caret while the text is empty, so the wait reads as "thinking"
            // rather than as nothing having happened.
            text={streaming === "" ? "…" : streaming}
            meta="đang trả lời"
          />
        ) : null}

        <div ref={bottomRef} />
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends, Shift+Enter breaks the line — what every chat does.
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
          rows={2}
          placeholder="Hỏi gì đó…"
          className="min-w-0 flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
        />
        {busy ? (
          <button
            type="button"
            onClick={stop}
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm hover:border-neutral-500"
          >
            Dừng
          </button>
        ) : (
          <PrimaryButton onClick={() => void send()} disabled={draft.trim() === ""}>
            Gửi
          </PrimaryButton>
        )}
      </div>

      <ErrorNote message={error} />
    </Panel>
  );
}

function Bubble({
  role,
  text,
  truncated,
  meta,
}: {
  role: string;
  text: string;
  truncated?: boolean;
  meta?: string;
}) {
  const mine = role === "user";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
          mine
            ? "bg-neutral-900 text-white"
            : truncated
              ? "border border-amber-300 bg-amber-50 text-neutral-800"
              : "border border-neutral-200 bg-white text-neutral-800"
        }`}
      >
        <p className="whitespace-pre-wrap break-words">{text}</p>
        {truncated ? (
          <p className="mt-1 text-xs text-amber-800">
            Câu trả lời bị đứt giữa chừng.
          </p>
        ) : null}
        {meta ? (
          <p
            className={`mt-1 text-xs ${mine ? "text-neutral-300" : "text-neutral-400"}`}
          >
            {meta}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** What an assistant turn cost, once it is known. */
function metaOf(message: ChatMessage): string | undefined {
  if (message.role !== "assistant" || !message.model) return undefined;

  const tokens = message.inputTokens + message.outputTokens;
  const cost = Number(message.costUsd);
  return `${message.model} · ${tokens} token${cost > 0 ? ` · $${cost.toFixed(6)}` : ""}`;
}

/**
 * The user's turn before the server has given it an id.
 *
 * Replaced by nothing — the server's copy is never re-fetched for this thread,
 * because doing so would reorder the screen while an answer is arriving. The
 * id only has to be unique within this render.
 */
function localUserMessage(content: string): ChatMessage {
  return {
    id: `local-${Date.now()}`,
    conversationId: "",
    role: "user",
    content,
    provider: null,
    model: null,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: "0",
    finishReason: null,
    truncated: false,
    createdAt: new Date().toISOString(),
  };
}

function describe(error: unknown): string {
  return isApiError(error) ? `${error.message} (${error.code})` : String(error);
}
