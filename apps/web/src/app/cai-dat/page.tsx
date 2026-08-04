"use client";

import { AppShell, SectionHeader } from "../../components/app-shell";
import { ConnectionsPanel } from "../../components/connections-panel";
import { DocumentList } from "../../components/document-list";
import { KeysPanel } from "../../components/keys-panel";
import { MemoryPanel } from "../../components/memory-panel";

/**
 * The things set once and rarely revisited.
 *
 * Ordered by how much each one changes what the platform does: whose key pays
 * for a call, which channels it can reach, what it believes about the
 * business, and what it can read.
 */
export default function SettingsPage() {
  return (
    <AppShell>
      {() => (
        <>
          <SectionHeader
            title="Cài đặt"
            hint="Khoá, kênh, ghi nhớ và tài liệu — đặt một lần rồi thôi."
          />
          <KeysPanel />
          <ConnectionsPanel />
          <MemoryPanel />
          <DocumentList />
        </>
      )}
    </AppShell>
  );
}
