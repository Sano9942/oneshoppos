// One Toy Store pilot F4b (owner, 2026-10-01/02): home staff (Aslam, the home
// driver) are paid from the drawer but their salary is the owner's home cost.
// Employees form has a "Home staff" tick; the register and Salaries list them
// last with a "Home staff" badge; the Salaries total is split shop / home and
// the pay box says it's booked as Owner / home.
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), put: vi.fn(), post: vi.fn(), del: vi.fn() } }));
vi.mock("../../src/api", () => ({ api }));
vi.mock("../../src/contexts/ToastContext", () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }));

import { orderStaff, splitTotals } from "../../src/pages/redesign/staff/staffPay";
import StaffRegister from "../../src/pages/redesign/staff/StaffRegister";
import SalariesRedesign from "../../src/pages/redesign/SalariesRedesign";

const ASLAM = { id: 13, name: "Aslam", home_staff: true, monthly_salary: 36000, allowance: 5, a_days: 0, s_days: 0, diff: 5,
  per_day: 1200, leave_adjust: 6000, gross: 42000, balance: 30000, marked_days: 30, paid: null, p_days: 0, no_photo_presses: 0, marks: {} };
const TAHIR = { id: 6, name: "Tahir Mushtaq", home_staff: false, monthly_salary: 30500, allowance: 5, a_days: 0, s_days: 0, diff: 5,
  per_day: 1016.67, leave_adjust: 5083.33, gross: 35580, balance: 15440, marked_days: 30, p_days: 30, no_photo_presses: 0, marks: {},
  paid: { id: 1, gross: 35580, cut_amount: 15440, net_pay: 20140, shift_status: "open" } };

describe("helpers", () => {
  it("orderStaff puts shop staff first, home staff last, keeping order within each", () => {
    expect(orderStaff([ASLAM, TAHIR, { id: 2, home_staff: false }]).map((s) => s.id)).toEqual([6, 2, 13]);
  });

  it("splitTotals keeps shop and home salaries apart", () => {
    expect(splitTotals([ASLAM, TAHIR])).toEqual({
      shop: { gross: 35580, paid: 20140 },
      home: { gross: 42000, paid: 0 },
    });
  });
});

describe("register", () => {
  beforeEach(() => {
    api.get.mockReset();
    api.get.mockImplementation(async () => ({ month: "2026-09", days: 30, present_by_day: {}, staff: [ASLAM, TAHIR] }));
  });

  it("lists home staff last with a Home staff badge", async () => {
    render(<StaffRegister />);
    await screen.findByText("Aslam");
    const names = screen.getAllByRole("row").map((r) => r.textContent);
    const iT = names.findIndex((t) => t.includes("Tahir Mushtaq"));
    const iA = names.findIndex((t) => t.includes("Aslam"));
    expect(iT).toBeGreaterThan(-1);
    expect(iA).toBeGreaterThan(iT);
    expect(within(screen.getAllByRole("row")[iA]).getByText("Home staff")).toBeTruthy();
  });
});

describe("Salaries page", () => {
  beforeEach(() => {
    api.get.mockReset();
    api.get.mockImplementation(async (url) => {
      if (url.startsWith("/api/staff-pay/salaries")) return { month: "2026-09", days: 30, staff: [ASLAM, TAHIR], staff_discounts: { bills: 0, value: 0 } };
      if (url.startsWith("/api/shifts")) return { shifts: [{ id: 4, outlet_id: 1, status: "open" }] };
      return {};
    });
  });

  it("splits the total into shop staff and home staff (Owner / home)", async () => {
    render(<SalariesRedesign />);
    await screen.findByText("Aslam");
    expect(screen.getByText("Home staff")).toBeTruthy();
    const shopRow = screen.getByText("Total shop staff").closest("tr");
    expect(shopRow.textContent).toContain("35,580");
    const homeRow = screen.getByText(/Home staff total/).closest("tr");
    expect(homeRow.textContent).toContain("42,000");
  });

  it("the pay box for home staff says it is booked as Owner / home", async () => {
    render(<SalariesRedesign />);
    await screen.findByText("Aslam");
    const row = screen.getByText("Aslam").closest("tr");
    fireEvent.click(within(row).getByRole("button", { name: "Pay" }));
    expect(await screen.findByText(/the cash is booked as Paid out → Owner \/ home/)).toBeTruthy();
  });
});
