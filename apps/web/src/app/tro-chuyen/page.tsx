"use client";

import { AppShell } from "../../components/app-shell";
import { ChatPanel } from "../../components/chat-panel";

export default function ChatPage() {
  return (
    <AppShell>
      {() => (
        <>
          <ChatPanel />
        </>
      )}
    </AppShell>
  );
}
