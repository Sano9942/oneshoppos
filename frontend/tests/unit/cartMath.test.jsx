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

function simulateAddToCart(prev, product, overlay = {}) {
  const forceNewLine = resolveBulkScanForceNewLine();
  // W20: restaurant carts split lines by seat+course in addition to product_id.
  // Retail flow passes no overlay → seat=null / course="main" on every line, so
  // the predicate degenerates to plain id-equality.
  const seatStamp = overlay.seat_number ?? null;
  const courseStamp = overlay.course_name ?? "main";
  const matchesLine = (x) =>
    x.id === product.id
    && (x.seat_number ?? null) === (seatStamp ?? null)
    && (x.course_name ?? "main") === (courseStamp ?? "main");
  const found = forceNewLine ? null : prev.find(matchesLine);
  if (found) {
    return prev.map((x) => (matchesLine(x) ? { ...x, quantity: x.quantity + 1 } : x));
  }
  return [{ ...product, quantity: 1, seat_number: seatStamp, course_name: courseStamp }, ...prev];
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

// W20 — restaurant cart-line splitting by (seat_number, course_name).
//
// Before the fix, useCart.addToCart matched on product.id alone, so adding the
// same dish to a different seat just bumped the existing line's quantity.
// Split-bill-by-seat had nothing to split. The fix extends the merge predicate
// to also compare seat_number + course_name; retail (no overlay) is unchanged
// because retail lines all have seat=null / course="main".

describe("W20 — restaurant cart split by seat + course", () => {
  it("retail flow (no overlay) still increments existing line", () => {
    let cart = [];
    cart = simulateAddToCart(cart, WIDGET);
    cart = simulateAddToCart(cart, WIDGET);
    expect(cart).toHaveLength(1);
    expect(cart[0].quantity).toBe(2);
    expect(cart[0].seat_number).toBe(null);
    expect(cart[0].course_name).toBe("main");
  });

  it("same product on two seats produces two separate lines", () => {
    let cart = [];
    cart = simulateAddToCart(cart, WIDGET, { seat_number: 1, course_name: "course_3" });
    cart = simulateAddToCart(cart, WIDGET, { seat_number: 2, course_name: "course_3" });
    expect(cart).toHaveLength(2);
    expect(cart[0].quantity).toBe(1);
    expect(cart[1].quantity).toBe(1);
    const seats = cart.map((x) => x.seat_number).sort();
    expect(seats).toEqual([1, 2]);
  });

  it("same product, same seat, two courses produces two separate lines", () => {
    let cart = [];
    cart = simulateAddToCart(cart, WIDGET, { seat_number: 1, course_name: "course_1" });
    cart = simulateAddToCart(cart, WIDGET, { seat_number: 1, course_name: "course_3" });
    expect(cart).toHaveLength(2);
    const courses = cart.map((x) => x.course_name).sort();
    expect(courses).toEqual(["course_1", "course_3"]);
  });

  it("same product, same seat, same course increments existing line", () => {
    let cart = [];
    cart = simulateAddToCart(cart, WIDGET, { seat_number: 1, course_name: "course_3" });
    cart = simulateAddToCart(cart, WIDGET, { seat_number: 1, course_name: "course_3" });
    expect(cart).toHaveLength(1);
    expect(cart[0].quantity).toBe(2);
    expect(cart[0].seat_number).toBe(1);
    expect(cart[0].course_name).toBe("course_3");
  });

  it("two different products on the same seat+course are separate lines (id is still part of the key)", () => {
    const FRIES = { id: 7, name: "Fries", price: 200 };
    let cart = [];
    cart = simulateAddToCart(cart, WIDGET, { seat_number: 1, course_name: "course_3" });
    cart = simulateAddToCart(cart, FRIES,  { seat_number: 1, course_name: "course_3" });
    expect(cart).toHaveLength(2);
  });
});
