"use client";

import { AppShell, SectionHeader } from "../components/app-shell";
import { ReportPanel } from "../components/report-panel";

/**
 * What is happening, in one screen.
 *
 * The alert banner is in the shell and shows above this on every page; what is
 * left for the overview to answer is the other question — whether any of the
 * work is paying off.
 */
export default function OverviewPage() {
  return (
    <AppShell>
      {() => (
        <>
          <SectionHeader
            title="Tổng quan"
            hint="Có gì hỏng, và mọi thứ đang ra sao."
          />
          <ReportPanel />
        </>
      )}
    </AppShell>
  );
}
