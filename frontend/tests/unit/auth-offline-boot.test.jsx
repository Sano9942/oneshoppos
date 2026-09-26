// One Toy Store pilot, blocker 3b: reloading the POS while the internet is down
// must not sign the cashier out. Before the fix, AuthProvider's boot refresh of
// the role permissions threw on the network error and the catch cleared the
// session — and signing back in needs the server.
import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { AuthProvider, useAuth } from "../../src/auth/AuthProvider";
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

let realFetch;
beforeEach(() => {
  realFetch = window.fetch;
  localStorage.clear();
  localStorage.setItem(AUTH_KEY, JSON.stringify(SESSION));
});
afterEach(() => { window.fetch = realFetch; localStorage.clear(); });

describe("AuthProvider boot with the internet down", () => {
  it("keeps the cashier signed in with the permissions they had", async () => {
    window.fetch = vi.fn(() => Promise.reject(new TypeError("Failed to fetch")));
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.queryByText("booting")).toBeNull());
    expect(screen.getByText("signed in, can sell: true")).toBeTruthy();
    expect(JSON.parse(localStorage.getItem(AUTH_KEY)).employee.id).toBe(7);
  });

  it("still signs out when the server says the session is no good", async () => {
    window.fetch = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({ error: "Session expired" }) }));
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByText("signed out")).toBeTruthy());
    expect(localStorage.getItem(AUTH_KEY)).toBeNull();
  });
});
