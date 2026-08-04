"use client";

import { AppShell } from "../components/app-shell";
import { DashboardPanel } from "../components/dashboard-panel";
import { ReportPanel } from "../components/report-panel";

/**
 * What is happening, in one screen.
 *
 * The alert banner is in the shell and shows above this on every page. Below it
 * the overview answers the two remaining questions, in the order they get
 * asked: what is the platform doing and what is it costing, then whether any of
 * the work is paying off.
 */
export default function OverviewPage() {
  return (
    <AppShell>
      {() => (
        <>
          <DashboardPanel />
          <ReportPanel />
        </>
      )}
    </AppShell>
  );
}
