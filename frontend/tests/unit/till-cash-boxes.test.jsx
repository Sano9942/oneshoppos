// One Toy Store pilot, 2026-10-01 deploy: F3c Paid in + D57 + D58.
//
// D57 (30 Sep ~19:15, on Paid out): the cursor jumped out of a box inside a
//   pop-up after every key. The Modal/Drawer focus effect re-ran whenever the
//   parent passed a new onClose (an inline arrow), refocusing the page behind
//   and then the first button.
// D58 (30 Sep 22:35, Close Shift): the note-count boxes kept a leading "0"
//   that could not be deleted ("0120").
// F3c: cash put into the drawer (from bank / owner / staff pays back).
import React, { useState } from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { pos, apiMock } = vi.hoisted(() => ({
  pos: {},
  apiMock: { get: vi.fn(), post: vi.fn(), del: vi.fn() },
}));
vi.mock("../../src/pages/redesign/pos/POSContext", () => ({ usePOS: () => pos }));
vi.mock("../../src/api", () => ({ api: apiMock }));
vi.mock("../../src/contexts/CurrencyContext", () => ({
  useCurrency: () => ({
    fmt: (n) => `Rs ${Number(n || 0).toLocaleString("en-US")}`,
    symbol: "Rs",
    denominations: [5000, 1000, 500, 100],
  }),
}));

import { Modal, Drawer, Input } from "../../src/ui/primitives";
import POSCloseShiftModal from "../../src/pages/redesign/pos/POSCloseShiftModal";
import POSPaidInModal from "../../src/pages/redesign/pos/POSPaidInModal";

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// A parent like POSPaidOutModal: its own state, and a new onClose every render.
function Parent({ Box }) {
  const [amount, setAmount] = useState("");
  return (
    <div>
      <button type="button">behind</button>
      <Box open onClose={() => {}} title="Paid out">
        <button type="button">Shop cost</button>
        <Input aria-label="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Box>
    </div>
  );
}

describe("D57 — typing in a pop-up box keeps the cursor there", () => {
  for (const [name, Box] of [["Modal", Modal], ["Drawer", Drawer]]) {
    it(`${name}: type 1000 → the box says 1000 and still has the cursor`, async () => {
      const user = userEvent.setup();
      render(<Parent Box={Box} />);
      const box = screen.getByLabelText("Amount");
      await user.click(box);
      await user.keyboard("1000");
      expect(box).toHaveValue("1000");
      expect(document.activeElement).toBe(box);
    });
  }

  it("Escape still closes with the latest onClose", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Modal open onClose={first} title="x"><input aria-label="a" /></Modal>);
    rerender(<Modal open onClose={second} title="x"><input aria-label="a" /></Modal>);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe("D58 — Close Shift note-count boxes", () => {
  beforeEach(() => {
    Object.assign(pos, {
      closeShiftOpen: true,
      setCloseShiftOpen: vi.fn(),
      activeShift: { id: 7, outlet_id: 1 },
      canOpenShift: true,
      refreshGateStatus: vi.fn(),
      showNotice: vi.fn(),
      setError: vi.fn(),
    });
  });

  it("start blank, never show a leading 0, and add up", async () => {
    const user = userEvent.setup();
    render(<POSCloseShiftModal />);
    const boxes = screen.getAllByRole("spinbutton");
    expect(boxes).toHaveLength(4);
    for (const b of boxes) expect(b).toHaveDisplayValue("");

    await user.click(boxes[1]); // Rs 1000
    await user.keyboard("020");
    expect(boxes[1]).toHaveDisplayValue("20");

    await user.clear(boxes[1]);
    expect(boxes[1]).toHaveDisplayValue("");
    await user.keyboard("20");
    await user.click(boxes[0]);
    await user.keyboard("1");
    expect(screen.getByText(/Counted Total: Rs 25,000/)).toBeInTheDocument();
  });

  it("sends only the counted notes", async () => {
    apiMock.post.mockResolvedValue({ expected_cash: 5000, closing_cash: 5000, variance: 0 });
    const user = userEvent.setup();
    render(<POSCloseShiftModal />);
    await user.click(screen.getAllByRole("spinbutton")[0]);
    await user.keyboard("1");
    await user.click(screen.getByRole("button", { name: "Close Shift" }));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalled());
    expect(apiMock.post.mock.calls[0][1]).toMatchObject({
      closing_cash: 5000,
      denominations: [{ denomination: 5000, count: 1 }],
    });
  });
});

describe("F3c — Paid in box", () => {
  const OPTIONS = {
    kinds: [
      { key: "bank", label: "From bank" },
      { key: "owner", label: "From owner / home" },
      { key: "staff_repay", label: "Staff pays back" },
    ],
    accounts: ["EasyPaisa", "Alfalah"],
    staff: [{ id: 3, name: "Tahir Mushtaq" }],
  };

  beforeEach(() => {
    apiMock.get.mockImplementation((url) =>
      Promise.resolve(url.includes("options") ? OPTIONS : { payins: [], total: 0 }));
    apiMock.post.mockResolvedValue({ payin: { id: 1 } });
  });

  it("from bank: pick Alfalah, type 220000 → saved to this shift", async () => {
    const user = userEvent.setup();
    render(<POSPaidInModal open onClose={() => {}} shift={{ id: 2 }} />);
    await user.click(await screen.findByRole("button", { name: "From bank" }));
    await user.click(screen.getByRole("button", { name: "Alfalah" }));
    const amount = screen.getByLabelText("Amount");
    await user.click(amount);
    await user.keyboard("220000");
    expect(amount).toHaveValue(220000);
    await user.click(screen.getByRole("button", { name: "Put in" }));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalled());
    expect(apiMock.post).toHaveBeenCalledWith("/api/till-payins", expect.objectContaining({
      shift_id: 2, kind: "bank", amount: 220000, account: "Alfalah",
    }));
  });

  it("from bank without an account: asks for it, saves nothing", async () => {
    const user = userEvent.setup();
    render(<POSPaidInModal open onClose={() => {}} shift={{ id: 2 }} />);
    await user.click(await screen.findByRole("button", { name: "From bank" }));
    await user.type(screen.getByLabelText("Amount"), "100");
    await user.click(screen.getByRole("button", { name: "Put in" }));
    expect(await screen.findByText(/Pick the bank account/)).toBeInTheDocument();
    expect(apiMock.post).not.toHaveBeenCalled();
  });

  it("staff pays back: pick the staff member", async () => {
    const user = userEvent.setup();
    render(<POSPaidInModal open onClose={() => {}} shift={{ id: 2 }} />);
    await user.click(await screen.findByRole("button", { name: "Staff pays back" }));
    await user.selectOptions(screen.getByLabelText("Staff member"), "3");
    await user.type(screen.getByLabelText("Amount"), "5000");
    await user.click(screen.getByRole("button", { name: "Put in" }));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalled());
    expect(apiMock.post.mock.calls[0][1]).toMatchObject({ kind: "staff_repay", staff_employee_id: 3, amount: 5000 });
  });
});
