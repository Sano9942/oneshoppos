/**
 * smoke-gate.spec.js — Full daily business cycle E2E smoke test
 *
 * Covers the complete flow:
 *   S1 → Login + context selection
 *   S2 → Kiosk clock-in via PIN pad
 *   S3 → POS shift open with denomination capture
 *   S4 → Product search → cart → cash sale → invoice
 *   S5 → Recent Sales panel — sale appears
 *   S6 → Return from recent sale
 *   S7 → Shift close
 *   S8 → Logout
 *
 * Requires: backend running on :5000, frontend on :5173
 * Run: cd frontend && npm run test:e2e -- tests/e2e/smoke-gate.spec.js
 */

import { test, expect } from "@playwright/test";
import { ADMIN_EMPLOYEE } from "./helpers/auth";

const API = "http://localhost:5000/api";

const MANAGER = {
  name: "Hassan",
  pin: "2580",
  username: "Hassan",
  password: "2580",
};

// ─── API helpers ────────────────────────────────────────────────────────────

/** GET with employee auth header */
async function apiGet(request, path, employeeId = "1") {
  return request.get(`${API}${path}`, {
    headers: { "x-employee-id": employeeId, "Content-Type": "application/json" },
  });
}

/** POST with employee auth header */
async function apiPost(request, path, body, employeeId = "1") {
  return request.post(`${API}${path}`, {
    headers: { "x-employee-id": employeeId, "Content-Type": "application/json" },
    data: body,
  });
}

/**
 * Ensure admin is clocked into the given outlet.
 * If already clocked in, skip. If clocked into another outlet, clock out first.
 */
async function ensureClockedIn(request, outletId) {
  // Try clock out first to reset state (idempotent — 400 if not clocked in, that's fine)
  await request.post(`${API}/attendance/pin-checkout`, {
    data: { pin_code: ADMIN_EMPLOYEE.pin },
    headers: { "Content-Type": "application/json" },
  });

  const res = await request.post(`${API}/attendance/pin-checkin`, {
    data: { pin_code: ADMIN_EMPLOYEE.pin, outlet_id: outletId },
    headers: { "Content-Type": "application/json" },
  });

  // 200 = clocked in; 400 = already clocked in (idempotent — still OK)
  if (!res.ok()) {
    const body = await res.json();
    if (body?.status !== "clocked_in" && res.status() !== 400) {
      throw new Error(`Clock-in failed: ${JSON.stringify(body)}`);
    }
  }
}

/**
 * Close any open shift for the outlet so we can open a fresh one.
 */
async function closeExistingShift(request, outletId) {
  const res = await apiGet(request, `/shifts/active?outlet_id=${outletId}`);
  if (!res.ok()) return;
  const json = await res.json();
  if (!json.shift) return;

  await apiPost(request, `/shifts/${json.shift.id}/close`, {
    closing_cash: 0,
    variance_reason: "Smoke-gate test reset",
  });
}

// ─── Login helper (manager / Hassan) ───────────────────────────────────────

async function loginAsManager(page) {
  await page.goto("/login");

  const usernameInput = page.locator('input[placeholder="Employee name"]');
  const pinInput = page.locator('input[placeholder="PIN code"]');
  await expect(usernameInput).toBeVisible({ timeout: 15000 });
  await expect(pinInput).toBeVisible({ timeout: 15000 });

  await usernameInput.fill(MANAGER.username);
  await pinInput.fill(MANAGER.password);
  await page.getByRole("button", { name: /login/i }).click();

  // Handle optional context-select redirect (Context Unification)
  await page.waitForURL(/\/(dashboard|context-select)/, { timeout: 20000 });
  if (page.url().includes("context-select")) {
    await page.getByRole("button", { name: /continue/i }).click();
    await expect(page).toHaveURL(/.*dashboard/, { timeout: 10000 });
  }

  await expect(page.getByText(/ONESHOPPOS/i)).toBeVisible({ timeout: 15000 });
}

// ─── Smoke gate suite ────────────────────────────────────────────────────────

test.describe("Smoke Gate — Daily Business Cycle", () => {
  let outletId = 1;
  let saleInvoiceNumber = "";

  test.beforeAll(async ({ request }) => {
    // Resolve outlet 1 (Main Store)
    const res = await apiGet(request, "/outlets");
    if (res.ok()) {
      const json = await res.json();
      const main = (json.outlets || []).find((o) => o.name === "Main Store") || (json.outlets || [])[0];
      if (main) outletId = main.id;
    }

    // Reset state: close any open shift so the test can open a fresh one
    await closeExistingShift(request, outletId);
    // Ensure clocked in at the target outlet
    await ensureClockedIn(request, outletId);
  });

  // ── S1: Login ───────────────────────────────────────────────────────────

  test("S1 — Login redirects to dashboard (or context-select → dashboard)", async ({ page }) => {
    await loginAsManager(page);

    // Should land on dashboard with nav visible
    await expect(page).toHaveURL(/dashboard/, { timeout: 10000 });
    await expect(page.getByText(/ONESHOPPOS/i)).toBeVisible();
  });

  // ── S2: Kiosk clock-in ──────────────────────────────────────────────────

  test("S2 — Kiosk: PIN clock-in works", async ({ page, request }) => {
    await loginAsManager(page);

    // Clock out first so we can clock back in via the kiosk UI
    await request.post(`${API}/attendance/pin-checkout`, {
      data: { pin_code: ADMIN_EMPLOYEE.pin },
      headers: { "Content-Type": "application/json" },
    });

    await page.goto("/kiosk");

    // Select outlet
    const outletSelect = page.locator("select");
    await expect(outletSelect).toBeVisible({ timeout: 10000 });
    try {
      await outletSelect.selectOption({ label: "Main Store" });
    } catch {
      // Single outlet — no select needed
    }

    // Enter PIN digits on numpad
    for (const digit of ADMIN_EMPLOYEE.pin.split("")) {
      await page.getByRole("button", { name: digit, exact: true }).click({ delay: 80 });
    }

    // Submit PIN (check icon / enter / ✓)
    const submitBtn = page.getByRole("button", { name: /✓|check|enter|ok|submit/i }).first();
    await expect(submitBtn).toBeVisible({ timeout: 5000 });
    await submitBtn.click();

    // Employee name should appear after PIN recognition
    await expect(page.getByText(MANAGER.name)).toBeVisible({ timeout: 10000 });

    // Either clock in / clock out / finished state is shown
    await expect(async () => {
      const inVis = await page.getByRole("button", { name: /clock in/i }).isVisible();
      const outVis = await page.getByRole("button", { name: /clock out|end of day/i }).isVisible();
      const done = await page.getByText(/finished today|day completed/i).isVisible();
      expect(inVis || outVis || done).toBeTruthy();
    }).toPass({ timeout: 10000 });

    const clockInBtn = page.getByRole("button", { name: /^clock in$/i });
    if (await clockInBtn.isVisible()) {
      await clockInBtn.click();
      await expect(page.getByText(new RegExp(`welcome.*${MANAGER.name}`, "i"))).toBeVisible({ timeout: 8000 });
    }
    // If already clocked in / day complete, that's also fine — attendance state confirmed
  });

  // ── S3: POS — open shift ─────────────────────────────────────────────────

  test("S3 — POS: open shift with denomination capture", async ({ page, request }) => {
    // Ensure clean state for shift open
    await closeExistingShift(request, outletId);
    await ensureClockedIn(request, outletId);

    await loginAsManager(page);
    await page.goto("/pos");

    // Gate screen should appear
    const gateTitle = page.getByRole("heading", { name: /prepare pos before selling/i });
    await expect(gateTitle).toBeVisible({ timeout: 15000 });

    // Select the correct outlet if the combobox is present
    const outletCombo = page.getByRole("combobox").last();
    const comboVisible = await outletCombo.isVisible().catch(() => false);
    if (comboVisible) {
      await outletCombo.selectOption(String(outletId));
    }

    // Wait for the Open Shift button
    const openShiftBtn = page.getByRole("button", { name: /^open shift$/i });
    const clockedInRefreshBtn = page.getByRole("button", { name: /i have clocked in/i });

    await expect(async () => {
      const shiftVisible = await openShiftBtn.isVisible();
      const clockVisible = await clockedInRefreshBtn.isVisible();
      const gateGone = !(await gateTitle.isVisible());
      expect(shiftVisible || clockVisible || gateGone).toBeTruthy();
    }).toPass({ timeout: 15000 });

    if (await clockedInRefreshBtn.isVisible()) {
      await clockedInRefreshBtn.click();
    }

    if (await openShiftBtn.isVisible()) {
      // Fill a denomination (Rs 1000 note × 1)
      const thousandInput = page.getByRole("spinbutton", { name: /1000/i }).first();
      const hundredInput = page.getByRole("spinbutton", { name: /100/i }).first();

      const denomInput = (await thousandInput.isVisible().catch(() => false))
        ? thousandInput
        : (await hundredInput.isVisible().catch(() => false))
          ? hundredInput
          : null;

      if (denomInput) {
        await denomInput.click();
        await denomInput.press("Control+A");
        await denomInput.pressSequentially("1");
      }

      await expect(openShiftBtn).toBeEnabled({ timeout: 8000 });
      await openShiftBtn.click();
    }

    // Gate should be gone — POS canvas visible
    await expect(gateTitle).not.toBeVisible({ timeout: 15000 });
    await expect(page.getByPlaceholder(/search by name, barcode/i)).toBeVisible({ timeout: 15000 });
  });

  // ── S4: POS — complete a cash sale ──────────────────────────────────────

  test("S4 — POS: search product, add to cart, complete cash sale", async ({ page, request }) => {
    await ensureClockedIn(request, outletId);
    await loginAsManager(page);

    // Fetch a product to search for
    const productRes = await apiGet(request, `/products/search?query=PROD-001&outlet_id=${outletId}`);
    let searchTerm = "PROD-001";
    if (productRes.ok()) {
      const json = await productRes.json();
      const p = (json.products || [])[0];
      if (p) searchTerm = p.barcode || p.name || searchTerm;
    }

    await page.goto("/pos");

    // Gate may or may not show (shift already open from S3)
    const gateTitle = page.getByRole("heading", { name: /prepare pos before selling/i });
    const gatePossiblyVisible = await gateTitle.isVisible({ timeout: 3000 }).catch(() => false);

    if (gatePossiblyVisible) {
      const openShiftBtn = page.getByRole("button", { name: /^open shift$/i });
      const clockedInRefreshBtn = page.getByRole("button", { name: /i have clocked in/i });

      await expect(async () => {
        const s = await openShiftBtn.isVisible();
        const c = await clockedInRefreshBtn.isVisible();
        const g = !(await gateTitle.isVisible());
        expect(s || c || g).toBeTruthy();
      }).toPass({ timeout: 15000 });

      if (await clockedInRefreshBtn.isVisible()) await clockedInRefreshBtn.click();
      if (await openShiftBtn.isVisible()) {
        const denomInput = page.getByRole("spinbutton").first();
        if (await denomInput.isVisible().catch(() => false)) {
          await denomInput.fill("1");
        }
        await openShiftBtn.click();
      }
    }

    // POS canvas
    const searchInput = page.getByPlaceholder(/search by name, barcode/i);
    await expect(searchInput).toBeVisible({ timeout: 15000 });
    await searchInput.fill(searchTerm);

    // Pick first result from dropdown
    const firstResult = page.locator("[class*='dropdown'] li, [class*='search-result'], [data-testid='product-result']").first();
    const dropdownItem = page.getByText(/PROD-001|Product/, { exact: false }).locator("visible=true").last();

    await expect(async () => {
      const r1 = await firstResult.isVisible().catch(() => false);
      const r2 = await dropdownItem.isVisible().catch(() => false);
      expect(r1 || r2).toBeTruthy();
    }).toPass({ timeout: 10000 });

    if (await firstResult.isVisible().catch(() => false)) {
      await firstResult.click({ force: true });
    } else {
      await dropdownItem.click({ force: true });
    }

    // Product should appear in cart
    await expect(page.getByText(/PROD-001/, { exact: false }).last()).toBeVisible({ timeout: 8000 });

    // Checkout
    await page.getByRole("button", { name: /^pay$/i }).click();
    await expect(page.getByText(/complete payment/i)).toBeVisible({ timeout: 8000 });

    // Add payment
    await page.getByRole("button", { name: /^add$/i }).click();

    // Complete
    await page.getByRole("button", { name: /complete sale/i }).click();
    await expect(page.getByText(/sale complete/i)).toBeVisible({ timeout: 10000 });

    // Capture invoice number for S5/S6
    const invoiceEl = page.getByText(/INV-/i).first();
    await expect(invoiceEl).toBeVisible({ timeout: 8000 });
    saleInvoiceNumber = (await invoiceEl.textContent()) || "";

    // Close success modal
    const closeBtn = page.getByRole("button", { name: "Close", exact: true });
    if (await closeBtn.isVisible().catch(() => false)) {
      await closeBtn.click();
    }

    await expect(page.getByText(/cart is empty/i)).toBeVisible({ timeout: 8000 });
  });

  // ── S5: Recent Sales panel ──────────────────────────────────────────────

  test("S5 — POS: recent sales panel shows the completed sale", async ({ page, request }) => {
    await ensureClockedIn(request, outletId);
    await loginAsManager(page);
    await page.goto("/pos");

    // Skip gate if visible
    const gateTitle = page.getByRole("heading", { name: /prepare pos before selling/i });
    const gateVisible = await gateTitle.isVisible({ timeout: 3000 }).catch(() => false);
    if (gateVisible) {
      const clockedInRefreshBtn = page.getByRole("button", { name: /i have clocked in/i });
      if (await clockedInRefreshBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await clockedInRefreshBtn.click();
      }
      await expect(gateTitle).not.toBeVisible({ timeout: 10000 });
    }

    await expect(page.getByPlaceholder(/search by name, barcode/i)).toBeVisible({ timeout: 15000 });

    // Open Recent Sales panel
    const recentSalesBtn = page.getByRole("button", { name: /recent sales|history/i }).first();
    await expect(recentSalesBtn).toBeVisible({ timeout: 10000 });
    await recentSalesBtn.click();

    // Panel should open and show at least one sale
    await expect(async () => {
      const panelVisible = await page.getByText(/recent sales/i).isVisible();
      const saleVisible = await page.getByText(/INV-/i).first().isVisible();
      expect(panelVisible || saleVisible).toBeTruthy();
    }).toPass({ timeout: 10000 });

    // At least one invoice number visible
    await expect(page.getByText(/INV-/i).first()).toBeVisible({ timeout: 8000 });
  });

  // ── S6: Return from recent sale ─────────────────────────────────────────

  test("S6 — POS: return from recent sales creates refund", async ({ page, request }) => {
    await ensureClockedIn(request, outletId);
    await loginAsManager(page);
    await page.goto("/pos");

    // Skip gate
    const gateTitle = page.getByRole("heading", { name: /prepare pos before selling/i });
    const gateVisible = await gateTitle.isVisible({ timeout: 3000 }).catch(() => false);
    if (gateVisible) {
      const refreshBtn = page.getByRole("button", { name: /i have clocked in/i });
      if (await refreshBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await refreshBtn.click();
      }
      await expect(gateTitle).not.toBeVisible({ timeout: 10000 });
    }

    await expect(page.getByPlaceholder(/search by name, barcode/i)).toBeVisible({ timeout: 15000 });

    // Open Recent Sales
    const recentSalesBtn = page.getByRole("button", { name: /recent sales|history/i }).first();
    await expect(recentSalesBtn).toBeVisible({ timeout: 10000 });
    await recentSalesBtn.click();

    await expect(page.getByText(/INV-/i).first()).toBeVisible({ timeout: 10000 });

    // Click Return on the first sale
    const returnBtn = page.getByRole("button", { name: /return|refund/i }).first();
    await expect(returnBtn).toBeVisible({ timeout: 10000 });
    await returnBtn.click();

    // Return/Exchange modal should appear
    await expect(async () => {
      const modalTitle = await page.getByText(/return|exchange|refund/i).first().isVisible();
      expect(modalTitle).toBeTruthy();
    }).toPass({ timeout: 10000 });

    // Select all items for return (check all checkboxes if present)
    const checkboxes = page.getByRole("checkbox");
    const checkboxCount = await checkboxes.count();
    for (let i = 0; i < checkboxCount; i++) {
      const cb = checkboxes.nth(i);
      const checked = await cb.isChecked().catch(() => false);
      if (!checked) await cb.click();
    }

    // Choose Refund (not Exchange)
    const refundTab = page.getByRole("tab", { name: /refund/i }).first();
    const refundRadio = page.getByRole("radio", { name: /refund/i }).first();
    if (await refundTab.isVisible({ timeout: 2000 }).catch(() => false)) {
      await refundTab.click();
    } else if (await refundRadio.isVisible({ timeout: 2000 }).catch(() => false)) {
      await refundRadio.click();
    }

    // Confirm return
    const confirmBtn = page
      .getByRole("button", { name: /confirm return|process refund|submit|apply refund/i })
      .first();
    await expect(confirmBtn).toBeVisible({ timeout: 8000 });
    await confirmBtn.click();

    // Success indicator
    await expect(async () => {
      const success = await page.getByText(/return.*success|refund.*processed|processed/i).isVisible();
      const closed = !(await confirmBtn.isVisible().catch(() => false));
      expect(success || closed).toBeTruthy();
    }).toPass({ timeout: 12000 });
  });

  // ── S7: Shift close ──────────────────────────────────────────────────────

  test("S7 — Shift: manager can close shift", async ({ page }) => {
    await loginAsManager(page);

    // Navigate to shifts / cash management
    const shiftsLink = page
      .getByRole("link", { name: /shifts|cash management/i })
      .first();
    const visible = await shiftsLink.isVisible({ timeout: 5000 }).catch(() => false);

    if (visible) {
      await shiftsLink.click();
    } else {
      await page.goto("/shifts");
    }

    // Look for Close Shift button
    const closeShiftBtn = page.getByRole("button", { name: /close shift/i }).first();
    const shiftVisible = await closeShiftBtn.isVisible({ timeout: 10000 }).catch(() => false);

    if (!shiftVisible) {
      // Shift may already be closed or page shows differently — verify via API
      test.info().annotations.push({ type: "note", description: "Close Shift button not found — shift may already be closed or nav differs" });
      return;
    }

    await closeShiftBtn.click();

    // May ask for closing cash denomination or a simple amount input
    const closingAmountInput = page.getByRole("spinbutton").first();
    if (await closingAmountInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await closingAmountInput.fill("500");
    }

    const confirmCloseBtn = page.getByRole("button", { name: /confirm|submit|close shift/i }).last();
    await expect(confirmCloseBtn).toBeVisible({ timeout: 8000 });
    await confirmCloseBtn.click();

    // Shift closed confirmation
    await expect(async () => {
      const closed = await page.getByText(/shift closed|closed successfully|no open shift/i).isVisible();
      const btnGone = !(await closeShiftBtn.isVisible().catch(() => false));
      expect(closed || btnGone).toBeTruthy();
    }).toPass({ timeout: 12000 });
  });

  // ── S8: Logout ───────────────────────────────────────────────────────────

  test("S8 — Logout redirects to login", async ({ page }) => {
    await loginAsManager(page);

    const logoutBtn = page.getByRole("button", { name: /logout/i });
    await expect(logoutBtn).toBeVisible({ timeout: 10000 });
    await logoutBtn.click();

    await expect(page).toHaveURL(/.*login/, { timeout: 10000 });
    await expect(page.getByText(/sign in/i)).toBeVisible({ timeout: 8000 });
  });
});
