// One Toy Store pilot F3b part 3a (2026-10-01): a staff PIN works only at the
// kiosk. The till's "Session Expired" box took ANY employee's PIN and finished
// the signed-in person's sale; it must take only that person's PIN (the lock
// screen already checks this).
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { pos, apiMock } = vi.hoisted(() => ({
  pos: {},
  apiMock: { get: vi.fn(), post: vi.fn() },
}));
vi.mock("../../src/pages/redesign/pos/POSContext", () => ({ usePOS: () => pos }));
vi.mock("../../src/api", () => ({ api: apiMock }));

import POSSessionExpiredModal from "../../src/pages/redesign/pos/POSSessionExpiredModal";

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  Object.assign(pos, {
    sessionExpired: true,
    setSessionExpired: vi.fn(),
    retryPendingSale: vi.fn(),
    parkSale: vi.fn(),
    logout: vi.fn(),
    navigate: vi.fn(),
    employee: { id: 1, name: "hassan" },
    authHeaders: {},
  });
});

async function typePin(pin) {
  const user = userEvent.setup();
  await user.type(screen.getByPlaceholderText("••••"), pin);
  await user.click(screen.getByRole("button", { name: /re-login/i }));
}

describe("Session Expired box", () => {
  it("someone else's PIN does not finish the sale", async () => {
    apiMock.post.mockResolvedValue({ employee: { id: 6, name: "Tahir" } });
    render(<POSSessionExpiredModal />);
    await typePin("4711");
    await waitFor(() => expect(screen.getByText(/does not match/i)).toBeInTheDocument());
    expect(pos.retryPendingSale).not.toHaveBeenCalled();
  });

  it("the signed-in person's PIN finishes the sale", async () => {
    apiMock.post.mockResolvedValue({ employee: { id: 1, name: "hassan" } });
    render(<POSSessionExpiredModal />);
    await typePin("2580");
    await waitFor(() => expect(pos.retryPendingSale).toHaveBeenCalledTimes(1));
  });
});
