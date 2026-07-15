// Step 14 (D2b) — per-outlet role overrides frontend:
// 1. Pure payload helpers for the employee editor (the PUT is bulk-replace,
//    so the full outlet_roles map must always round-trip).
// 2. AuthProvider.applyEffectiveSession — the context-switch refresh hook
//    that overlays the bootstrap's effective permission set on the session.
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import React, { useEffect } from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import {
  buildOutletRolesMap,
  overridesFromAssignments,
} from "../../src/pages/redesign/employeeOutletRoles";
import { AuthProvider, useAuth } from "../../src/auth/AuthProvider";

describe("employeeOutletRoles helpers", () => {
  it("buildOutletRolesMap emits a key for EVERY assigned outlet (null = inherit)", () => {
    expect(buildOutletRolesMap([1, 2, 3], { 2: 5 })).toEqual({
      1: null,
      2: 5,
      3: null,
    });
  });

  it("buildOutletRolesMap with no overrides still emits the full inherit map", () => {
    expect(buildOutletRolesMap([4, 7], {})).toEqual({ 4: null, 7: null });
    expect(buildOutletRolesMap([4], undefined)).toEqual({ 4: null });
  });

  it("buildOutletRolesMap normalizes select-string values and treats '' as inherit", () => {
    expect(buildOutletRolesMap([1, 2], { 1: "2", 2: "" })).toEqual({
      1: 2,
      2: null,
    });
  });

  it("buildOutletRolesMap ignores overrides for unassigned outlets", () => {
    expect(buildOutletRolesMap([1], { 1: 2, 9: 3 })).toEqual({ 1: 2 });
  });

  it("overridesFromAssignments keeps only explicit overrides", () => {
    const rows = [
      { outlet_id: 1, role_id: null, role_name: null },
      { outlet_id: 2, role_id: 2, role_name: "Manager" },
      { outlet_id: 3, role_id: "3", role_name: "Cashier" },
    ];
    expect(overridesFromAssignments(rows)).toEqual({ 2: 2, 3: 3 });
    expect(overridesFromAssignments([])).toEqual({});
    expect(overridesFromAssignments(undefined)).toEqual({});
  });
});

describe("AuthProvider.applyEffectiveSession", () => {
  const baseSession = {
    employee: { id: 42, name: "Test Cashier", role_id: 3 },
    permissions: ["view_sales_reports"],
    loadedAt: Date.now(),
  };

  let captured;
  function Consumer() {
    const auth = useAuth();
    captured = auth;
    return (
      <div data-testid="perms">{(auth.permissions || []).join(",")}</div>
    );
  }

  beforeEach(() => {
    captured = null;
    localStorage.clear();
    localStorage.setItem("authSession", JSON.stringify(baseSession));
    // Boot path: refreshPermissions (/api/roles/:id/permissions) + /api/auth/me
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        const u = String(url);
        if (u.includes("/api/roles/")) {
          return new Response(
            JSON.stringify({ permissions: ["view_sales_reports"] }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function renderAndBoot() {
    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>,
    );
    await waitFor(() => expect(captured?.isBootstrapping).toBe(false));
    await waitFor(() => expect(captured?.isAuthenticated).toBe(true));
  }

  it("swaps session permissions to the effective set and stamps role identity", async () => {
    await renderAndBoot();
    expect(captured.hasPerm("manage_inventory")).toBe(false);

    await act(async () => {
      captured.applyEffectiveSession({
        id: 42,
        base_role_id: 3,
        effective_role_id: 2,
        effective_role_name: "Manager",
        permissions: ["manage_inventory", "manage_orders"],
      });
    });

    expect(captured.hasPerm("manage_inventory")).toBe(true);
    expect(captured.hasPerm("view_sales_reports")).toBe(false);
    expect(captured.employee.base_role_id).toBe(3);
    expect(captured.employee.effective_role_id).toBe(2);
    expect(captured.employee.effective_role_name).toBe("Manager");
    // JWT-adjacent base identity untouched
    expect(captured.employee.role_id).toBe(3);
    expect(screen.getByTestId("perms").textContent).toBe(
      "manage_inventory,manage_orders",
    );
    // Persisted so a reload within the same context keeps the effective set
    const stored = JSON.parse(localStorage.getItem("authSession"));
    expect(stored.permissions).toEqual(["manage_inventory", "manage_orders"]);
  });

  it("is a no-op without a permissions array or for a different employee", async () => {
    await renderAndBoot();
    const before = captured.permissions;

    await act(async () => {
      captured.applyEffectiveSession({ id: 42 }); // no permissions array
      captured.applyEffectiveSession(null);
      captured.applyEffectiveSession({ id: 99, permissions: ["all_access"] }); // wrong employee
    });

    expect(captured.permissions).toEqual(before);
    expect(captured.hasPerm("all_access")).toBe(false);
  });

  it("reverting to the base set on a switch back works (no stale grant)", async () => {
    await renderAndBoot();
    await act(async () => {
      captured.applyEffectiveSession({
        id: 42,
        base_role_id: 3,
        effective_role_id: 2,
        effective_role_name: "Manager",
        permissions: ["manage_inventory"],
      });
    });
    expect(captured.hasPerm("manage_inventory")).toBe(true);

    // Switching to an outlet with no override — bootstrap sends base perms
    await act(async () => {
      captured.applyEffectiveSession({
        id: 42,
        base_role_id: 3,
        effective_role_id: 3,
        effective_role_name: "Cashier",
        permissions: ["view_sales_reports"],
      });
    });
    expect(captured.hasPerm("manage_inventory")).toBe(false);
    expect(captured.hasPerm("view_sales_reports")).toBe(true);
    expect(captured.employee.effective_role_id).toBe(3);
  });
});
