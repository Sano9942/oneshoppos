import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import RequireAuth from "../../src/components/RequireAuth";
import RequirePerm from "../../src/components/RequirePerm";
import { useAuth } from "../../src/auth/AuthProvider";

// Mock useAuth
vi.mock("../../src/auth/AuthProvider", () => ({
  useAuth: vi.fn(),
}));

describe("Auth Guards", () => {
  describe("RequireAuth", () => {
    it("should show loading state while bootstrapping", () => {
      useAuth.mockReturnValue({
        isAuthenticated: false,
        isBootstrapping: true,
      });

      render(
        <MemoryRouter>
          <RequireAuth>
            <div data-testid="protected">Protected Content</div>
          </RequireAuth>
        </MemoryRouter>,
      );

      expect(screen.getByText(/loading session/i)).toBeInTheDocument();
      expect(screen.queryByTestId("protected")).not.toBeInTheDocument();
    });

    it("should render children when authenticated", () => {
      useAuth.mockReturnValue({
        isAuthenticated: true,
        isBootstrapping: false,
      });

      render(
        <MemoryRouter>
          <RequireAuth>
            <div data-testid="protected">Protected Content</div>
          </RequireAuth>
        </MemoryRouter>,
      );

      expect(screen.getByTestId("protected")).toBeInTheDocument();
    });

    it("should redirect to login when not authenticated", () => {
      useAuth.mockReturnValue({
        isAuthenticated: false,
        isBootstrapping: false,
      });

      render(
        <MemoryRouter initialEntries={["/admin"]}>
          <Routes>
            <Route
              path="/admin"
              element={
                <RequireAuth>
                  <div data-testid="protected">Protected</div>
                </RequireAuth>
              }
            />
            <Route
              path="/login"
              element={<div data-testid="login">Login Page</div>}
            />
          </Routes>
        </MemoryRouter>,
      );

      expect(screen.getByTestId("login")).toBeInTheDocument();
      expect(screen.queryByTestId("protected")).not.toBeInTheDocument();
    });
  });

  describe("RequirePerm", () => {
    it("should render children if user has permission", () => {
      useAuth.mockReturnValue({
        hasPerm: (p) => p === "manage_inventory",
      });

      render(
        <MemoryRouter>
          <RequirePerm perm="manage_inventory">
            <div data-testid="secret">Sensitive Info</div>
          </RequirePerm>
        </MemoryRouter>,
      );

      expect(screen.getByTestId("secret")).toBeInTheDocument();
    });

    it("should redirect to access-denied if user lacks permission", () => {
      useAuth.mockReturnValue({
        hasPerm: () => false,
      });

      render(
        <MemoryRouter initialEntries={["/restricted"]}>
          <Routes>
            <Route
              path="/restricted"
              element={
                <RequirePerm perm="view_reports">
                  <div data-testid="secret">Sensitive</div>
                </RequirePerm>
              }
            />
            <Route
              path="/access-denied"
              element={<div data-testid="denied">No Access</div>}
            />
          </Routes>
        </MemoryRouter>,
      );

      expect(screen.getByTestId("denied")).toBeInTheDocument();
      expect(screen.queryByTestId("secret")).not.toBeInTheDocument();
    });
  });
});
