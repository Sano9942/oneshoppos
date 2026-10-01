// One Toy Store pilot (owner, 2026-10-01): the checkout Amount box was filled
// with the whole bill, so a cashier could press Add without typing what the
// customer handed over. Owner chose: Cash starts EMPTY and the note buttons
// ADD a note (5000 then 500 = 5,500), with Exact and Clear; Card / Online and
// the other non-cash types keep the exact amount due filled in (one click).
// The old buttons (+50/+100/+500/+1000) rounded the bill up instead, and there
// was no 5000.
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, renderHook, act } from "@testing-library/react";

const { pos } = vi.hoisted(() => ({ pos: {} }));
vi.mock("../../src/pages/redesign/pos/POSContext", () => ({ usePOS: () => pos }));
vi.mock("../../src/api", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../../src/contexts/PresetContext", () => ({
  usePreset: () => ({ labels: {}, hasMode: () => false, industry_type: "retail" }),
}));
vi.mock("../../src/utils/onlinePayments", () => ({
  isOnlineMethod: (m) => String(m).startsWith("Online"),
  onlineMethodName: (c) => `Online - ${c}`,
  useOnlinePaymentOptions: () => ["JazzCash", "EasyPaisa"],
}));
vi.mock("../../src/auth/AuthProvider", () => ({ useAuth: () => ({ employee: { id: 1 } }) }));

import POSCheckoutModal from "../../src/pages/redesign/pos/POSCheckoutModal";
import { startAmount, addNote, NOTE_BUTTONS } from "../../src/pages/redesign/pos/tenderAmount";
import { useCheckout } from "../../src/pages/redesign/pos/hooks/useCheckout";

describe("tenderAmount (pure)", () => {
  it("Cash starts empty; every other method starts at the exact amount due", () => {
    expect(startAmount("Cash", 5440)).toBe("");
    expect(startAmount("Card", 5440)).toBe("5440.00");
    expect(startAmount("Online", 2650)).toBe("2650.00");
    expect(startAmount("Cut from salary", 250)).toBe("250.00");
    expect(startAmount("Card", 0)).toBe("");
  });

  it("a note button adds the note to what is already in the box", () => {
    expect(addNote("", 5000)).toBe("5000.00");
    expect(addNote("5000.00", 500)).toBe("5500.00");
    expect(addNote("abc", 100)).toBe("100.00");
    expect(NOTE_BUTTONS).toEqual([50, 100, 500, 1000, 5000]);
  });
});

describe("checkout Amount box", () => {
  let setPaymentAmount, setPaymentMethod;
  beforeEach(() => {
    setPaymentAmount = vi.fn();
    setPaymentMethod = vi.fn();
    Object.keys(pos).forEach((k) => delete pos[k]);
    Object.assign(pos, {
      checkoutOpen: true,
      setCheckoutOpen: vi.fn(),
      money: (n) => `Rs ${Number(n || 0).toFixed(2)}`,
      remaining: 5440,
      total: 5440,
      customers: [],
      filteredCheckoutCustomers: [],
      custMode: "search",
      paymentMethod: "Cash",
      setPaymentMethod,
      paymentAmount: "",
      setPaymentAmount,
      payAmountRef: { current: null },
      addPayment: vi.fn(),
      payments: [],
      setPayments: vi.fn(),
      change: 0,
      completeSale: vi.fn(),
      setCheckoutCustSearch: vi.fn(),
      setShowCheckoutCustDD: vi.fn(),
      setCheckoutCustomerId: vi.fn(),
      openBookings: [],
      openTreatmentPlans: [],
      employeesList: [],
      posFlags: {},
      pointsDiscount: 0,
    });
  });

  it("shows Exact, 50, 100, 500, 1000, 5000 and Clear (5000 is new)", () => {
    render(<POSCheckoutModal />);
    for (const label of ["Exact", "50", "100", "500", "1000", "5000", "Clear"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
  });

  it("5000 then 500 adds up to 5,500 (not rounded up)", () => {
    const { rerender } = render(<POSCheckoutModal />);
    fireEvent.click(screen.getByRole("button", { name: "5000" }));
    expect(setPaymentAmount).toHaveBeenLastCalledWith("5000.00");
    pos.paymentAmount = "5000.00";
    rerender(<POSCheckoutModal />);
    fireEvent.click(screen.getByRole("button", { name: "500" }));
    expect(setPaymentAmount).toHaveBeenLastCalledWith("5500.00");
  });

  it("Clear empties the box; Exact fills the amount due", () => {
    pos.paymentAmount = "1234";
    render(<POSCheckoutModal />);
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(setPaymentAmount).toHaveBeenLastCalledWith("");
    fireEvent.click(screen.getByRole("button", { name: "Exact" }));
    expect(setPaymentAmount).toHaveBeenLastCalledWith("5440.00");
  });

  it("picking Card fills the exact amount due; picking Cash empties the box", () => {
    render(<POSCheckoutModal />);
    fireEvent.click(screen.getByRole("button", { name: /Card/ }));
    expect(setPaymentMethod).toHaveBeenLastCalledWith("Card");
    expect(setPaymentAmount).toHaveBeenLastCalledWith("5440.00");
    fireEvent.click(screen.getByRole("button", { name: /Cash/ }));
    expect(setPaymentAmount).toHaveBeenLastCalledWith("");
  });
});

describe("useCheckout", () => {
  const baseArgs = () => ({
    selectedOutletId: 1,
    activeShift: { id: 3 },
    attendanceCode: "clocked_in",
    cart: [{ id: 1, qty: 1, price: 5440 }],
    setCart: vi.fn(),
    total: 5440,
    customers: [],
    setCustomers: vi.fn(),
    selectedCustomerId: "",
    setCheckoutOpen: vi.fn(),
    setCheckoutCustomerId: vi.fn(),
    setRedeemPointsOn: vi.fn(),
    setPayWithWalletOn: vi.fn(),
    setChargeToRoomFolioId: vi.fn(),
    pointsDiscount: 0,
    setError: vi.fn(),
  });

  it("opening checkout leaves the Cash box empty", () => {
    const { result } = renderHook(() => useCheckout(baseArgs()));
    act(() => result.current.setPaymentAmount("999"));
    act(() => result.current.openCheckout());
    expect(result.current.paymentMethod).toBe("Cash");
    expect(result.current.paymentAmount).toBe("");
  });

  it("after a part payment in cash the box is empty again; on Card it holds the rest", () => {
    const { result } = renderHook(() => useCheckout(baseArgs()));
    act(() => result.current.openCheckout());
    act(() => result.current.setPaymentAmount("3000"));
    act(() => result.current.addPayment());
    expect(result.current.paymentAmount).toBe("");
    act(() => result.current.setPaymentMethod("Card"));
    act(() => result.current.setPaymentAmount("1000"));
    act(() => result.current.addPayment());
    expect(result.current.paymentAmount).toBe("1440.00");
  });
});
