// One Toy Store pilot D53: after a deploy Railway's edge was slow for minutes
// and the till sat on "Loading session..." (30 Sep, 1 Oct). AuthProvider's
// page start waited on permissions, /api/auth/me and /api/billing/status with
// no time limit. A request that hangs must fall back to the saved session
// (like being offline), not hang the till and not sign the cashier out.
import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { AuthProvider, useAuth, BOOT_TIMEOUT_MS } from "../../src/auth/AuthProvider";
import { AUTH_KEY } from "../../src/auth/authStore";

const SESSION = {
  employee: { id: 7, name: "Cashier", role_id: 3 },
  permissions: ["view_sales_reports"],
  token: "t0k3n",
  tenant_slug: "otsshop",
  loadedAt: Date.now() - 60_000,
};

function Probe() {
  const { isAuthenticated, isBootstrapping, hasPerm } = useAuth();
  if (isBootstrapping) return <p>booting</p>;
  return <p>{isAuthenticated ? `signed in, can sell: ${hasPerm("view_sales_reports")}` : "signed out"}</p>;
}

const hang = () => new Promise(() => {});
const ok = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });

let realFetch;
beforeEach(() => {
  vi.useFakeTimers();
  realFetch = window.fetch;
  localStorage.clear();
  localStorage.setItem(AUTH_KEY, JSON.stringify(SESSION));
});
afterEach(() => {
  vi.useRealTimers();
  window.fetch = realFetch;
  delete window._nativeFetch;
  localStorage.clear();
});

describe("AuthProvider boot with a hung request (D53)", () => {
  it("has a time limit of a few seconds", () => {
    expect(BOOT_TIMEOUT_MS).toBeGreaterThanOrEqual(5000);
    expect(BOOT_TIMEOUT_MS).toBeLessThanOrEqual(10000);
  });

  it("permissions never answer → the saved session is used after the time limit", async () => {
    window.fetch = vi.fn(hang);
    render(<AuthProvider><Probe /></AuthProvider>);
    expect(screen.getByText("booting")).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(BOOT_TIMEOUT_MS + 100); });
    expect(screen.getByText("signed in, can sell: true")).toBeTruthy();
    expect(JSON.parse(localStorage.getItem(AUTH_KEY)).employee.id).toBe(7);
  });

  it("permissions answer but /api/auth/me hangs → the till still opens", async () => {
    window.fetch = vi.fn((url) => {
      const u = String(url);
      if (u.includes("/permissions")) return ok({ permissions: ["view_sales_reports"] });
      if (u.includes("/api/billing/status")) return ok({ payment_status: "active" });
      return hang();
    });
    render(<AuthProvider><Probe /></AuthProvider>);
    await act(async () => { await vi.advanceTimersByTimeAsync(BOOT_TIMEOUT_MS * 3 + 100); });
    expect(screen.getByText("signed in, can sell: true")).toBeTruthy();
  });
});
