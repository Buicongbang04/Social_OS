"use client";

import { AppShell, SectionHeader } from "../../components/app-shell";
import { CalendarPanel } from "../../components/calendar-panel";

export default function CalendarPage() {
  return (
    <AppShell>
      {() => (
        <>
          <SectionHeader
            title="Lịch đăng"
            hint="Bài đã duyệt và tới giờ sẽ tự đăng — chưa duyệt thì không, dù ngày đã qua."
          />
          <CalendarPanel />
        </>
      )}
    </AppShell>
  );
}
