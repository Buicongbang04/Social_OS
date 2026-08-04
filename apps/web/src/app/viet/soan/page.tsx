"use client";

import { useEffect, useState } from "react";
import { AppShell, SectionHeader } from "../../../components/app-shell";
import {
  StudioPanel,
  type SeededBrief,
} from "../../../components/studio-panel";
import { takeBrief } from "../../../lib/brief";

/**
 * Where a post is written.
 *
 * Picks up a brief left by the competitor reader, if there is one. Read once
 * and cleared: coming back here tomorrow should not refill the box with
 * something from yesterday.
 */
export default function ComposePage() {
  const [seed, setSeed] = useState<SeededBrief | undefined>(undefined);

  useEffect(() => {
    const text = takeBrief();
    if (text !== null) setSeed({ text, nonce: 1 });
  }, []);

  return (
    <AppShell>
      {() => (
        <>
          <SectionHeader
            title="Soạn nội dung"
            hint="Viết, viết lại, dịch và kiểm SEO — rồi lưu vào lịch."
          />
          <StudioPanel seed={seed} />
        </>
      )}
    </AppShell>
  );
}
