"use client";

import { AppShell, SectionHeader } from "../../components/app-shell";
import { SpendPanel } from "../../components/spend-panel";
import { StatsPanel } from "../../components/stats-panel";

/**
 * What went out and what it cost, together.
 *
 * Two panels on one page because they answer halves of the same question: a
 * campaign that performed well and a campaign that was expensive are the same
 * campaign seen from two sides.
 */
export default function NumbersPage() {
  return (
    <AppShell>
      {() => (
        <>
          <SectionHeader
            title="Số liệu"
            hint="Bài đã đăng nhận được gì, và AI đã tiêu bao nhiêu."
          />
          <StatsPanel />
          <SpendPanel />
        </>
      )}
    </AppShell>
  );
}
