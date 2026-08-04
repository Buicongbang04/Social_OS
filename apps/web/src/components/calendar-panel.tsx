"use client";

import {
  isApiError,
  type Campaign,
  type ContentPiece,
  type ContentPieceStatus,
  type ContentReview,
  type SocialConnection,
} from "@repo/sdk";
import { useCallback, useEffect, useState } from "react";
import { getClient } from "../lib/api";
import { ImageCount, ImagePicker, type Candidate } from "./image-picker";
import { ErrorNote, Panel, PrimaryButton } from "./ui";

/**
 * The review verdict — somebody's decision, and the only thing that lets a
 * post go out.
 */
const REVIEW_LABELS: Record<ContentReview, string> = {
  DRAFT: "Nháp",
  REVIEW: "Review",
  APPROVED: "Duyệt",
  REJECTED: "Chưa đạt",
};

/**
 * Where the post is on its way out — a record of what happened, never a choice.
 *
 * Shown beside the verdict rather than folded into it: a rejected piece still
 * has to be able to say that the last attempt to send it failed, and an
 * approved one that has not gone yet is a different thing from one that has.
 */
const PUBLISH_LABELS: Record<ContentPieceStatus, string> = {
  DRAFT: "Chưa đăng",
  APPROVED: "Chưa đăng",
  PUBLISHING: "Đang đăng",
  PUBLISHED: "Đăng thành công",
  FAILED: "Đăng thất bại",
};

const PUBLISH_STYLES: Record<ContentPieceStatus, string> = {
  DRAFT: "bg-neutral-100 text-neutral-600",
  APPROVED: "bg-neutral-100 text-neutral-600",
  PUBLISHING: "bg-amber-100 text-amber-900",
  PUBLISHED: "bg-emerald-100 text-emerald-800",
  FAILED: "bg-rose-100 text-rose-800",
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
  const [preview, setPreview] = useState<ContentPiece | null>(null);
  const [editing, setEditing] = useState<ContentPiece | null>(null);

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

  /**
   * The verdict, set by a person from the dropdown.
   *
   * The only authorisation the publisher has: nothing that is not APPROVED is
   * ever sent, however its date reads.
   */
  const setReview = async (piece: ContentPiece, review: ContentReview) => {
    try {
      await getClient().updateContentPiece(piece.id, { review });
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
      subtitle="Bài nào đang có, ở trạng thái nào. Chỉ bài đã Duyệt và tới giờ mới tự đăng."
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
                    onReview={setReview}
                    onAccount={setAccount}
                    onPreview={setPreview}
                    onEdit={setEditing}
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
                    onReview={setReview}
                    onAccount={setAccount}
                    onPreview={setPreview}
                    onEdit={setEditing}
                  />
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}

      <ErrorNote message={error} />

      {preview ? (
        <Preview
          // Re-read from the list rather than held: approving something while
          // its preview is open would otherwise leave the dialog showing the
          // verdict it had when it was opened.
          piece={
            (pieces ?? []).find((piece) => piece.id === preview.id) ?? preview
          }
          accounts={accounts}
          onClose={() => setPreview(null)}
        />
      ) : null}

      {editing ? (
        <Editor
          piece={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      ) : null}
    </Panel>
  );
}

function Row({
  piece,
  accounts,
  onReview,
  onAccount,
  onPreview,
  onEdit,
}: {
  piece: ContentPiece;
  accounts: SocialConnection[];
  onReview: (piece: ContentPiece, review: ContentReview) => Promise<void>;
  onAccount: (piece: ContentPiece, accountId: string) => Promise<void>;
  onPreview: (piece: ContentPiece) => void;
  onEdit: (piece: ContentPiece) => void;
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

      {piece.imageKey ? (
        <span
          className="shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-600"
          title="Bài này sẽ đăng kèm ảnh"
        >
          có ảnh
        </span>
      ) : null}

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

      {/* The verdict, chosen. Approving is a person saying this exact text may
          go out, and it is the only authorisation the publisher has — nothing
          that is not "Duyệt" is ever sent. Closed once a post is out: changing
          the verdict on something already published changes nothing except
          what the screen claims. */}
      <select
        aria-label={`Trạng thái duyệt cho "${piece.title}"`}
        value={piece.review}
        disabled={settled}
        onChange={(event) =>
          void onReview(piece, event.target.value as ContentReview)
        }
        className="shrink-0 rounded border border-neutral-300 px-1 py-0.5 text-xs focus:border-neutral-900 focus:outline-none disabled:bg-neutral-100 disabled:text-neutral-500"
      >
        {(Object.keys(REVIEW_LABELS) as (keyof typeof REVIEW_LABELS)[]).map(
          (review) => (
            <option key={review} value={review}>
              {REVIEW_LABELS[review]}
            </option>
          ),
        )}
      </select>

      {/* Not a choice: a record of what happened. */}
      <span
        className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${PUBLISH_STYLES[piece.status]}`}
      >
        {PUBLISH_LABELS[piece.status]}
      </span>

      {/* What the post will actually look like — the only way to see the text
          and the picture together before somebody approves them. */}
      <button
        type="button"
        onClick={() => onPreview(piece)}
        aria-label={`Xem trước "${piece.title}"`}
        title="Xem trước bài đăng"
        className="shrink-0 rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
      >
        <EyeIcon />
      </button>

      {/* Beside the preview, because looking is what tells somebody there is
          something to fix — a paragraph that reads wrong, or a post that never
          got a picture. Closed once the post is out: editing the row then
          changes nothing on Facebook, it only makes this screen disagree with
          what was actually sent. */}
      <button
        type="button"
        onClick={() => onEdit(piece)}
        disabled={settled}
        aria-label={`Sửa "${piece.title}"`}
        title={
          settled
            ? "Bài đã đăng — sửa ở đây không đổi được bài trên Facebook"
            : "Sửa nội dung hoặc thêm ảnh"
        }
        className="shrink-0 rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 disabled:pointer-events-none disabled:text-neutral-300"
      >
        <PencilIcon />
      </button>

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
    </li>
  );
}

function EyeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      aria-hidden
    >
      <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z" />
      <circle cx="12" cy="12" r="2.6" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      aria-hidden
    >
      <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3Z" />
      <path d="M14.5 6.5 17.5 9.5" />
    </svg>
  );
}

/**
 * The post as Facebook will show it.
 *
 * Built from the same fields the publisher sends, in the same order, rather
 * than from a summary: the point of looking is to catch what is wrong with the
 * real thing, and a preview that tidies it up catches nothing.
 */
function Preview({
  piece,
  accounts,
  onClose,
}: {
  piece: ContentPiece;
  accounts: SocialConnection[];
  onClose: () => void;
}) {
  const [image, setImage] = useState<string | null>(null);
  const page = accounts.find((account) => account.id === piece.socialAccountId);

  useEffect(() => {
    if (!piece.imageKey) return;
    let cancelled = false;

    // The key is not a URL. A link is minted per view because a stored one
    // expires, and a preview showing a broken picture would read as a post
    // with a broken picture.
    void getClient()
      .contentImageUrl(piece.id)
      .then((result) => {
        if (!cancelled) setImage(result.url);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [piece.id, piece.imageKey]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-neutral-900/40 p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label={`Xem trước "${piece.title}"`}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-lg bg-white shadow-lg"
        // Clicking the post itself must not close what somebody opened to read.
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-2">
          <p className="text-sm font-medium text-neutral-700">
            Bài đăng sẽ trông như thế này
          </p>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-100"
          >
            Đóng
          </button>
        </div>

        <div className="p-4">
          <div className="rounded-md border border-neutral-200">
            <div className="flex items-center gap-2 px-3 py-2">
              <span
                className="h-8 w-8 rounded-full bg-neutral-200"
                aria-hidden
              />
              <span className="text-sm font-medium text-neutral-800">
                {page?.displayName ?? piece.channel}
              </span>
            </div>

            {/* whitespace-pre-wrap, because the line breaks are the format:
                a preview that collapses them shows a post nobody is sending. */}
            <p className="whitespace-pre-wrap px-3 pb-3 text-sm text-neutral-900">
              {piece.body}
            </p>

            {piece.hashtags.length > 0 ? (
              <p className="px-3 pb-3 text-sm text-sky-700">
                {piece.hashtags.map((tag) => `#${tag}`).join(" ")}
              </p>
            ) : null}

            {piece.imageKey ? (
              image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={image}
                  alt={`Ảnh của bài "${piece.title}"`}
                  className="w-full"
                />
              ) : (
                <p className="px-3 pb-3 text-xs text-neutral-400">
                  Đang tải ảnh…
                </p>
              )
            ) : null}
          </div>

          <p className="mt-2 text-xs text-neutral-500">
            {piece.scheduledAt
              ? `Hẹn đăng ${new Date(piece.scheduledAt).toLocaleString("vi-VN")}`
              : "Chưa hẹn ngày đăng"}
            {" · "}
            {REVIEW_LABELS[piece.review]}
            {" · "}
            {PUBLISH_LABELS[piece.status]}
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Fixing a post that is already on the calendar.
 *
 * The same three things that go wrong after a piece is saved: the text reads
 * wrong, the date is wrong, or nobody drew a picture for it. Sending somebody
 * back to the composer to fix any of them would mean writing the post again —
 * the composer starts from a brief, not from a draft that already exists.
 *
 * Only the fields that actually changed are sent. A save that writes every
 * field bumps the row and its audit columns for a dialog somebody opened and
 * closed.
 */
function Editor({
  piece,
  onClose,
  onSaved,
}: {
  piece: ContentPiece;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  /**
   * Reported inside the dialog, not by the panel behind it.
   *
   * It used to call up to the panel, which draws its error under the list —
   * underneath this overlay. A refused save looked exactly like a button that
   * does nothing, which is how "nút lưu không hoạt động" got reported.
   */
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState(piece.title);
  const [body, setBody] = useState(piece.body);
  const [hashtags, setHashtags] = useState(piece.hashtags.join(" "));
  const [scheduledAt, setScheduledAt] = useState(localInput(piece.scheduledAt));
  const [imageKey, setImageKey] = useState<string | null>(piece.imageKey);
  const [images, setImages] = useState<Candidate[]>([]);
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState<"images" | "save" | null>(null);

  // The picture already on the piece, so somebody replacing one can see what
  // they are replacing rather than working from the word "có ảnh".
  const [current, setCurrent] = useState<string | null>(null);
  useEffect(() => {
    if (!piece.imageKey) return;
    let cancelled = false;

    void getClient()
      .contentImageUrl(piece.id)
      .then((result) => {
        if (!cancelled) setCurrent(result.url);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [piece.id, piece.imageKey]);

  const draw = async () => {
    setBusy("images");
    setError(null);
    try {
      // Drawn from the text on screen, not from what was saved: the point of
      // being here is usually that the saved text was wrong.
      const result = await getClient().generateImages(body, count);
      setImages(result.images);
    } catch (caught) {
      setError(describe(caught));
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setBusy("save");
    setError(null);
    try {
      const tags = hashtags
        .split(/[\s,]+/)
        .map((tag) => tag.replace(/^#/, ""))
        .filter(Boolean);

      const changes = {
        ...(title === piece.title ? {} : { title }),
        ...(body === piece.body ? {} : { body }),
        ...(tags.join(" ") === piece.hashtags.join(" ")
          ? {}
          : { hashtags: tags }),
        ...(scheduledAt === localInput(piece.scheduledAt)
          ? {}
          : {
              scheduledAt:
                scheduledAt === "" ? null : new Date(scheduledAt).toISOString(),
            }),
        ...(imageKey === piece.imageKey ? {} : { imageKey }),
      };

      // Said rather than sent. A save that closes the dialog having written
      // nothing is indistinguishable from a button that does not work, which
      // is exactly how it got reported.
      if (Object.keys(changes).length === 0) {
        setError("Chưa có gì thay đổi để lưu.");
        setBusy(null);
        return;
      }

      await getClient().updateContentPiece(piece.id, changes);
      await onSaved();
    } catch (caught) {
      setError(describe(caught));
      setBusy(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-neutral-900/40 p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label={`Sửa "${piece.title}"`}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-lg bg-white shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-2">
          <p className="text-sm font-medium text-neutral-700">Sửa bài</p>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-100"
          >
            Đóng
          </button>
        </div>

        <div className="flex flex-col gap-3 p-4">
          <label className="text-xs text-neutral-500">
            Tiêu đề
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1 text-sm text-neutral-900 focus:border-neutral-900 focus:outline-none"
            />
          </label>

          <label className="text-xs text-neutral-500">
            Nội dung
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={12}
              className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-2 text-sm text-neutral-900 focus:border-neutral-900 focus:outline-none"
            />
          </label>

          <label className="text-xs text-neutral-500">
            Hashtag
            <input
              value={hashtags}
              onChange={(event) => setHashtags(event.target.value)}
              placeholder="Tiximax OrderQuocTe"
              className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1 text-sm text-neutral-900 focus:border-neutral-900 focus:outline-none"
            />
          </label>

          <label className="text-xs text-neutral-500">
            Hẹn đăng
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(event) => setScheduledAt(event.target.value)}
              className="mt-1 block rounded-md border border-neutral-300 px-2 py-1 text-sm text-neutral-900 focus:border-neutral-900 focus:outline-none"
            />
          </label>

          <div className="border-t border-neutral-100 pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <PrimaryButton
                busy={busy === "images"}
                onClick={() => void draw()}
              >
                {piece.imageKey ? "Sinh ảnh khác" : "Sinh ảnh"}
              </PrimaryButton>
              <ImageCount value={count} onChange={setCount} />
              <span className="text-xs text-neutral-500">
                khoảng $0.04 mỗi ảnh
              </span>
            </div>

            {/* What is on the piece now, until something new is drawn. */}
            {images.length === 0 && current ? (
              <div className="mt-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={current}
                  alt={`Ảnh hiện tại của "${piece.title}"`}
                  className="w-40 rounded-md"
                />
                <button
                  type="button"
                  onClick={() => setImageKey(null)}
                  className="mt-1 text-xs text-neutral-500 underline hover:text-red-700"
                >
                  {imageKey === null ? "Sẽ gỡ ảnh khi lưu" : "Gỡ ảnh"}
                </button>
              </div>
            ) : null}

            <ImagePicker
              images={images}
              onImagesChange={setImages}
              value={imageKey}
              onChange={setImageKey}
            />
          </div>

          <ErrorNote message={error} />

          <div className="flex items-center gap-2 border-t border-neutral-100 pt-3">
            <PrimaryButton
              busy={busy === "save"}
              onClick={() => void save()}
              disabled={body.trim() === "" || title.trim() === ""}
            >
              Lưu
            </PrimaryButton>
            <span className="text-xs text-neutral-500">
              Sửa xong vẫn giữ nguyên trạng thái duyệt.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * An instant, as `datetime-local` wants it: the reader's own wall clock.
 *
 * Built by hand rather than with toISOString, which would hand back UTC and
 * show a Vietnamese 09:00 post as 02:00 in the box somebody is about to edit.
 */
function localInput(iso: string | null): string {
  if (!iso) return "";
  const at = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");

  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
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
