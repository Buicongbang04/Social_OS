"use client";

import { useRouter } from "next/navigation";
import { AppShell, SectionHeader } from "../../../components/app-shell";
import { CompetitorPanel } from "../../../components/competitor-panel";
import { handOffBrief } from "../../../lib/brief";

/**
 * What a competitor's page says, and what it leaves out.
 *
 * Clicking a gap writes the brief aside and moves to the composer, rather than
 * opening a box here: the two are different jobs, and reading finishes before
 * writing starts.
 */
export default function CompetitorPage() {
  const router = useRouter();

  return (
    <AppShell>
      {() => (
        <>
          <SectionHeader
            title="Tìm hiểu đối thủ"
            hint="Đọc một trang của đối thủ: họ bán gì, cho ai, và không nói gì."
          />
          <CompetitorPanel
            onUseAsBrief={(text) => {
              handOffBrief(text);
              router.push("/viet/bien-soan");
            }}
          />
        </>
      )}
    </AppShell>
  );
}
