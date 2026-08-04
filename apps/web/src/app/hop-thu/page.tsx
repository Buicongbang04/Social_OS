"use client";

import { AppShell } from "../../components/app-shell";
import { InboxPanel } from "../../components/inbox-panel";

export default function InboxPage() {
  return (
    <AppShell>
      {() => (
        <>
          <InboxPanel />
        </>
      )}
    </AppShell>
  );
}
