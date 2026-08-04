"use client";

import { useState } from "react";
import { AppShell, SectionHeader } from "../../components/app-shell";
import { CompetitorPanel } from "../../components/competitor-panel";
import { StudioPanel, type SeededBrief } from "../../components/studio-panel";
import { TrendsPanel } from "../../components/trends-panel";

/**
 * Everything that goes into writing a post, on one page.
 *
 * Trends and the competitor reader hand a brief straight to the studio in one
 * click. A page boundary between them would turn that into copy, navigate,
 * paste — which is the friction the button exists to remove.
 */
export default function WritePage() {
  const [seed, setSeed] = useState<SeededBrief | undefined>(undefined);
  const use = (text: string) =>
    // A counter, not the text: clicking the same trend twice has to work, and
    // it would not if the value were unchanged.
    setSeed((current) => ({ text, nonce: (current?.nonce ?? 0) + 1 }));

  return (
    <AppShell>
      {() => (
        <>
          <SectionHeader
            title="Viết bài"
            hint="Xem người ta đang tìm gì, đối thủ nói gì, rồi viết."
          />
          <TrendsPanel onUseAsBrief={use} />
          <CompetitorPanel onUseAsBrief={use} />
          <StudioPanel seed={seed} />
        </>
      )}
    </AppShell>
  );
}
