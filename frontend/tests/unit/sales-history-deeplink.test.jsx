// One Toy Store pilot, Phase B step 7: a bill no in a product's History tab
// links to /sales-history?q=<bill no>; the page opens already searching for it.
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const { apiState } = vi.hoisted(() => ({ apiState: { get: vi.fn(async () => ({ sales: [], total: 0, pages: 1, page: 1 })) } }));
vi.mock("../../src/api", () => ({ api: apiState }));
vi.mock("../../src/auth/AuthProvider", () => ({ useAuth: () => ({ authHeaders: {}, hasPerm: () => true, company: {} }) }));
vi.mock("../../src/hooks/useFeatureFlags", () => ({ default: () => ({ flags: {}, loading: false }) }));
vi.mock("../../src/contexts/CurrencyContext", () => ({ useCurrency: () => ({ fmt: (n) => `Rs ${n}` }) }));
vi.mock("../../src/contexts/ToastContext", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), toast: vi.fn() }) }));

describe("Sales History ?q=", () => {
  it("searches for the bill no from the link", async () => {
    window.history.pushState({}, "", "/sales-history?q=INV-2026-00011");
    const { default: SalesHistoryRedesign } = await import("../../src/pages/redesign/SalesHistoryRedesign");
    render(<MemoryRouter><SalesHistoryRedesign /></MemoryRouter>);
    await waitFor(() => expect(apiState.get.mock.calls.some(([u]) => u.startsWith("/api/sales?") && u.includes("search=INV-2026-00011"))).toBe(true));
    expect(screen.getByDisplayValue("INV-2026-00011")).toBeTruthy();
    window.history.pushState({}, "", "/");
  });
});
