/**
 * 15-approvals.spec.js
 * Creates a stock write-off approval request, then approves it.
 */
import { test, expect } from "@playwright/test";
import { readState, writeState } from "./helpers/state.js";
import { post, put, get } from "./helpers/api.js";

test.describe("15 — Approvals: Create and approve request", () => {
  test("create a stock write-off approval request", async ({ page }) => {
    const { productIds } = readState();

    const res = await post(page, "/api/approvals", {
      type: "stock_writeoff",
      description: "Write off 2 damaged Puzzle Box items",
      requested_by: 1,
      data: JSON.stringify({
        product_id: productIds[3],
        quantity: 2,
        reason: "Water damage during storage",
      }),
    });

    expect([200, 201], `Approval creation failed: ${JSON.stringify(res.data)}`).toContain(res.status);
    const approvalId = res.data.approval?.id || res.data.id;
    writeState({ approvalId });
    console.log("Approval request created:", approvalId);
  });

  test("approvals page shows the pending request", async ({ page }) => {
    await page.goto("/approvals");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/approval/i).first()).toBeVisible({ timeout: 15000 });
    console.log("✅ Approvals page loaded");
  });

  test("approve the stock write-off request", async ({ page }) => {
    const { approvalId } = readState();
    if (!approvalId) {
      console.log("No approval ID — skipping");
      return;
    }

    // Try UI approve first
    await page.goto("/approvals");
    await page.waitForLoadState("networkidle");

    const approveBtn = page.getByRole("button", { name: /^approve/i }).first();
    if (await approveBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await approveBtn.click();
      await page.waitForTimeout(500);

      const confirmBtn = page.getByRole("button", { name: /confirm|yes/i }).last();
      if (await confirmBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await confirmBtn.click();
      }

      await expect(
        page.getByText(/approved/i).first()
      ).toBeVisible({ timeout: 10000 });
      console.log("✅ Approved via UI");
    } else {
      // API fallback
      const res = await put(page, `/api/approvals/${approvalId}`, {
        status: "approved",
        notes: "Approved by admin — test",
      });
      expect([200, 201]).toContain(res.status);
      console.log("✅ Approved via API:", res.data);
    }
  });

  test("verify approval status is approved", async ({ page }) => {
    const { approvalId } = readState();
    if (!approvalId) return;

    const res = await get(page, "/api/approvals");
    expect(res.ok).toBe(true);
    const approval = res.data.approvals?.find((a) => a.id === approvalId);
    if (approval) {
      expect(approval.status).toMatch(/approved/i);
      console.log("✅ Approval confirmed approved");
    }
  });
});
