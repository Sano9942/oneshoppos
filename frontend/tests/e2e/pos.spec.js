import { test, expect } from "@playwright/test";
import { ADMIN_EMPLOYEE, ADMIN_HEADERS, loginAsAdmin } from "./helpers/auth";

const API = "http://localhost:5000/api";

async function prepareAdminForPOS(request, outlet) {
  await request.post(`${API}/attendance/pin-checkout`, {
    data: { pin_code: ADMIN_EMPLOYEE.pin, break_reason: null },
  });

  const checkinRes = await request.post(`${API}/attendance/pin-checkin`, {
    data: { pin_code: ADMIN_EMPLOYEE.pin, outlet_id: outlet.id },
  });

  if (!checkinRes.ok()) {
    const payload = await checkinRes.json();
    if (payload?.status !== "clocked_in") {
      throw new Error(payload?.error || "Failed to clock admin into kiosk");
    }
  }
}

test.describe("POS Checkout Flow", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test("should complete a cash sale successfully", async ({ page, request }) => {
    const outletsRes = await request.get(`${API}/outlets`, {
      headers: ADMIN_HEADERS,
    });
    expect(outletsRes.ok()).toBeTruthy();
    const outletsJson = await outletsRes.json();
    const outlet =
      (outletsJson.outlets || []).find((item) => item.name === "Main Store") ||
      (outletsJson.outlets || []).find((item) => item.name === "Branch Store") ||
      (outletsJson.outlets || [])[0];
    expect(outlet).toBeTruthy();

    await prepareAdminForPOS(request, outlet);

    const productRes = await request.get(
      `${API}/products/search?query=${encodeURIComponent("PROD-001")}&outlet_id=${outlet.id}`,
      { headers: ADMIN_HEADERS },
    );
    expect(productRes.ok()).toBeTruthy();
    const productJson = await productRes.json();
    const product = (productJson.products || [])[0];
    expect(product).toBeTruthy();

    await page.goto("/pos");

    const gateTitle = page.getByRole("heading", {
      name: /prepare pos before selling/i,
    });
    await expect(gateTitle).toBeVisible({ timeout: 15000 });

    await page.getByRole("combobox").last().selectOption(String(outlet.id));
    const clockedInRefreshButton = page.getByRole("button", {
      name: /i have clocked in/i,
    });

    const openShiftButton = page.getByRole("button", { name: /^open shift$/i });
    await expect(async () => {
      const shiftPromptVisible = await openShiftButton.isVisible();
      const clockInPromptVisible = await clockedInRefreshButton.isVisible();
      const gateGone = !(await gateTitle.isVisible());
      expect(shiftPromptVisible || clockInPromptVisible || gateGone).toBeTruthy();
    }).toPass({ timeout: 15000 });

    if (await openShiftButton.isVisible()) {
      const oneHundredInput = page.getByRole("spinbutton", {
        name: "Rs 100",
        exact: true,
      });
      await oneHundredInput.click();
      await oneHundredInput.press("Control+A");
      await oneHundredInput.pressSequentially("1");
      await expect(oneHundredInput).toHaveValue("1");
      await expect(openShiftButton).toBeEnabled({ timeout: 10000 });
      await openShiftButton.click();
    }

    if (await clockedInRefreshButton.isVisible()) {
      await clockedInRefreshButton.click();
    }

    await expect(gateTitle).not.toBeVisible({ timeout: 15000 });
    await expect(page.getByPlaceholder(/Search by Name, Barcode/i)).toBeVisible({
      timeout: 15000,
    });

    const searchInput = page.getByPlaceholder(/Search by Name, Barcode/i);
    await searchInput.fill(String(product.barcode || "PROD-001"));

    const searchDropdownItem = page
      .getByText(product.name, { exact: false })
      .locator("visible=true")
      .last();
    await expect(searchDropdownItem).toBeVisible({ timeout: 15000 });
    await searchDropdownItem.click({ force: true });

    await expect(page.getByText(product.name).last()).toBeVisible();

    await page.getByRole("button", { name: /pay/i }).click();
    await expect(page.getByText(/Complete Payment/i)).toBeVisible();
    await page.getByRole("button", { name: /^add$/i }).click();
    await page.getByRole("button", { name: /complete sale/i }).click();

    await expect(page.getByText(/Sale Complete/i)).toBeVisible();
    await expect(page.getByText(/Invoice:/i).first()).toBeVisible();

    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByText(/Cart is empty/i)).toBeVisible();
  });
});
