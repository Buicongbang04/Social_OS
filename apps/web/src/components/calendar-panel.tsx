"use client";

import {
  isApiError,
  type Campaign,
  type ContentPiece,
  type ContentPieceStatus,
  type SocialConnection,
} from "@repo/sdk";
import { useCallback, useEffect, useState } from "react";
import { getClient } from "../lib/api";
import { ErrorNote, Panel, PrimaryButton } from "./ui";

const STATUS_LABELS: Record<ContentPieceStatus, string> = {
  DRAFT: "nháp",
  APPROVED: "chờ tới giờ",
  PUBLISHING: "đang đăng",
  PUBLISHED: "đã đăng",
  FAILED: "hỏng",
};

const STATUS_STYLES: Record<ContentPieceStatus, string> = {
  DRAFT: "bg-neutral-100 text-neutral-700",
  APPROVED: "bg-emerald-100 text-emerald-800",
  PUBLISHING: "bg-amber-100 text-amber-900",
  PUBLISHED: "bg-sky-100 text-sky-800",
  FAILED: "bg-red-100 text-red-800",
};

/**
 * What is going out, and when.
 *
 * Grouped by day rather than drawn as a month grid. A month grid is mostly
 * empty squares for a workspace posting a few times a week, and the question
 * being asked is "what is next", not "what does August look like".
 */
export function CalendarPanel() {
  const [pieces, setPieces] = useState<ContentPiece[] | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [accounts, setAccounts] = useState<SocialConnection[]>([]);
  const [campaignName, setCampaignName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const client = getClient();
      const [content, plans, connected] = await Promise.all([
        client.listContentPieces(),
        client.listCampaigns(),
        client.listConnections(),
      ]);
      setPieces(content);
      setCampaigns(plans);
      setAccounts(connected.filter((account) => account.status === "ACTIVE"));
      setError(null);
    } catch (caught) {
      setError(describe(caught));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const addCampaign = async () => {
    if (campaignName.trim() === "") return;
    setBusy(true);
    try {
      await getClient().createCampaign({ name: campaignName.trim() });
      setCampaignName("");
      await load();
    } catch (caught) {
      setError(describe(caught));
    } finally {
      setBusy(false);
    }
  };

  const setAccount = async (piece: ContentPiece, accountId: string) => {
    try {
      await getClient().updateContentPiece(piece.id, {
        socialAccountId: accountId === "" ? null : accountId,
      });
      await load();
    } catch (caught) {
      setError(describe(caught));
    }
  };

  const drawBanner = async (piece: ContentPiece) => {
    setError(null);
    try {
      await getClient().renderBanner(piece.id, {
        footer: window.location.host,
      });
      await load();
    } catch (caught) {
      setError(describe(caught));
    }
  };

  const setStatus = async (piece: ContentPiece, status: ContentPieceStatus) => {
    try {
      await getClient().updateContentPiece(piece.id, { status });
      await load();
    } catch (caught) {
      setError(describe(caught));
    }
  };

  const remove = async (piece: ContentPiece) => {
    try {
      await getClient().archiveContentPiece(piece.id);
      await load();
    } catch (caught) {
      setError(describe(caught));
    }
  };

  const scheduled = (pieces ?? []).filter(
    (piece) => piece.scheduledAt !== null,
  );
  const undated = (pieces ?? []).filter((piece) => piece.scheduledAt === null);

  return (
    <Panel
      title="Lịch nội dung"
      subtitle="Bài nào đi lúc nào. Bài đã duyệt và tới giờ sẽ tự đăng — chưa duyệt thì không, dù ngày đã qua."
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={campaignName}
          onChange={(event) => setCampaignName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void addCampaign();
          }}
          placeholder="Tên chiến dịch mới"
          className="w-56 rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
        />
        <PrimaryButton
          busy={busy}
          onClick={() => void addCampaign()}
          disabled={campaignName.trim() === ""}
        >
          Tạo chiến dịch
        </PrimaryButton>

        {campaigns.map((campaign) => (
          <span
            key={campaign.id}
            className="rounded border border-neutral-200 px-2 py-1 text-xs text-neutral-600"
          >
            {campaign.name}
          </span>
        ))}
      </div>

      {pieces === null ? (
        <p className="text-sm text-neutral-500">Đang tải…</p>
      ) : pieces.length === 0 ? (
        <p className="text-sm text-neutral-500">
          Chưa có nội dung nào. Viết một bài ở Studio rồi lưu vào lịch.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {groupByDay(scheduled).map(([day, items]) => (
            <div key={day}>
              <p className="mb-1 text-xs font-medium text-neutral-500">{day}</p>
              <ul className="flex flex-col gap-1">
                {items.map((piece) => (
                  <Row
                    key={piece.id}
                    piece={piece}
                    accounts={accounts}
                    onStatus={setStatus}
                    onAccount={setAccount}
                    onBanner={drawBanner}
                    onRemove={remove}
                  />
                ))}
              </ul>
            </div>
          ))}

          {undated.length > 0 ? (
            <div>
              <p className="mb-1 text-xs font-medium text-neutral-500">
                Chưa hẹn ngày
              </p>
              <ul className="flex flex-col gap-1">
                {undated.map((piece) => (
                  <Row
                    key={piece.id}
                    piece={piece}
                    accounts={accounts}
                    onStatus={setStatus}
                    onAccount={setAccount}
                    onBanner={drawBanner}
                    onRemove={remove}
                  />
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}

      <ErrorNote message={error} />
    </Panel>
  );
}

function Row({
  piece,
  accounts,
  onStatus,
  onAccount,
  onBanner,
  onRemove,
}: {
  piece: ContentPiece;
  accounts: SocialConnection[];
  onStatus: (piece: ContentPiece, status: ContentPieceStatus) => Promise<void>;
  onAccount: (piece: ContentPiece, accountId: string) => Promise<void>;
  onBanner: (piece: ContentPiece) => Promise<void>;
  onRemove: (piece: ContentPiece) => Promise<void>;
}) {
  const onChannel = accounts.filter(
    (account) => account.connectorId === piece.channel,
  );
  // Editable only while it can still change anything. Once a post is out, the
  // Page it went to is a fact, and a dropdown over a fact invites somebody to
  // think they are moving it.
  const settled = piece.status === "PUBLISHED" || piece.status === "PUBLISHING";

  return (
    <li className="flex flex-wrap items-center gap-2 rounded-md border border-neutral-200 px-3 py-2 text-sm">
      {piece.scheduledAt ? (
        <span className="shrink-0 font-mono text-xs text-neutral-500">
          {timeOf(piece.scheduledAt)}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 font-medium">{piece.title}</span>
      {onChannel.length > 1 && !settled ? (
        <select
          aria-label={`Trang đăng cho "${piece.title}"`}
          value={piece.socialAccountId ?? ""}
          onChange={(event) => void onAccount(piece, event.target.value)}
          className="shrink-0 rounded border border-neutral-300 px-1 py-0.5 text-xs focus:border-neutral-900 focus:outline-none"
        >
          <option value="">Chưa chọn trang</option>
          {onChannel.map((account) => (
            <option key={account.id} value={account.id}>
              {account.displayName}
            </option>
          ))}
        </select>
      ) : (
        <span className="shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-600">
          {onChannel.find((account) => account.id === piece.socialAccountId)
            ?.displayName ?? piece.channel}
        </span>
      )}
      <span
        className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${STATUS_STYLES[piece.status]}`}
      >
        {STATUS_LABELS[piece.status]}
      </span>

      {/* Approving is a person saying this exact text may go out, and it is
          the only authorisation the publisher has — nothing else is ever sent.
          Offered from DRAFT, and again from FAILED, because a post that failed
          for a reason somebody has since fixed needs a way back without being
          rewritten. Never from PUBLISHED: that would post it twice. */}
      {piece.status === "DRAFT" || piece.status === "FAILED" ? (
        <button
          type="button"
          onClick={() => void onStatus(piece, "APPROVED")}
          className="shrink-0 text-xs text-emerald-700 underline"
        >
          {piece.status === "FAILED" ? "Duyệt lại" : "Duyệt"}
        </button>
      ) : null}

      {/* Only while it can still change the post. Drawing a banner for
          something already out would store a picture nobody will ever see
          attached to it. */}
      {!settled ? (
        <button
          type="button"
          onClick={() => void onBanner(piece)}
          className="shrink-0 text-xs text-neutral-600 underline hover:text-neutral-900"
        >
          {piece.imageKey ? "Vẽ lại ảnh" : "Vẽ ảnh"}
        </button>
      ) : null}

      {piece.imageKey ? (
        <span
          className="shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-600"
          title="Bài này sẽ đăng kèm ảnh"
        >
          có ảnh
        </span>
      ) : null}

      {/* Where it went. A calendar that says "đã đăng" without a way to go and
          look is asking to be taken on trust. */}
      {piece.publishedPostId ? (
        <a
          href={`https://www.facebook.com/${piece.publishedPostId}`}
          target="_blank"
          rel="noreferrer noopener"
          className="shrink-0 text-xs text-sky-700 underline"
        >
          Xem bài
        </a>
      ) : null}

      {piece.lastError ? (
        <span className="w-full text-xs text-red-600">{piece.lastError}</span>
      ) : null}

      <button
        type="button"
        onClick={() => void onRemove(piece)}
        className="shrink-0 text-xs text-neutral-500 underline hover:text-red-700"
      >
        Bỏ
      </button>
    </li>
  );
}

/**
 * Group by the day the reader is in, not by UTC.
 *
 * The instant is absolute; which day it falls on is not. A post at 07:00
 * Vietnam time is the previous day in UTC, and a calendar that says so is a
 * calendar nobody trusts.
 */
function groupByDay(pieces: ContentPiece[]): [string, ContentPiece[]][] {
  const days = new Map<string, ContentPiece[]>();

  for (const piece of pieces) {
    const day = new Date(piece.scheduledAt!).toLocaleDateString("vi-VN", {
      weekday: "long",
      day: "numeric",
      month: "numeric",
    });
    days.set(day, [...(days.get(day) ?? []), piece]);
  }

  return [...days.entries()];
}

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function describe(error: unknown): string {
  return isApiError(error) ? `${error.message} (${error.code})` : String(error);
}
