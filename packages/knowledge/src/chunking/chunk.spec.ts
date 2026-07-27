import { describe, expect, it } from "vitest";
import { chunkText } from "./chunk";

const sentence = (n: number) =>
  `Đây là câu số ${n} nói về một chủ đề nào đó trong tài liệu này. `;
const paragraphs = (count: number) =>
  Array.from({ length: count }, (_, i) => sentence(i + 1)).join("");

describe("chunkText", () => {
  it("returns one chunk when the text fits", () => {
    const chunks = chunkText("Ngắn thôi.", { size: 1_000 });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).toBe("Ngắn thôi.");
    expect(chunks[0]?.index).toBe(0);
  });

  it("returns nothing for text that is only whitespace", () => {
    expect(chunkText("   \n\n  \t ")).toEqual([]);
  });

  it("keeps every chunk within the requested size", () => {
    const chunks = chunkText(paragraphs(60), { size: 300, overlap: 50 });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(300);
    }
  });

  it("cuts at sentence ends rather than mid-sentence", () => {
    // The whole point of chunking: a piece that starts mid-clause embeds as
    // something nobody wrote.
    const chunks = chunkText(paragraphs(40), { size: 300, overlap: 0 });

    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.text.endsWith(".")).toBe(true);
    }
  });

  it("prefers a blank line over a sentence end", () => {
    const text = `${"a".repeat(120)}.\n\n${"b".repeat(120)}. ${"c".repeat(60)}.`;
    const chunks = chunkText(text, { size: 260, overlap: 0 });

    expect(chunks[0]?.text).toBe("a".repeat(120) + ".");
  });

  it("repeats the tail of the previous chunk", () => {
    const chunks = chunkText(paragraphs(40), { size: 400, overlap: 120 });

    expect(chunks.length).toBeGreaterThan(1);
    const first = chunks[0]!;
    const second = chunks[1]!;
    expect(second.startOffset).toBeLessThan(first.endOffset);
  });

  it("loses no text when there is no overlap", () => {
    // Chunks that skip a region silently make part of a document unfindable,
    // and nothing downstream can notice.
    const text = paragraphs(50);
    const joined = chunkText(text, { size: 350, overlap: 0 })
      .map((chunk) => chunk.text)
      .join(" ");

    expect(joined.replaceAll(/\s+/g, "")).toBe(text.replaceAll(/\s+/g, ""));
  });

  it("points offsets at the real text", () => {
    const text = paragraphs(30);

    for (const chunk of chunkText(text, { size: 300, overlap: 40 })) {
      expect(text.slice(chunk.startOffset, chunk.endOffset)).toBe(chunk.text);
    }
  });

  it("points offsets past the whitespace a document opens with", () => {
    // Uploaded files routinely start with a blank line. Left in, the offset
    // points at nothing and a citation highlights the gap above the quote.
    const text = "\n\n   Câu mở đầu của tài liệu.";
    const chunk = chunkText(text)[0]!;

    expect(chunk.text).toBe("Câu mở đầu của tài liệu.");
    expect(text.slice(chunk.startOffset, chunk.endOffset)).toBe(chunk.text);
    expect(chunk.startOffset).toBe(5);
  });

  it("numbers chunks in reading order with no gaps", () => {
    const chunks = chunkText(paragraphs(50), { size: 300, overlap: 40 });

    expect(chunks.map((chunk) => chunk.index)).toEqual(
      chunks.map((_, i) => i),
    );
  });

  it("hard-cuts a run with no boundary in it at all", () => {
    const chunks = chunkText("x".repeat(1_000), { size: 100, overlap: 0 });

    expect(chunks).toHaveLength(10);
    expect(chunks.every((chunk) => chunk.text.length === 100)).toBe(true);
  });

  it("caps a runaway overlap instead of hanging or exploding", () => {
    // Left unclamped, each chunk would start at or before the previous one and
    // the loop would never end — a hang, not an error, which is worse. Clamped
    // only just below the size, it terminates but emits a chunk per character.
    const text = paragraphs(20);
    const chunks = chunkText(text, { size: 100, overlap: 500 });

    expect(chunks.length).toBeGreaterThan(0);
    // The step back is bounded by half the chunk actually emitted, and a
    // chunk is at least 40% of the requested size, so the cursor advances by
    // at least 20 characters each time.
    expect(chunks.length).toBeLessThanOrEqual(
      Math.ceil(text.length / 20) + 1,
    );
  });
});
