import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { PageShell } from "../../src/ui/primitives";
import NotificationBell from "../../src/components/NotificationBell";
import { useAuth } from "../../src/auth/AuthProvider";

// Mock useAuth
vi.mock("../../src/auth/AuthProvider", () => ({
  useAuth: vi.fn(),
}));

// Mock global fetch
global.fetch = vi.fn();

describe("Layout Components", () => {
  describe("PageShell", () => {
    it("should render title and subtitle", () => {
      render(
        <PageShell title="Dashboard" subtitle="Overview of your shop">
          <div data-testid="content">Main Content</div>
        </PageShell>,
      );

      expect(screen.getByText("Dashboard")).toBeInTheDocument();
      expect(screen.getByText("Overview of your shop")).toBeInTheDocument();
      expect(screen.getByTestId("content")).toBeInTheDocument();
    });

    it("should render right-side content", () => {
      render(
        <PageShell title="Test" right={<button>Action</button>}>
          <div>Content</div>
        </PageShell>,
      );
      expect(
        screen.getByRole("button", { name: /action/i }),
      ).toBeInTheDocument();
    });
  });

  describe("NotificationBell", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      useAuth.mockReturnValue({
        authHeaders: () => ({ Authorization: "Bearer test" }),
      });
    });

    it("should show unread count badge", async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ unread: 5 }),
      });

      render(
        <MemoryRouter>
          <NotificationBell />
        </MemoryRouter>,
      );

      await waitFor(() => {
        expect(screen.getByText("5")).toBeInTheDocument();
      });
    });

    it("should open dropdown and show notifications", async () => {
      // 1. Initial count
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ unread: 1 }),
      });
      // 2. Fetch notifications on open
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          notifications: [
            {
              id: 1,
              title: "Low Stock",
              message: "Item X is low",
              type: "low_stock",
              is_read: 0,
            },
          ],
        }),
      });

      render(
        <MemoryRouter>
          <NotificationBell />
        </MemoryRouter>,
      );

      const bell = screen.getByRole("button", { title: /notifications/i });
      fireEvent.click(bell);

      await waitFor(() => {
        expect(screen.getByText("Low Stock")).toBeInTheDocument();
        expect(screen.getByText("Item X is low")).toBeInTheDocument();
      });
    });

    it('should show "No notifications" when empty', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ unread: 0 }),
      });
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ notifications: [] }),
      });

      render(
        <MemoryRouter>
          <NotificationBell />
        </MemoryRouter>,
      );

      fireEvent.click(screen.getByRole("button", { title: /notifications/i }));

      await waitFor(() => {
        expect(screen.getByText(/no notifications/i)).toBeInTheDocument();
      });
    });
  });
});
