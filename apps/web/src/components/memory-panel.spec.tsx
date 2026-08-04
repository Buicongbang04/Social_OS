import type { WorkspaceMemory } from "@repo/sdk";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryPanel } from "./memory-panel";

const client = {
  listMemory: vi.fn(),
  rememberFact: vi.fn(),
  forgetFact: vi.fn(),
  extractBrandFacts: vi.fn(),
};

vi.mock("../lib/api", () => ({ getClient: () => client }));

const fact = (overrides: Partial<WorkspaceMemory> = {}): WorkspaceMemory =>
  ({
    id: "mem_1",
    key: "giọng văn",
    value: "thân thiện, ngắn gọn",
    source: "MANUAL",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  }) as WorkspaceMemory;

const proposal = {
  object: {
    facts: [
      {
        key: "dich-vu-chinh",
        value: "Mua hộ, vận chuyển quốc tế, thông quan.",
      },
      {
        key: "thi-truong",
        value: "Nhật, Indonesia, Mỹ, Thụy Sĩ, Philippines.",
      },
    ],
  },
  page: {
    url: "https://tiximax.net/",
    title: "Tiximax",
    description: null,
    headings: [],
    text: "…",
  },
  model: "gemini-2.5-flash",
  costUsd: "0.0083",
};

const readSite = async (url = "https://tiximax.net/") => {
  await userEvent.type(screen.getByPlaceholderText(/https:\/\/congty/), url);
  await userEvent.click(screen.getByRole("button", { name: "Đọc website" }));
  await screen.findByText("dich-vu-chinh");
};

beforeEach(() => {
  client.listMemory.mockResolvedValue([]);
  client.rememberFact.mockResolvedValue(fact());
  client.forgetFact.mockResolvedValue(undefined);
  client.extractBrandFacts.mockResolvedValue(proposal);
});

describe("MemoryPanel — reading the workspace's own site", () => {
  it("proposes what the site says", async () => {
    render(<MemoryPanel />);
    await readSite();

    expect(screen.getByText(/Mua hộ, vận chuyển quốc tế/)).toBeVisible();
    expect(client.extractBrandFacts).toHaveBeenCalledWith(
      "https://tiximax.net/",
    );
  });

  it("saves nothing until somebody ticks something", async () => {
    // A remembered fact shapes every post written afterwards, so a wrong one
    // is a wrong answer repeated until somebody notices.
    render(<MemoryPanel />);
    await readSite();

    expect(client.rememberFact).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: /Lưu 0 mục đã chọn/ }),
    ).toBeDisabled();
  });

  it("ticks nothing by default", async () => {
    // Pre-ticking would make saving the path of least resistance for facts
    // nobody read.
    render(<MemoryPanel />);
    await readSite();

    for (const box of screen.getAllByRole("checkbox")) {
      expect(box).not.toBeChecked();
    }
  });

  it("saves only what was ticked", async () => {
    render(<MemoryPanel />);
    await readSite();

    await userEvent.click(screen.getAllByRole("checkbox")[1]!);
    await userEvent.click(
      screen.getByRole("button", { name: /Lưu 1 mục đã chọn/ }),
    );

    await waitFor(() => expect(client.rememberFact).toHaveBeenCalledTimes(1));
    expect(client.rememberFact).toHaveBeenCalledWith(
      "thi-truong",
      "Nhật, Indonesia, Mỹ, Thụy Sĩ, Philippines.",
    );
  });

  it("clears the proposal once it has been saved", async () => {
    // Leaving it on screen invites saving the same facts twice, and makes it
    // unclear whether anything happened.
    render(<MemoryPanel />);
    await readSite();

    await userEvent.click(screen.getAllByRole("checkbox")[0]!);
    await userEvent.click(
      screen.getByRole("button", { name: /Lưu 1 mục đã chọn/ }),
    );

    await waitFor(() => expect(screen.queryByText("dich-vu-chinh")).toBeNull());
  });

  it("reads the list back, so the saved facts appear where they live", async () => {
    render(<MemoryPanel />);
    await readSite();
    client.listMemory.mockClear();

    await userEvent.click(screen.getAllByRole("checkbox")[0]!);
    await userEvent.click(
      screen.getByRole("button", { name: /Lưu 1 mục đã chọn/ }),
    );

    await waitFor(() => expect(client.listMemory).toHaveBeenCalled());
  });

  it("says plainly when a site cannot be read", async () => {
    client.extractBrandFacts.mockRejectedValue(
      new Error("tiximax.vn không cho phép đọc / (robots.txt)."),
    );
    render(<MemoryPanel />);

    await userEvent.type(
      screen.getByPlaceholderText(/https:\/\/congty/),
      "https://tiximax.vn/",
    );
    await userEvent.click(screen.getByRole("button", { name: "Đọc website" }));

    expect(await screen.findByText(/robots\.txt/)).toBeVisible();
  });

  it("says so when a page yields nothing rather than showing an empty list", async () => {
    client.extractBrandFacts.mockResolvedValue({
      ...proposal,
      object: { facts: [] },
    });
    render(<MemoryPanel />);

    await userEvent.type(
      screen.getByPlaceholderText(/https:\/\/congty/),
      "https://example.com/",
    );
    await userEvent.click(screen.getByRole("button", { name: "Đọc website" }));

    expect(
      await screen.findByText(/Không rút ra được gì từ trang này/),
    ).toBeVisible();
  });

  it("will not read an empty address", async () => {
    render(<MemoryPanel />);

    expect(screen.getByRole("button", { name: "Đọc website" })).toBeDisabled();
  });
});
