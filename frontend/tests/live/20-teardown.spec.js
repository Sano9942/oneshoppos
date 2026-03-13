/**
 * 20-teardown.spec.js
 * Archives (soft-deletes) all test data created during the simulation:
 * 5 toy products, 2 customers, cashier employee Asad.
 * Sales, returns, POs, GRNs stay (audit trail — cannot delete by design).
 */
import { test, expect } from "@playwright/test";
import { readState } from "./helpers/state.js";
import { del, put } from "./helpers/api.js";

test.describe("20 — Teardown: Archive test data", () => {
  test("archive all 5 toy products", async ({ page }) => {
    const { productIds } = readState();
    expect(productIds?.length).toBe(5);

    for (const id of productIds) {
      const res = await del(page, `/api/products/${id}`);
      expect(
        [200, 204],
        `Failed to archive product ${id}: ${JSON.stringify(res.data)}`
      ).toContain(res.status);
      console.log(`Archived product ${id}`);
    }

    console.log("✅ All 5 toy products archived");
  });

  test("archive test customers (Ali Khan + Sara Malik)", async ({ page }) => {
    const { customerAliId, customerSaraId } = readState();

    for (const id of [customerAliId, customerSaraId]) {
      if (!id) continue;
      const res = await del(page, `/api/customers/${id}`);
      expect([200, 204]).toContain(res.status);
      console.log(`Archived customer ${id}`);
    }

    console.log("✅ Test customers archived");
  });

  test("archive cashier employee Asad", async ({ page }) => {
    const { employeeAsadId } = readState();
    if (!employeeAsadId) return;

    const res = await del(page, `/api/employees/${employeeAsadId}`);
    expect([200, 204]).toContain(res.status);
    console.log("✅ Asad archived");
  });

  test("archive test brand and supplier", async ({ page }) => {
    const { brandId, supplierId } = readState();

    if (brandId) {
      const res = await del(page, `/api/brands/${brandId}`);
      console.log("Brand archive:", res.status);
    }

    if (supplierId) {
      const res = await del(page, `/api/suppliers/${supplierId}`);
      console.log("Supplier archive:", res.status);
    }
  });

  test("archive test promotion", async ({ page }) => {
    const { promoId } = readState();
    if (!promoId) return;

    const res = await del(page, `/api/promotions/${promoId}`);
    console.log("Promotion archive:", res.status);
  });

  test("print final state summary", async ({ page }) => {
    const state = readState();
    console.log("\n========== TEST RUN COMPLETE ==========");
    console.log("Products archived:", state.productIds?.length ?? 0);
    console.log("Sales created:", [
      state.cashSaleId,
      state.customerSaleId,
      state.walletSaleId,
      state.discountSaleId,
      state.quoteSaleId,
    ].filter(Boolean).length);
    console.log("Returns created:", [state.returnId, state.exchangeReturnId].filter(Boolean).length);
    console.log("PO created:", state.poId);
    console.log("GRN received:", state.grnId);
    console.log("CRM lead:", state.crmLeadId);
    console.log("Leave request:", state.leaveId);
    console.log("Approval:", state.approvalId);
    console.log("Shift closed:", state.openShiftId);
    console.log("=======================================\n");
    console.log("⚠️  Remember to open a new shift in Cash Management before using POS again.");
  });
});
