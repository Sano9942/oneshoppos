// One Toy Store pilot (2026-09-29): the printed SanoPOS slip was a bare
// "Thank you for shopping!" line, no shop name, address or phone, no return
// policy, small grey monospace text that Chrome shrank to fit the 80mm roll.
// The owner asked for the iPOS layout: big shop name + address + phone from
// the receipt template (one line each), a Description / Price / Qty / Amount
// table with each item's code, item count, a bold grand total, payment and
// change, the policy lines at the bottom, plus a "You saved" line and the
// invoice barcode. It must print through a hidden frame (no pop-up window, so
// Chrome's pop-up blocker can't eat it), sized in mm to the roll.
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { buildReceiptSections, buildReceiptHtml } from "../../src/utils/receipt";

const TEMPLATE = {
  header_text: "ONE SHOP\nShop # G-017, Ground Floor, Packages Mall, Lahore, Pakistan\nPh: +92 42 32184836",
  footer_text: "No Refund No Warranty\nExchange within 3 days\nThank you for your kind visit!",
  show_barcode: false,
  paper_width: 48,
};

const SLIP = {
  invoiceNumber: "INV-2026-00012",
  timestamp: "29 Sep 2026, 01:24 pm",
  employee: { name: "hassan" },
  cart: [
    { name: "FLYING DISC BALL-998-190", sku: "2703", price: 350, quantity: 2 },
    { name: "ACTIVITY WALKER TRAINER-AW-994", sku: "2106", barcode: null, price: 8950, quantity: 1 },
  ],
  discountAmount: 950,
  discountType: "fixed",
  total: 8700,
  payments: [{ method: "Cash", amount: 9000 }],
  change: 300,
};

function frameDoc() {
  const f = document.getElementById("sanopos-receipt-frame");
  return f ? f.contentDocument : null;
}

describe("iPOS-style receipt: sections", () => {
  it("takes the shop name from the first header line and the rest as detail lines", () => {
    const s = buildReceiptSections(SLIP, TEMPLATE, "Rs");
    expect(s.shopName).toBe("ONE SHOP");
    expect(s.headerLines).toEqual([
      "Shop # G-017, Ground Floor, Packages Mall, Lahore, Pakistan",
      "Ph: +92 42 32184836",
    ]);
    expect(s.footerLines).toEqual(["No Refund No Warranty", "Exchange within 3 days", "Thank you for your kind visit!"]);
    expect(s.storeName).toBe("ONE SHOP");
    expect(s.itemCount).toBe(3);
    expect(s.savings).toBe(950);
  });

  it("falls back to the outlet name and a thank-you footer with no template", () => {
    const s = buildReceiptSections({ ...SLIP, outlet: { name: "Packages Mall" } }, null, "Rs");
    expect(s.shopName).toBe("Packages Mall");
    expect(s.headerLines).toEqual([]);
    expect(s.footerLines).toEqual(["Thank you for your purchase!"]);
  });
});

describe("iPOS-style receipt: printed slip", () => {
  let openSpy;
  beforeEach(() => {
    openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
  });
  afterEach(() => {
    openSpy.mockRestore();
    document.getElementById("sanopos-receipt-frame")?.remove();
  });

  it("prints in a hidden frame, never a pop-up window", async () => {
    const printed = vi.fn();
    await buildReceiptHtml(SLIP, TEMPLATE, "Rs", {}, { onPrint: printed });
    expect(openSpy).not.toHaveBeenCalled();
    expect(frameDoc()).toBeTruthy();
    expect(printed).toHaveBeenCalledTimes(1);
  });

  it("lays the slip out like iPOS", async () => {
    await buildReceiptHtml(SLIP, TEMPLATE, "Rs", {}, { onPrint: () => {} });
    const d = frameDoc();
    const text = d.body.textContent.replace(/\s+/g, " ");

    expect(d.querySelector(".shop").textContent).toBe("ONE SHOP");
    expect(text).toContain("Shop # G-017, Ground Floor, Packages Mall, Lahore, Pakistan");
    expect(text).toContain("Ph: +92 42 32184836");
    expect(text).toContain("Cashier: hassan");
    expect(text).toContain("INV-2026-00012");

    const heads = [...d.querySelectorAll("table.items th")].map((th) => th.textContent);
    expect(heads).toEqual(["Description", "Price", "Qty", "Amount"]);
    const first = d.querySelector("table.items tbody tr");
    expect(first.textContent).toContain("FLYING DISC BALL-998-190");
    expect(first.textContent).toContain("2703");
    expect(first.textContent).toContain("350.00");
    expect(first.textContent).toContain("700.00");
    // Qty is its own padded column so "1" + "8,950.00" can't read as "18,950.00".
    const cells = [...first.querySelectorAll("td")].map((td) => [td.className, td.textContent]);
    expect(cells.slice(1)).toEqual([["n", "350.00"], ["q", "2"], ["n", "700.00"]]);
    // ...and the column rule must beat the table's own "td{padding:2px 0}"
    expect(d.querySelector("style").textContent).toMatch(/table\.items \.q\{[^}]*padding:[^;}]*10px/);

    expect(text).toContain("Items: 3");
    expect(text).toContain("Sub Total");
    expect(d.querySelector(".grand").textContent.replace(/\s+/g, " ")).toContain("GRAND TOTAL");
    expect(d.querySelector(".grand").textContent).toContain("8,700.00");
    expect(text).toContain("Change");
    expect(text).toContain("300.00");
    expect(text).toContain("You saved Rs 950.00");
    expect([...d.querySelectorAll(".foot div")].map((e) => e.textContent)).toEqual([
      "No Refund No Warranty", "Exchange within 3 days", "Thank you for your kind visit!",
    ]);
  });

  it("sizes the slip to the roll in mm and prints black, not grey", async () => {
    await buildReceiptHtml(SLIP, TEMPLATE, "Rs", {}, { onPrint: () => {} });
    const css = frameDoc().querySelector("style").textContent;
    expect(css).toMatch(/@page\s*\{[^}]*margin:\s*0/);
    expect(css).toMatch(/body\{[^}]*width:72mm/);
    expect(css).toMatch(/color:#000/);
    expect(css).not.toMatch(/#999|#666|#888/);
  });

  // First real slips (2026-09-29) printed a barcode no scanner could read:
  // bars were 1.2 CSS px (~2.5 dots on a 203 dpi head, so they came out
  // 2 or 3 dots at random) with no blank quiet zone. Each bar must be a whole
  // number of printer dots (0.125 mm steps) with a 10-bar quiet zone each side.
  it("prints a scannable invoice barcode: whole-dot bars, quiet zones, sharp edges", async () => {
    await buildReceiptHtml(SLIP, { ...TEMPLATE, show_barcode: true }, "Rs", {}, { onPrint: () => {} });
    const d = frameDoc();
    const svg = d.querySelector(".barcode svg");
    expect(svg).toBeTruthy();
    const [, , vbW] = svg.getAttribute("viewBox").split(/\s+/).map(Number);
    const widthMm = parseFloat(svg.style.width);
    expect(svg.style.width).toMatch(/mm$/);
    const moduleMm = widthMm / vbW;
    expect(Math.abs(moduleMm * 8 - Math.round(moduleMm * 8))).toBeLessThan(1e-6); // whole 0.125 mm dots
    expect(moduleMm).toBeGreaterThanOrEqual(0.25);
    expect(widthMm).toBeLessThanOrEqual(72);
    // jsbarcode draws the bars in <g transform="translate(x, y)">; x is the
    // left quiet zone, and the right one is what's left of the width.
    const g = svg.querySelector("g");
    const offsetX = Number((g.getAttribute("transform") || "").match(/translate\(\s*([\d.]+)/)?.[1]);
    const bars = [...g.querySelectorAll("rect")];
    const barsEnd = Math.max(...bars.map((r) => Number(r.getAttribute("x")) + Number(r.getAttribute("width"))));
    expect(offsetX).toBeGreaterThanOrEqual(10);
    expect(vbW - offsetX - barsEnd).toBeGreaterThanOrEqual(10);
    expect(d.querySelector("style").textContent).toMatch(/crispEdges/);
    expect(d.querySelector(".barcode").textContent).toContain("INV-2026-00012");
  });

  it("uses a 48mm print width on a 58mm roll", async () => {
    await buildReceiptHtml(SLIP, { ...TEMPLATE, paper_width: 32 }, "Rs", {}, { onPrint: () => {} });
    expect(frameDoc().querySelector("style").textContent).toMatch(/body\{[^}]*width:48mm/);
  });
});

describe("POS print with no receipt printer set up", () => {
  it("goes straight to the browser slip instead of the Print failed box", async () => {
    vi.resetModules();
    vi.doMock("../../src/api", () => ({ api: { get: vi.fn(async () => ({ template: TEMPLATE })) } }));
    vi.doMock("../../src/contexts/CurrencyContext", () => ({ useCurrency: () => ({ symbol: "Rs" }) }));
    vi.doMock("../../src/contexts/PresetContext", () => ({ usePreset: () => ({ labels: {} }) }));
    const browser = vi.fn();
    vi.doMock("../../src/utils/receipt", async (orig) => ({
      ...(await orig()),
      printToHardware: vi.fn(async () => ({ error: "Printer not configured or inactive.", fallback: true, code: "PRINTER_NOT_CONFIGURED" })),
      buildReceiptHtml: browser,
    }));
    const { useReceipt } = await import("../../src/pages/redesign/pos/hooks/useReceipt");
    const { result } = renderHook(() => useReceipt({ selectedOutletId: 1 }));
    let out;
    await act(async () => { out = await result.current.printSlip(SLIP); });
    expect(browser).toHaveBeenCalledTimes(1);
    expect(result.current.retryPrompt).toBeNull();
    expect(out.ok).toBe(true);
    vi.doUnmock("../../src/utils/receipt");
  });

  it("still shows the Print failed box when a set-up printer doesn't answer", async () => {
    vi.resetModules();
    vi.doMock("../../src/api", () => ({ api: { get: vi.fn(async () => ({ template: TEMPLATE })) } }));
    vi.doMock("../../src/contexts/CurrencyContext", () => ({ useCurrency: () => ({ symbol: "Rs" }) }));
    vi.doMock("../../src/contexts/PresetContext", () => ({ usePreset: () => ({ labels: {} }) }));
    const browser = vi.fn();
    vi.doMock("../../src/utils/receipt", async (orig) => ({
      ...(await orig()),
      printToHardware: vi.fn(async () => ({ error: "connect ETIMEDOUT", fallback: true })),
      buildReceiptHtml: browser,
    }));
    const { useReceipt } = await import("../../src/pages/redesign/pos/hooks/useReceipt");
    const { result } = renderHook(() => useReceipt({ selectedOutletId: 1 }));
    await act(async () => { await result.current.printSlip(SLIP); });
    expect(browser).not.toHaveBeenCalled();
    expect(result.current.retryPrompt).toEqual({ slip: SLIP, error: "connect ETIMEDOUT" });
    vi.doUnmock("../../src/utils/receipt");
  });
});
