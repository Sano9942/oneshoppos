// One Toy Store F6 (D47): Sales History never showed a voided bill. Owner,
// 2026-10-19: "All" lists every bill (voided marked), "Completed" hides
// voided, "Voided" shows only them — filtered by the server so paging and the
// Voided counter (whole dates / search) are right; a voided bill shows the
// reason and who voided it and when (older voids: "who/when not recorded").
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { configure, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

configure({ asyncUtilTimeout: 5000 });

const SALES = [
  { id: 20, invoice_number: "INV-261019-003", timestamp: "2026-10-19T10:00:00Z", total_amount: 200, item_count: 1, voided: true,
    void_reason: "wrong toy rung", voided_by_name: "Hassan", voided_at: "2026-10-19T10:05:00Z" },
  { id: 19, invoice_number: "INV-2026-00090", timestamp: "2026-10-01T13:00:00Z", total_amount: 300, item_count: 1, voided: true,
    void_reason: "old test void", voided_by_name: null, voided_at: null },
  { id: 18, invoice_number: "INV-261019-001", timestamp: "2026-10-19T09:00:00Z", total_amount: 100, item_count: 1, voided: false },
];

const { apiState, calls } = vi.hoisted(() => ({ apiState: { get: vi.fn(), put: vi.fn() }, calls: [] }));
vi.mock("../../src/api", () => ({ api: apiState }));
vi.mock("../../src/auth/AuthProvider", () => ({ useAuth: () => ({ authHeaders: {}, hasPerm: () => true, company: {} }) }));
vi.mock("../../src/hooks/useFeatureFlags", () => ({ default: () => ({ flags: {}, loading: false }) }));
vi.mock("../../src/contexts/CurrencyContext", () => ({ useCurrency: () => ({ fmt: (n) => `Rs ${n}` }) }));
vi.mock("../../src/contexts/ToastContext", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), toast: vi.fn() }) }));

beforeEach(() => {
  calls.length = 0;
  apiState.get.mockImplementation(async (url) => {
    if (url.startsWith("/api/sales?")) {
      calls.push(url);
      const status = new URLSearchParams(url.split("?")[1]).get("status");
      const rows = status === "voided" ? SALES.filter((s) => s.voided)
        : status === "completed" ? SALES.filter((s) => !s.voided) : SALES;
      return { sales: rows, total: rows.length, voided_count: 7, pages: 1, page: 1 };
    }
    if (url === "/api/sales/20") return { sale: SALES[0], items: [], payments: [] };
    return {};
  });
});

async function page() {
  const { default: SalesHistoryRedesign } = await import("../../src/pages/redesign/SalesHistoryRedesign");
  render(<MemoryRouter><SalesHistoryRedesign /></MemoryRouter>);
  await screen.findByText("INV-261019-003");
}
const lastStatus = () => new URLSearchParams(calls.at(-1).split("?")[1]).get("status");

describe("F6 — Sales History voided bills", { timeout: 20000 }, () => {
  it("All asks the server for every bill, voided ones included", async () => {
    await page();
    expect(lastStatus()).toBe("all");
    expect(screen.getByText("INV-2026-00090")).toBeTruthy();
    expect(screen.getByText("INV-261019-001")).toBeTruthy();
  });

  it("the Voided and Completed tabs ask the server", async () => {
    await page();
    fireEvent.click(screen.getByRole("button", { name: "Voided" }));
    await waitFor(() => expect(lastStatus()).toBe("voided"));
    await waitFor(() => expect(screen.queryByText("INV-261019-001")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Completed" }));
    await waitFor(() => expect(lastStatus()).toBe("completed"));
    await waitFor(() => expect(screen.queryByText("INV-261019-003")).toBeNull());
  });

  it("the Voided counter is the server's count, not the page's", async () => {
    await page();
    expect(screen.getByTestId("voided-count").textContent).toBe("7");
  });

  it("a voided row shows the reason and who/when; an old one says who/when not recorded", async () => {
    await page();
    const now = screen.getByText("INV-261019-003").closest("tr");
    expect(now.textContent).toContain("wrong toy rung");
    expect(now.textContent).toContain("Hassan");
    const old = screen.getByText("INV-2026-00090").closest("tr");
    expect(old.textContent).toContain("old test void");
    expect(old.textContent).toContain("who/when not recorded");
  });

  it("the bill detail says who voided it, when and why", async () => {
    await page();
    fireEvent.click(screen.getByText("INV-261019-003"));
    const box = await screen.findByTestId("void-details");
    expect(box.textContent).toContain("Voided by Hassan");
    expect(box.textContent).toContain("wrong toy rung");
    expect(within(box).queryByText(/not recorded/)).toBeNull();
  });
});
