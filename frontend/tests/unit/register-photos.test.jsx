// One Toy Store pilot F3b part 3b (owner, 2026-10-01): the register shows the
// kiosk photo beside each press (clock in / break / back / clock out), and a
// press without a photo in red so the owner can ask why.
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), put: vi.fn() } }));
vi.mock("../../src/api", () => ({ api }));
vi.mock("../../src/contexts/ToastContext", () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }));

import StaffRegister from "../../src/pages/redesign/staff/StaffRegister";

const at = (hhmm) => `2026-10-02T${hhmm}:00.000Z`;
const PHOTO = "https://api.example/r2/attendance/onetoystore/7/a.jpg?exp=1&sig=x";

const REGISTER = {
  month: "2026-10",
  days: 31,
  present_by_day: { 2: 1 },
  staff: [
    {
      id: 7, name: "Tahir Mushtaq", allowance: 5, a_days: 0, s_days: 0, diff: 5, p_days: 1, no_photo_presses: 1,
      marks: {
        2: {
          mark: "P", source: "clock", first_in: at("07:30"), last_out: at("16:00"),
          presses: [
            { action: "in", at: at("07:30"), photo_url: PHOTO },
            { action: "out", at: at("16:00"), photo_url: null },
          ],
        },
      },
    },
    { id: 8, name: "Kelash Kumar", allowance: 6, a_days: 0, s_days: 0, diff: 6, p_days: 0, no_photo_presses: 0, marks: {} },
  ],
};

beforeEach(() => {
  api.get.mockReset();
  api.get.mockImplementation(async (url) => {
    if (url === "/api/staff-pay/register") return REGISTER;
    throw new Error(url);
  });
});

describe("register: photos at clock-in", () => {
  it("counts presses with no photo per person (red when any)", async () => {
    render(<StaffRegister />);
    await screen.findByText("Tahir Mushtaq");
    expect(screen.getByRole("columnheader", { name: /no photo/i })).toBeTruthy();
    const cell = screen.getByTestId("no-photo-7");
    expect(cell.textContent).toBe("1");
    expect(screen.getByTestId("no-photo-8").textContent).toBe("0");
  });

  it("Clock-ins shows each press with its photo, or 'No photo' in red", async () => {
    render(<StaffRegister />);
    await screen.findByText("Tahir Mushtaq");
    fireEvent.click(screen.getByRole("button", { name: "Clock-ins Tahir Mushtaq" }));
    const dlg = await screen.findByRole("dialog");
    const img = within(dlg).getByRole("img", { name: /Tahir Mushtaq clock in/i });
    expect(img.getAttribute("src")).toBe(PHOTO);
    expect(within(dlg).getByText(/clock out/i)).toBeTruthy();
    expect(within(dlg).getByText("No photo")).toBeTruthy();
  });

  it("a day with a press missing its photo is marked on the grid", async () => {
    render(<StaffRegister />);
    await screen.findByText("Tahir Mushtaq");
    const box = screen.getByRole("button", { name: /Tahir Mushtaq 2026-10-02/ });
    expect(box.getAttribute("aria-label")).toMatch(/no photo/i);
  });
});
