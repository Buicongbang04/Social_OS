"use client";

import { useState } from "react";

export type Candidate = { key: string; url: string };

/**
 * Choosing which drawn picture goes with a post.
 *
 * Shared by the composer and the calendar's editor rather than written twice:
 * they are the same job, and the copy that gets fixed is never both of them.
 *
 * Three things are possible on a tile, and each has its own control, because
 * one click meaning "look at this" in one place and "post this" in another is
 * how a picture nobody examined ends up on the page:
 *
 * - clicking the picture opens it full size, which is the only way to see
 *   whether the model wrote text into it or drew six fingers;
 * - "Dùng ảnh này" is the choice, and it is stated on the tile afterwards
 *   rather than implied by a border somebody has to notice;
 * - "Bỏ" takes a candidate off the list, so what is left is what is still
 *   being considered.
 */
export function ImagePicker({
  images,
  onImagesChange,
  value,
  onChange,
}: {
  images: Candidate[];
  onImagesChange: (images: Candidate[]) => void;
  /** The key of the picture that will be saved, or null for none. */
  value: string | null;
  onChange: (key: string | null) => void;
}) {
  const [zoomed, setZoomed] = useState<Candidate | null>(null);

  if (images.length === 0) return null;

  const remove = (candidate: Candidate) => {
    const left = images.filter((image) => image.key !== candidate.key);
    onImagesChange(left);

    // Throwing away everything else is a choice, so the survivor is taken as
    // chosen. Making somebody delete three pictures and then still click
    // "Dùng" on the one they kept is asking twice for one decision.
    if (left.length === 1) {
      onChange(left[0]!.key);
      return;
    }
    if (value === candidate.key) onChange(null);
  };

  return (
    <>
      <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {images.map((image) => {
          const chosen = value === image.key;

          return (
            <li
              key={image.key}
              className={`overflow-hidden rounded-md border-2 ${
                chosen ? "border-neutral-900" : "border-neutral-200"
              }`}
            >
              <button
                type="button"
                onClick={() => setZoomed(image)}
                aria-label="Xem ảnh cỡ lớn"
                className="block w-full"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.url}
                  alt="Ảnh đề xuất cho bài viết"
                  className="aspect-square w-full object-cover"
                />
              </button>

              <div className="flex items-center justify-between gap-1 px-1 py-1">
                {chosen ? (
                  // Said in words. A border is a thing somebody has to notice,
                  // and a picture posted by accident is not undoable.
                  <span className="px-1 text-xs font-medium text-neutral-900">
                    Sẽ đăng kèm
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onChange(image.key)}
                    className="px-1 text-xs text-neutral-600 underline hover:text-neutral-900"
                  >
                    Dùng ảnh này
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => remove(image)}
                  aria-label="Bỏ ảnh này"
                  title="Bỏ ảnh này khỏi danh sách"
                  className="rounded px-1 text-xs text-neutral-400 hover:bg-neutral-100 hover:text-red-700"
                >
                  ✕
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {zoomed ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-neutral-900/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Ảnh cỡ lớn"
          onClick={() => setZoomed(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={zoomed.url}
            alt="Ảnh đề xuất, cỡ lớn"
            className="max-h-full max-w-full rounded-md"
          />
        </div>
      ) : null}
    </>
  );
}

/**
 * How many pictures to draw.
 *
 * A number somebody types rather than a list to pick from: the list stopped at
 * four for no reason a person can see, and each picture costs the same whether
 * it came from a dropdown or a keyboard.
 */
export function ImageCount({
  value,
  onChange,
  max = 8,
}: {
  value: number;
  onChange: (value: number) => void;
  max?: number;
}) {
  /**
   * What is in the box, which is not always a number.
   *
   * Held as text so the field can be empty for the moment between clearing it
   * and typing the new value. Clamping on every keystroke instead meant an
   * empty box snapped back to 1, and the digit typed next landed after it —
   * asking for 4 pictures produced 14, which the cap then turned into 8.
   */
  const [text, setText] = useState(String(value));

  const commit = (raw: string) => {
    setText(raw);
    const asked = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(asked)) return;
    // Clamped rather than refused: 99 is somebody reaching for a number, not a
    // request to be told off — and 99 pictures is a four-dollar bill.
    onChange(Math.min(Math.max(Math.round(asked), 1), max));
  };

  return (
    <label
      className="flex items-center gap-1 text-xs text-neutral-500"
      htmlFor="so-anh"
    >
      Số ảnh
      <input
        id="so-anh"
        type="number"
        min={1}
        max={max}
        value={text}
        onChange={(event) => commit(event.target.value)}
        // An empty box left behind when focus moves would draw nothing and say
        // nothing about why.
        onBlur={() => setText(String(value))}
        className="w-14 rounded-md border border-neutral-300 px-2 py-1 text-sm text-neutral-900 focus:border-neutral-900 focus:outline-none"
      />
    </label>
  );
}
