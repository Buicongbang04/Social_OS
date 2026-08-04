"use client";

import { useRouter } from "next/navigation";
import { AppShell } from "../../../components/app-shell";
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
