"use client";

import { AppShell, SectionHeader } from "../../components/app-shell";
import { InboxPanel } from "../../components/inbox-panel";

export default function InboxPage() {
  return (
    <AppShell>
      {() => (
        <>
          <SectionHeader
            title="Hộp thư"
            hint="Tin nhắn và bình luận khách để lại. Chỉ xem — trả lời vẫn ở trên nền tảng."
          />
          <InboxPanel />
        </>
      )}
    </AppShell>
  );
}
