import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { adminFetch } from "../../src/pages/admin/AdminLogin";
import AdminSupportTickets from "../../src/pages/admin/AdminSupportTickets";

vi.mock("../../src/pages/admin/AdminLogin", () => ({
  adminFetch: vi.fn(),
}));

describe("AdminSupportTickets — screenshot rendering (P26 regression)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders screenshot thumbnails using the URL string from {filename, url} objects", async () => {
    const ticket = {
      id: 42,
      tenant_id: 1,
      tenant_name: "Live Test 1",
      tenant_slug: "livetest1",
      type: "bug",
      message: "Phase 7.8 walkthrough — testing support widget end-to-end.",
      status: "open",
      created_at: "2026-04-30T17:29:31Z",
      page_url: "/dashboard",
      browser: "Mozilla/5.0",
      employee_id: 1,
      screenshots: [
        {
          filename: "phase7-8-step1.png",
          url: "https://api.sanopos.com/r2/support/abc123.png",
        },
      ],
    };

    adminFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ tickets: [ticket] }),
    });

    render(<AdminSupportTickets />);

    // Wait for ticket row to appear, then expand it to reveal screenshots
    await waitFor(() => {
      expect(screen.getByText(/Phase 7\.8 walkthrough/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText(/Phase 7\.8 walkthrough/));

    await waitFor(() => {
      expect(screen.getByText("Screenshots:")).toBeInTheDocument();
    });

    const img = screen.getByRole("img", { name: /Screenshot 1/i });
    expect(img.getAttribute("src")).toBe(
      "https://api.sanopos.com/r2/support/abc123.png",
    );
    // Must NOT serialize the object — that would render as "[object Object]"
    expect(img.getAttribute("src")).not.toMatch(/\[object Object\]/);
  });
});
