// One Toy Store pilot F3b part 3b (owner, 2026-10-01): against PIN sharing the
// kiosk takes a photo on EVERY press (clock in, break, back, clock out). The
// camera opens once the PIN is accepted; the photo is snapped at the moment of
// the press and sent as photo_base64. If the camera fails (refused, unplugged,
// old phone browser) the press still goes through without a photo and the
// screen says so; the register shows it in red.
import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, renderHook, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const { api, cam } = vi.hoisted(() => ({
  api: { post: vi.fn(), get: vi.fn() },
  // Like the real hook: no picture unless the camera is ready.
  cam: { status: "ready", snap() { return this.status === "ready" ? "data:image/jpeg;base64,SNAP" : null; } },
}));
vi.mock("../../src/api", () => ({ api }));
vi.mock("../../src/auth/authStore", () => ({ readContext: () => null, readTenantSlug: () => "onetoystore" }));
vi.mock("../../src/pages/redesign/kiosk/kioskCamera", async (orig) => ({
  ...(await orig()),
  useKioskCamera: (active) => ({ videoRef: { current: null }, status: active ? cam.status : "off", snap: () => cam.snap() }),
}));

import KioskRedesign from "../../src/pages/redesign/KioskRedesign";
const { useKioskCamera: realUseKioskCamera } = await vi.importActual("../../src/pages/redesign/kiosk/kioskCamera");

const STATUS = {
  not_clocked_in: { employee: { id: 7, name: "Tahir" }, status: "not_clocked_in", net_work_hours_today: 0 },
  clocked_in: {
    employee: { id: 7, name: "Tahir" }, status: "clocked_in", net_work_hours_today: 1,
    current_session: { session_start: new Date().toISOString(), session_type: "work" },
  },
  on_break: {
    employee: { id: 7, name: "Tahir" }, status: "on_break", net_work_hours_today: 1,
    current_session: { session_start: new Date().toISOString(), session_type: "break", break_reason: "lunch" },
  },
};

function setup(status) {
  api.post.mockImplementation(async (url) => {
    if (url.startsWith("/api/attendance/pin-outlets")) return { outlets: [{ id: 1, name: "Packages Mall" }], kiosk_locked: true };
    if (url === "/api/attendance/pin-status") return STATUS[status];
    if (url === "/api/attendance/pin-checkin") return { employee: { id: 7, name: "Tahir" }, photo_saved: cam.status === "ready" };
    if (url === "/api/attendance/pin-checkout") return { employee: { id: 7, name: "Tahir" }, photo_saved: cam.status === "ready", message: "ok" };
    throw new Error(`unexpected ${url}`);
  });
  render(
    <MemoryRouter initialEntries={["/kiosk?tenant=onetoystore&outlet=1"]}>
      <KioskRedesign />
    </MemoryRouter>,
  );
}

async function enterPin() {
  await screen.findByText("Packages Mall");
  for (const d of ["4", "7", "1", "1"]) fireEvent.click(screen.getByRole("button", { name: d }));
  fireEvent.click(screen.getByRole("button", { name: "Submit PIN" }));
  await screen.findByText("Tahir");
}

const body = (url) => api.post.mock.calls.find((c) => c[0] === url)?.[1];

beforeEach(() => {
  api.post.mockReset();
  cam.status = "ready";
});

describe("kiosk: a photo on every press", () => {
  it("clock in sends the photo taken at that moment", async () => {
    setup("not_clocked_in");
    await enterPin();
    fireEvent.click(screen.getByRole("button", { name: "Clock In" }));
    await screen.findByText(/Welcome, Tahir/);
    expect(body("/api/attendance/pin-checkin").photo_base64).toBe("data:image/jpeg;base64,SNAP");
    expect(screen.getByText(/photo taken/i)).toBeTruthy();
  });

  it("break and clock out send a photo too", async () => {
    setup("clocked_in");
    await enterPin();
    fireEvent.click(screen.getByRole("button", { name: "Go on Break" }));
    fireEvent.click(await screen.findByRole("button", { name: "Lunch" }));
    await screen.findByText(/Break Started/);
    expect(body("/api/attendance/pin-checkout")).toMatchObject({ break_reason: "lunch", photo_base64: "data:image/jpeg;base64,SNAP" });
  });

  it("back from break sends a photo", async () => {
    setup("on_break");
    await enterPin();
    fireEvent.click(screen.getByRole("button", { name: "Resume Shift" }));
    await screen.findByText(/Welcome back/);
    expect(body("/api/attendance/pin-checkin").photo_base64).toBe("data:image/jpeg;base64,SNAP");
  });

  it("camera failed: says so, and the press still goes through without a photo", async () => {
    cam.status = "failed";
    setup("clocked_in");
    await enterPin();
    expect(screen.getByText(/camera not working/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Clock Out/ }));
    await screen.findByText(/Goodbye, Tahir/);
    expect(body("/api/attendance/pin-checkout").photo_base64).toBeNull();
    expect(screen.getByText(/no photo/i)).toBeTruthy();
  });
});

describe("useKioskCamera (real)", () => {
  let stop, getUserMedia;
  beforeEach(() => {
    stop = vi.fn();
    getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop }] }));
    Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
  });
  afterEach(() => {
    Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
  });

  it("asks for the front camera only while active, and turns it off after", async () => {
    const { result, rerender } = renderHook(({ on }) => realUseKioskCamera(on), { initialProps: { on: false } });
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(result.current.status).toBe("off");
    rerender({ on: true });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(getUserMedia.mock.calls[0][0].video).toMatchObject({ facingMode: "user" });
    rerender({ on: false });
    await waitFor(() => expect(stop).toHaveBeenCalled());
  });

  it("refused or missing camera = failed (never throws)", async () => {
    getUserMedia.mockRejectedValueOnce(new Error("NotAllowedError"));
    const { result } = renderHook(() => realUseKioskCamera(true));
    await waitFor(() => expect(result.current.status).toBe("failed"));
    expect(result.current.snap()).toBeNull();

    Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
    const { result: r2 } = renderHook(() => realUseKioskCamera(true));
    await act(async () => {});
    expect(r2.current.status).toBe("failed");
  });
});
