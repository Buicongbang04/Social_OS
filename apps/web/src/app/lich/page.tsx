"use client";

import { AppShell } from "../../components/app-shell";
import { CalendarPanel } from "../../components/calendar-panel";

export default function CalendarPage() {
  return (
    <AppShell>
      {() => (
        <>
          <CalendarPanel />
        </>
      )}
    </AppShell>
  );
}
