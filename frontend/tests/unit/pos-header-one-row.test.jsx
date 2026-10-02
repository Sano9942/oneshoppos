// One Toy Store pilot, D61 (owner photo 2026-10-02): on the counter screen the
// till's top bar broke every button name onto two lines ("Paid / out", "Day /
// report", "Close / Shift") and at 1024 px hid Help / Lock / Logout off the
// side. One tidy row: no name may wrap, and the rarely used buttons (Dashboard,
// Customer Display, Help, Lock, Logout, the cashier's name) show their icon
// only below 1536 px, keeping their name as a tooltip.
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../src/pages/redesign/pos/POSContext", () => ({
  usePOS: () => ({
    employee: { id: 1, name: "Owner" },
    outlets: [{ id: 1, name: "Packages Mall" }],
    selectedOutletId: 1,
    setSelectedOutletId: vi.fn(),
    canSwitchOutlet: true,
    slip: { id: 9 },
    setSlipOpen: vi.fn(),
    handleLogout: vi.fn(),
    handleLock: vi.fn(),
    activeShift: { id: 4 },
    canOpenShift: true,
    setCloseShiftOpen: vi.fn(),
    setRecentSalesOpen: vi.fn(),
    loadRecentSales: vi.fn(),
    setReturnModalOpen: vi.fn(),
    setReturnSourceSale: vi.fn(),
    setShowShortcutsOverlay: vi.fn(),
    offlineQueueCount: 0,
    offlineSyncing: false,
    setError: vi.fn(),
  }),
}));
vi.mock("../../src/auth/AuthProvider", () => ({ useAuth: () => ({ hasPerm: () => true }) }));
vi.mock("../../src/utils/offlineQueue", () => ({ getQueueByState: async () => [] }));
vi.mock("../../src/pages/redesign/pos/POSStuckQueueModal", () => ({ default: () => null }));
vi.mock("../../src/pages/redesign/pos/POSPaidOutModal", () => ({ default: () => null }));
vi.mock("../../src/pages/redesign/pos/POSPaidInModal", () => ({ default: () => null }));

import POSHeader from "../../src/pages/redesign/pos/POSHeader";

const renderBar = () => render(<MemoryRouter><POSHeader /></MemoryRouter>);
const control = (name) => screen.getByText(name).closest("a, button");

describe("D61 — the till top bar is one tidy row", () => {
  it("no button name breaks onto two lines", () => {
    renderBar();
    for (const name of ["Last Receipt", "Recent Sales", "Return", "Customer Display", "Paid out", "Paid in",
      "Day report", "Close Shift", "Help", "Lock", "Logout", "Dashboard"]) {
      expect(control(name).className, name).toMatch(/\bwhitespace-nowrap\b/);
      expect(control(name).className, name).toMatch(/\bshrink-0\b/);
    }
  });

  it("the rarely used buttons are icon-only below 1536 px, with their name as a tooltip", () => {
    renderBar();
    for (const name of ["Dashboard", "Customer Display", "Help", "Lock", "Logout"]) {
      expect(screen.getByText(name).className, name).toMatch(/\bhidden\b.*\s2xl:inline\b/);
      expect(control(name).getAttribute("title"), name).toBeTruthy();
    }
    expect(screen.getByText("Owner").className).toMatch(/\bhidden\b.*\s2xl:block\b/);
  });

  it("the money buttons always show their names", () => {
    renderBar();
    for (const name of ["Recent Sales", "Return", "Paid out", "Paid in", "Day report", "Close Shift"]) {
      expect(screen.getByText(name).className, name).not.toMatch(/\bhidden\b/);
    }
  });
});
