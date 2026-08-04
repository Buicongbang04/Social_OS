"use client";

import { AppShell, SectionHeader } from "../../components/app-shell";
import { GoalPanel } from "../../components/goal-panel";

/**
 * The Goal path: describe an outcome, let the runtime work out the steps.
 *
 * Its own section rather than the front page it used to be. Writing a post by
 * hand is the daily job; a Goal that plans and runs itself is the occasional
 * one, and putting it first made every visit start with the harder thing.
 */
export default function AutomationPage() {
  return (
    <AppShell>
      {(workspace) => (
        <>
          <SectionHeader
            title="Tự động"
            hint="Mô tả mục tiêu bằng lời, runtime tự tách bước và chạy."
          />
          <GoalPanel workspace={workspace} />
        </>
      )}
    </AppShell>
  );
}
