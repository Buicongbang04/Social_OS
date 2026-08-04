"use client";

import { AppShell, SectionHeader } from "../../components/app-shell";
import { ChatPanel } from "../../components/chat-panel";

export default function ChatPage() {
  return (
    <AppShell>
      {() => (
        <>
          <SectionHeader
            title="Trò chuyện"
            hint="Hỏi về tài liệu, số liệu và kênh của workspace này."
          />
          <ChatPanel />
        </>
      )}
    </AppShell>
  );
}
