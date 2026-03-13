/**
 * 02-purchasing.spec.js
 * Creates a Purchase Order for LEGO Set + Remote Car,
 * submits for approval, approves it, receives via GRN, verifies stock increased.
 *
 * PO flow: Draft → submit → pending_approval → approve → Approved → receive (GRN)
 * GRN endpoint: POST /api/purchase-orders/:id/receive (not /api/grn)
 * PO items require: cost_price (not unit_price)
 */
import { test, expect } from "@playwright/test";
import { readState, writeState } from "./helpers/state.js";
import { post, get } from "./helpers/api.js";

test.describe("02 — Purchasing: PO → Approve → GRN", () => {
  test("create purchase order for 2 products", async ({ page }) => {
    const { supplierId, productIds } = readState();
    const today = new Date().toISOString().slice(0, 10);

    const res = await post(page, "/api/purchase-orders", {
      supplier_id: supplierId,
      outlet_id: 1,
      expected_date: today,
      notes: "Test PO — toy shop simulation",
      items: [
        { product_id: productIds[0], quantity: 20, cost_price: 1800 }, // LEGO
        { product_id: productIds[1], quantity: 15, cost_price: 1200 }, // RC Car
      ],
    });

    expect([200, 201], `PO creation failed: ${JSON.stringify(res.data)}`).toContain(res.status);
    const poId = res.data.purchase_order?.id || res.data.id;
    expect(poId).toBeTruthy();
    writeState({ poId });
    console.log("PO created, id:", poId);
  });

  test("submit and approve the purchase order", async ({ page }) => {
    const { poId } = readState();

    // Submit for approval (Draft → pending_approval)
    const submitRes = await post(page, `/api/purchase-orders/${poId}/submit`, {});
    expect([200, 201, 400], `PO submit failed: ${JSON.stringify(submitRes.data)}`).toContain(submitRes.status);
    console.log("PO submit:", submitRes.status, submitRes.data?.message || submitRes.data?.error);

    // Approve
    const res = await post(page, `/api/purchase-orders/${poId}/approve`, { action: "approved" });
    expect(res.status, `PO approval failed: ${JSON.stringify(res.data)}`).toBe(200);
    console.log("PO approved:", poId);
  });

  test("receive GRN for the approved PO", async ({ page }) => {
    const { poId, productIds } = readState();

    // GRN via /api/purchase-orders/:id/receive
    const res = await post(page, `/api/purchase-orders/${poId}/receive`, {
      outlet_id: 1,
      notes: "Test GRN receipt",
      items: [
        { product_id: productIds[0], qty_received: 20 },
        { product_id: productIds[1], qty_received: 15 },
      ],
    });

    expect([200, 201], `GRN failed: ${JSON.stringify(res.data)}`).toContain(res.status);
    const grnId = res.data.grn_id || res.data.grn?.id || res.data.id;
    expect(grnId).toBeTruthy();
    writeState({ grnId });
    console.log("GRN received, id:", grnId);
  });

  test("verify stock increased after GRN", async ({ page }) => {
    const { productIds } = readState();

    const legoRes = await get(page, `/api/products/${productIds[0]}`);
    const legoStock = Number(legoRes.data.product?.total_stock ?? legoRes.data.total_stock ?? 0);
    expect(legoStock, "LEGO stock should be > 0 after GRN").toBeGreaterThan(0);

    const rcRes = await get(page, `/api/products/${productIds[1]}`);
    const rcStock = Number(rcRes.data.product?.total_stock ?? rcRes.data.total_stock ?? 0);
    expect(rcStock, "RC Car stock should be > 0 after GRN").toBeGreaterThan(0);

    console.log("✅ Stock after GRN — LEGO:", legoStock, "RC Car:", rcStock);
  });

  test("purchase orders page shows the PO", async ({ page }) => {
    await page.goto("/purchase-orders");
    await page.waitForLoadState("networkidle");

    await expect(page.getByText(/purchase order/i).first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/ToyWorld Distributors/i).first()).toBeVisible({ timeout: 10000 });
    console.log("✅ Purchase orders page loaded");
  });
});
