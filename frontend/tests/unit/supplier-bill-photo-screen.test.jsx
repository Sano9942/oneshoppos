// One Toy Store F9 (e): Receive supplier bill with a photo. Reading by AI
// costs money, so the screen offers it with the cost first; then the lines
// come in like a PDF bill's, struck / circled ones flagged (owner 2026-10-16).
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const LINE = { line_no: 41, page: 1, file_index: 0, supplier_code: "No 802", barcode: "6971354530229", description: "No 802", qty: 4, rate: 155, amount: 620, discount_pct: 5, check: "ok", paper_mark: "struck", unsure: false, note: null };
const BASE = { files: [{ file_name: "p1.jpeg", kind: "image", sha256: "a".repeat(64), already: null }], layout: null, layout_label: null, bill_number: null, bill_date: null, printed: {}, lines: [], lines_total: 0, total_matches: null, warnings: [], supplier_suggestion: null, expected_layout: null, layout_warning: null };

const { apiState, uploads } = vi.hoisted(() => ({ apiState: { get: vi.fn(), post: vi.fn(), upload: vi.fn() }, uploads: [] }));
vi.mock("../../src/api", () => ({ api: apiState }));
vi.mock("../../src/contexts/CurrencyContext", () => ({ useCurrency: () => ({ fmt: (n) => `Rs ${Number(n)}` }) }));
vi.mock("../../src/contexts/ToastContext", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));

const reply = (body) => ({ ok: true, json: async () => body });

beforeEach(() => {
  uploads.length = 0;
  apiState.get.mockImplementation(async (url) => {
    if (url === "/api/suppliers") return { suppliers: [{ id: 3, name: "A TO Z CONSUMERS" }] };
    if (url === "/api/outlets") return { outlets: [{ id: 1, name: "Packages Mall" }] };
    return {};
  });
  apiState.post.mockImplementation(async () => ({ lines: [{ key: "0", matches: [], chosen: [] }] }));
  apiState.upload.mockImplementation(async (url, fd) => {
    uploads.push(Object.fromEntries([...fd.entries()].filter(([k]) => k !== "files")));
    if (fd.get("use_ai") === "1") {
      return reply({ ...BASE, layout: "photo", layout_label: "Photo / handwritten (read by AI)", bill_number: "171", lines: [LINE], lines_total: 620,
        printed: { subtotal: 620, total: 589 }, total_matches: true, supplier_name_read: "A2Z CONSUMERS", supplier_suggestion: { id: 3, name: "A TO Z CONSUMERS" },
        warnings: ["Line 41: struck through on the paper, check the pieces received"], needs_photo_reader: false, ai_ready: true, ai_files: 1, ai_estimate_rs: 11,
        ai: { files: 1, cost_rs: 12.88 } });
    }
    return reply({ ...BASE, needs_photo_reader: true, ai_ready: true, ai_files: 1, ai_estimate_rs: 11 });
  });
});

async function choosePhoto() {
  const { default: Page } = await import("../../src/pages/redesign/ReceiveSupplierBillRedesign");
  const { container } = render(<MemoryRouter><Page /></MemoryRouter>);
  const input = container.querySelector('input[type="file"]');
  fireEvent.change(input, { target: { files: [new File(["x"], "p1.jpeg", { type: "image/jpeg" })] } });
  fireEvent.click(screen.getByRole("button", { name: "Read bill" }));
  return container;
}

describe("Receive supplier bill: a photo", () => {
  it("offers the AI reader with its cost and doesn't spend until asked", async () => {
    await choosePhoto();
    const btn = await screen.findByRole("button", { name: /Read with AI.*Rs 11/ });
    expect(uploads).toHaveLength(1);
    expect(uploads[0].use_ai).toBeUndefined();
    fireEvent.click(btn);
    await waitFor(() => expect(uploads).toHaveLength(2));
    expect(uploads[1].use_ai).toBe("1");
  });

  it("after reading: the cost, the name on the bill, and the struck line flagged", async () => {
    await choosePhoto();
    fireEvent.click(await screen.findByRole("button", { name: /Read with AI/ }));
    expect(await screen.findByText(/Read by AI · Rs 12.88/)).toBeTruthy();
    expect(screen.getByText((_, el) => el?.tagName === "P" && /Bill says: A2Z CONSUMERS/.test(el.textContent))).toBeTruthy();
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "3" } });
    expect(await screen.findByText("Struck through on the paper")).toBeTruthy();
  });

  it("no AI key: says so instead of offering the button", async () => {
    apiState.upload.mockImplementation(async () => reply({ ...BASE, needs_photo_reader: true, ai_ready: false, ai_files: 1, ai_estimate_rs: 11 }));
    await choosePhoto();
    expect(await screen.findByText(/photo reader isn't set up/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Read with AI/ })).toBeNull();
  });
});
