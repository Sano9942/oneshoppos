// One Toy Store pilot F4 (D51): the day report slip (iPOS "Daily Sale Report"
// layout) and the Close Shift result box, which vanished the moment the shift
// closed (the till reloads, has no open shift, and the box unmounted).
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

const { pos, apiMock } = vi.hoisted(() => ({ pos: {}, apiMock: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../../src/pages/redesign/pos/POSContext", () => ({ usePOS: () => pos }));
vi.mock("../../src/api", () => ({ api: apiMock }));
vi.mock("../../src/contexts/CurrencyContext", () => ({
  useCurrency: () => ({ fmt: (n) => `Rs ${Number(n || 0).toFixed(2)}`, denominations: [5000, 1000, 500, 100, 50, 20, 10], symbol: "Rs" }),
}));

import { buildDayReportHtml } from "../../src/utils/dayReportSlip";
import POSCloseShiftModal from "../../src/pages/redesign/pos/POSCloseShiftModal";

// Shift 3 on prod (1 Oct), as the endpoint returns it.
const SHIFT3 = {
  shop_name: "One Toy Store",
  shift: { id: 3, status: "closed", outlet_name: "Packages Mall", employee_name: "Hassan",
    opened_at: "2026-10-01T07:36:10Z", closed_at: "2026-10-01T17:55:52Z" },
  is_check_copy: false,
  modes: [
    { method: "Cash", label: "CASH", bills: 15, sub_total: 43500, discount: 1180, bill_total: 42320 },
    { method: "Card", label: "CREDIT CARD", bills: 9, sub_total: 49290, discount: 190, bill_total: 49100 },
    { method: "Online - JazzCash", label: "ONLINE - JAZZCASH", bills: 2, sub_total: 7560, discount: 130, bill_total: 7430 },
  ],
  sub_total: 100350, discount: 1500, total: 98850, bill_count: 27,
  staff: { bills: 0, discount: 0 }, voids: { count: 0, value: 0 },
  returns: [{ method: "Cash", count: 1, exchanges: 1, paid_back: 0 }],
  paid_outs: [{ id: 17, at: "2026-10-01T16:00:00Z", kind: "salary", label: "Salary", detail: "Ubaid", note: "Sep salary", amount: 30400, voided: false }],
  paid_ins: [{ id: 5, at: "2026-10-01T08:00:00Z", kind: "bank", label: "From bank", detail: "Alfalah", note: null, amount: 50000 }],
  drawer: { opening_float: 51210, cash_sales: 42320, cash_refunds: 0, paid_out: 89470, paid_in: 50000,
    expected_cash: 54060, counted_cash: 53730, difference: -330, variance_reason: null,
    notes: [{ denomination: 5000, count: 2 }, { denomination: 1000, count: 20 }] },
};

const slipText = (r) => {
  let text = "";
  buildDayReportHtml(r, { onPrint: (frame) => { text = frame.contentDocument.body.textContent; } });
  return text;
};

describe("day report slip", () => {
  it("prints the iPOS rows per mode and the totals", () => {
    const t = slipText(SHIFT3);
    expect(t).toContain("DAILY SALE REPORT");
    expect(t).toContain("CASH  (15 bills)");
    expect(t).toContain("43,500.00");
    expect(t).toContain("1,180.00");
    expect(t).toContain("42,320.00");
    expect(t).toContain("CREDIT CARD  (9 bills)");
    expect(t).toContain("ONLINE - JAZZCASH  (2 bills)");
    expect(t).toContain("St Net Total:100,350.00");
    expect(t).toContain("Discount Rs.:1,500.00");
    expect(t).toContain("Total:98,850.00");
    expect(t).not.toContain("CHECK COPY");
  });

  it("lists every paid out / paid in and the cash that should be in the till", () => {
    const t = slipText(SHIFT3);
    expect(t).toContain("Salary - Ubaid");
    expect(t).toContain("Sep salary");
    expect(t).toContain("30,400.00");
    expect(t).toContain("From bank - Alfalah");
    expect(t).toContain("Should be in till54,060.00");
    expect(t).toContain("Counted53,730.00");
    expect(t).toContain("Difference-330.00");
    expect(t).toContain("5,000 x 2");
  });

  it("an open shift prints as a check copy with no counted figure", () => {
    const t = slipText({ ...SHIFT3, is_check_copy: true, shift: { ...SHIFT3.shift, status: "open", closed_at: null },
      printed_until: "2026-10-01T16:07:23Z",
      drawer: { ...SHIFT3.drawer, counted_cash: null, difference: null, notes: [] } });
    expect(t).toContain("CHECK COPY - shift not closed");
    expect(t).toContain("Should be in till54,060.00");
    expect(t).not.toContain("Counted5");
  });
});

describe("Close Shift result box (F4)", () => {
  beforeEach(() => {
    Object.keys(pos).forEach((k) => delete pos[k]);
    apiMock.get.mockReset();
    apiMock.post.mockReset();
  });

  it("stays on screen after the shift closes and offers Print day report", async () => {
    const setCloseShiftOpen = vi.fn();
    Object.assign(pos, {
      closeShiftOpen: true, setCloseShiftOpen, canOpenShift: true,
      activeShift: { id: 3, outlet_id: 1 },
      authHeaders: {}, showNotice: vi.fn(), setError: vi.fn(),
      // After the close the till reloads and finds no open shift.
      refreshGateStatus: vi.fn(async () => { pos.activeShift = null; }),
    });
    apiMock.post.mockResolvedValue({ expected_cash: 54060, closing_cash: 53730, variance: -330 });
    const { rerender } = render(<POSCloseShiftModal />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Close Shift" })); });
    rerender(<POSCloseShiftModal />);

    await waitFor(() => expect(screen.getByText("Variance: Rs -330.00")).toBeTruthy());
    expect(screen.getByText("Shift #3")).toBeTruthy();

    apiMock.get.mockImplementation(async (url) => (url.includes("day-report") ? SHIFT3 : { template: { paper_width: 48 } }));
    const printSpy = vi.fn();
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag, o) => {
      const e = realCreate(tag, o);
      if (tag === "iframe") {
        queueMicrotask(() => { if (e.contentWindow) e.contentWindow.print = printSpy; });
      }
      return e;
    });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Print day report/ })); });
    await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/api/shifts/3/day-report"));
    document.createElement.mockRestore();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(setCloseShiftOpen).toHaveBeenCalledWith(false);
  });
});
