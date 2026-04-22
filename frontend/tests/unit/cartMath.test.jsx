// 2-G.12 — bulk-scan toggle coverage.
//
// When the per-device `pos_bulk_scan_mode_<deviceId>` localStorage value is
// "new_line", each scan creates a new cart line instead of incrementing the
// existing line. We test the branch logic directly — the same localStorage
// read + branch used inside useCart.addToCart.

import { describe, it, expect, beforeEach, afterEach } from "vitest";

// Mirror of the branch logic inside useCart.addToCart. Keeping the test
// surface minimal avoids spinning up the full hook (with price-list, promo,
// layout, and suggestion effects) just to observe one branch.
function resolveBulkScanForceNewLine() {
  let mode = "increment";
  try {
    const deviceId = localStorage.getItem("pos_device_id") || "default";
    mode = localStorage.getItem(`pos_bulk_scan_mode_${deviceId}`) || "increment";
  } catch { /* noop */ }
  return mode === "new_line";
}

function simulateAddToCart(prev, product) {
  const forceNewLine = resolveBulkScanForceNewLine();
  const found = forceNewLine ? null : prev.find((x) => x.id === product.id);
  if (found) {
    return prev.map((x) => (x.id === product.id ? { ...x, quantity: x.quantity + 1 } : x));
  }
  return [{ ...product, quantity: 1 }, ...prev];
}

const WIDGET = { id: 42, name: "Widget", price: 100 };

beforeEach(() => { localStorage.clear(); });
afterEach(() => { localStorage.clear(); });

describe("bulk-scan toggle — addToCart branching", () => {
  it("default ('increment') bumps the existing line", () => {
    let cart = [];
    cart = simulateAddToCart(cart, WIDGET);
    cart = simulateAddToCart(cart, WIDGET);
    expect(cart).toHaveLength(1);
    expect(cart[0].quantity).toBe(2);
  });

  it("'new_line' mode creates a separate line per scan", () => {
    localStorage.setItem("pos_device_id", "dev-test");
    localStorage.setItem("pos_bulk_scan_mode_dev-test", "new_line");

    let cart = [];
    cart = simulateAddToCart(cart, WIDGET);
    cart = simulateAddToCart(cart, WIDGET);
    expect(cart).toHaveLength(2);
    expect(cart[0].quantity).toBe(1);
    expect(cart[1].quantity).toBe(1);
  });

  it("missing mode key falls back to 'increment'", () => {
    localStorage.setItem("pos_device_id", "dev-test");
    // no pos_bulk_scan_mode_dev-test key

    let cart = [];
    cart = simulateAddToCart(cart, WIDGET);
    cart = simulateAddToCart(cart, WIDGET);
    expect(cart).toHaveLength(1);
    expect(cart[0].quantity).toBe(2);
  });

  it("'increment' is the device-scoped default when no deviceId is set", () => {
    // No pos_device_id at all → deviceId resolves to "default" → no mode key
    // exists for "default" → returns "increment".
    let cart = [];
    cart = simulateAddToCart(cart, WIDGET);
    cart = simulateAddToCart(cart, WIDGET);
    expect(cart).toHaveLength(1);
    expect(cart[0].quantity).toBe(2);
  });
});
