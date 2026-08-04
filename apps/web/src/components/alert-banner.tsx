"use client";

import type { ContentPiece, SocialConnection } from "@repo/sdk";
import { useCallback, useEffect, useState } from "react";
import { getClient } from "../lib/api";

/** How often to look again. */
const REFRESH_MS = 60_000;

/**
 * How many failures to ask for.
 *
 * One more than the banner will name, so hitting the cap is visible: at
 * `FAILED_CAP` it says the exact number, past it "20+". A limit that quietly
 * returned twenty of forty would have this banner state a wrong count with
 * total confidence.
 */
const FAILED_CAP = 20;

type Trouble = {
  key: string;
  text: string;
  /** Broken now versus needs attention: a dead channel stops everything. */
  severity: "bad" | "warn";
};

/**
 * What is broken, at the top of the screen.
 *
 * Everything here is already visible somewhere — a FAILED piece on the
 * calendar, an EXPIRED channel in the connections list. The problem is that
 * seeing it requires scrolling to the panel that holds it and knowing to look.
 * A dead token stops every scheduled post on that channel, and the way that is
 * currently discovered is by noticing, days later, that nothing went out.
 *
 * Email says the same things, and says them without anybody opening the app —
 * but it needs a mail server that answers, and until one does this is the only
 * thing that tells somebody at all.
 */
export function AlertBanner() {
  const [troubles, setTroubles] = useState<Trouble[]>([]);

  const load = useCallback(async () => {
    try {
      const client = getClient();
      const [connections, pieces] = await Promise.all([
        client.listConnections(),
        // Only the failures, and only enough of them to count. This runs every
        // minute in every open tab; asking for the whole calendar to find the
        // broken ones ships a year of post bodies to answer a question about a
        // number.
        client.listContentPieces({
          status: "FAILED",
          limit: FAILED_CAP + 1,
        }),
      ]);

      setTroubles([...channelTrouble(connections), ...pieceTrouble(pieces)]);
    } catch {
      // A banner that cannot load must not become a banner about itself. The
      // panels below each say what went wrong with their own read.
      setTroubles([]);
    }
  }, []);

  useEffect(() => {
    void load();
    // Re-read on a timer, because the things it reports happen while nobody is
    // interacting: a token expires, a scheduled post fails at eight in the
    // morning on a page somebody left open.
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  if (troubles.length === 0) return null;

  return (
    <div className="flex flex-col gap-2" role="status">
      {troubles.map((trouble) => (
        <p
          key={trouble.key}
          className={`rounded-lg px-4 py-3 text-sm ${
            trouble.severity === "bad"
              ? "bg-red-50 text-red-900"
              : "bg-amber-50 text-amber-900"
          }`}
        >
          {trouble.text}
        </p>
      ))}
    </div>
  );
}

/**
 * Channels that have stopped working.
 *
 * Worse than a failed post, and listed first: a dead token fails not one post
 * but every one scheduled on that channel from now on.
 */
function channelTrouble(connections: SocialConnection[]): Trouble[] {
  return connections
    .filter((connection) => connection.status !== "ACTIVE")
    .map((connection) => ({
      key: `channel-${connection.id}`,
      severity: "bad" as const,
      // The two need different things done, so they are not one message with a
      // status in it.
      text:
        connection.status === "REVOKED"
          ? `Kênh "${connection.displayName}" đã bị thu hồi quyền. Cấp lại quyền bên nền tảng, rồi nối lại — bài hẹn lịch trên kênh này sẽ không đăng được.`
          : `Kênh "${connection.displayName}" đã hết hạn. Nối lại ở phần Kênh mạng xã hội — bài hẹn lịch trên kênh này sẽ không đăng được.`,
    }));
}

/**
 * Posts that did not go out.
 *
 * One line for all of them rather than one each: ten failures from one expired
 * token is one problem, and ten identical banners buries the channel warning
 * that explains them.
 */
function pieceTrouble(failed: ContentPiece[]): Trouble[] {
  if (failed.length === 0) return [];

  // Past the cap the count is not known, so it is not stated. "20+" is true;
  // "20" would be a wrong number said with confidence.
  const many =
    failed.length > FAILED_CAP
      ? `Hơn ${FAILED_CAP} bài`
      : `${failed.length} bài`;

  return [
    {
      key: "pieces-failed",
      severity: "warn",
      text:
        failed.length === 1
          ? `Bài "${failed[0]!.title}" không đăng được. Xem lý do ở Lịch nội dung.`
          : `${many} không đăng được. Xem lý do ở Lịch nội dung.`,
    },
  ];
}
