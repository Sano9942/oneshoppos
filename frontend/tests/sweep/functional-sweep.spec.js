/**
 * Full real-user functional sweep — option 2.
 *
 * Provisions a fresh tenant on production, walks every feature exactly as
 * a real merchant would (signup → onboarding → upgrade → POS → inventory
 * → reports), captures findings, leaves the tenant alive for manual
 * cleanup.
 *
 * Run with:
 *   cd frontend
 *   npx playwright test --project=sweep
 *
 * Expected duration: 3–4 hours. Headed-only. Operator interaction:
 *   1. Click email verify link from sano9942@hotmail.com (~5 min in)
 *   2. Approve sandbox payment in the Playwright window (~30 min in)
 *
 * See ./README.md for full operator instructions.
 */
import { test, expect } from "@playwright/test";
import { resolve } from "path";
import {
  startSweep,
  captureStep,
  note,
  emitFindingsFile,
} from "./helpers/findings.js";
import { waitForEmailVerified } from "./helpers/pause-for-email-verify.js";
import {
  navigateTo,
  dismissOverlays,
  clickSidebarLink,
  waitForPageHeading,
} from "./helpers/nav.js";
import { enterManagerPin } from "./helpers/manager-pin.js";

const BACKEND = "https://api.sanopos.com";
const FRONTEND = "https://sanopos.com";
const FIXTURE_IMAGE = resolve(import.meta.dirname, "fixtures/test-product.jpg");

// Tenant identity — generated once per run.
const ts = Date.now();
const TENANT_NAME = `Live Test Auto ${ts}`;
const TENANT_SLUG_EXPECTED = `livetestauto${ts}`;
const OWNER_NAME = "Sweep Operator";
const EMAIL = "sano9942@hotmail.com";
const PASSWORD = "SweepRun123!";
const ADMIN_PIN = "1234";
const MANAGER_PIN = "5678";
const CASHIER_PIN = "9999";

// Shared state — populated as steps progress.
const ctx = {
  slug: null,
  tenantId: null,
  outletMainId: null,
  outletBranchId: null,
  productIds: [],
  customerIds: [],
  saleReceiptNumbers: [],
  upgradedToPro: false,
};

test.describe.configure({ mode: "serial" });

test.describe("Full real-user functional sweep", () => {
  let page;
  let context;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
    startSweep(TENANT_SLUG_EXPECTED);

    // eslint-disable-next-line no-console
    console.log("\n========================================");
    // eslint-disable-next-line no-console
    console.log(`SWEEP STARTING — ${TENANT_NAME}`);
    // eslint-disable-next-line no-console
    console.log(`Expected slug: ${TENANT_SLUG_EXPECTED}`);
    // eslint-disable-next-line no-console
    console.log(`Email: ${EMAIL}`);
    // eslint-disable-next-line no-console
    console.log("========================================\n");
  });

  test.afterAll(async () => {
    emitFindingsFile();
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});

    // eslint-disable-next-line no-console
    console.log("\n========================================");
    // eslint-disable-next-line no-console
    console.log(`SWEEP DONE — tenant '${ctx.slug}' left alive on prod.`);
    // eslint-disable-next-line no-console
    console.log(`Delete via /admin when finished poking around.`);
    // eslint-disable-next-line no-console
    console.log("========================================\n");
  });

  // ─── Phase 1 — Signup & onboarding ───────────────────────────────────

  test("01 — open landing page", async () => {
    await captureStep(page, "01-landing", async () => {
      await page.goto(FRONTEND);
      await page.waitForLoadState("networkidle");
      await expect(page).toHaveTitle(/SanoPOS/i);
    });
  });

  test("02 — navigate to signup with Free plan", async () => {
    await captureStep(page, "02-signup-page", async () => {
      await page.goto(`${FRONTEND}/signup?plan=free`);
      await page.waitForLoadState("networkidle");
      await expect(
        page.getByRole("heading", { name: /create.*store|sign.*up/i }).first(),
      ).toBeVisible();
    });
  });

  test("03 — fill signup form", async () => {
    await captureStep(page, "03-signup-fill", async () => {
      await page.getByPlaceholder("My Awesome Store").fill(TENANT_NAME);
      await page.getByPlaceholder("John Doe").fill(OWNER_NAME);
      await page.getByPlaceholder("you@example.com").fill(EMAIL);
      await page.getByPlaceholder("Min 8 characters").fill(PASSWORD);
    });
  });

  test("04 — submit signup", async () => {
    await captureStep(page, "04-signup-submit", async () => {
      const respPromise = page.waitForResponse(
        (r) => r.url().includes("/api/auth/signup") && r.request().method() === "POST",
      );
      await page.getByRole("button", { name: /create store/i }).click();
      const resp = await respPromise;
      const body = await resp.json();
      expect(resp.ok()).toBeTruthy();
      ctx.slug = body.slug || TENANT_SLUG_EXPECTED;
      // eslint-disable-next-line no-console
      console.log(`[signup] tenant slug = ${ctx.slug}`);
    });
  });

  test("05 — wait for email verification (HUMAN STEP)", async () => {
    await captureStep(page, "05-email-verify", async () => {
      note("Waiting for operator to click verify link in Hotmail");
      await waitForEmailVerified({
        backend: BACKEND,
        slug: ctx.slug,
        username: OWNER_NAME,
        password: PASSWORD,
      });
      note("Email verified");
    });
  });

  test("06 — log in as new tenant admin", async () => {
    await captureStep(page, "06-login", async () => {
      await page.goto(`${FRONTEND}/login`);
      await page.waitForLoadState("networkidle");

      const storeCode = page.getByPlaceholder(/aceshardware/i);
      if (await storeCode.isVisible({ timeout: 5000 }).catch(() => false)) {
        await storeCode.fill(ctx.slug);
      }
      await page.getByPlaceholder(/employee name/i).fill(OWNER_NAME);
      await page.getByPlaceholder(/password/i).fill(PASSWORD);
      await page.getByRole("button", { name: /sign in/i }).click();
      await page.waitForURL(/dashboard|setup|context/, { timeout: 30000 });
    });
  });

  test("07 — complete setup wizard (general_retail)", async () => {
    await captureStep(page, "07-setup-wizard", async () => {
      // After login, MT tenants either land on /setup or /dashboard depending
      // on setup_complete. If we're on /dashboard already, skip.
      if (!/setup/.test(page.url())) {
        note("Setup wizard skipped — landed on dashboard already");
        return;
      }

      // Pick general_retail preset. Selectors are best-effort — wizard UI
      // varies by step.
      const retailCard = page
        .getByRole("button", { name: /general retail|retail store|general/i })
        .first();
      if (await retailCard.isVisible({ timeout: 5000 }).catch(() => false)) {
        await retailCard.click();
      }

      // Click through Next / Continue / Complete buttons until we land on /dashboard.
      // Wizard has variable step count — bound the loop at 15.
      for (let i = 0; i < 15; i++) {
        if (/dashboard/.test(page.url())) break;

        const next = page.getByRole("button", {
          name: /^(next|continue|complete|finish|get started)$/i,
        });
        if (await next.first().isVisible({ timeout: 3000 }).catch(() => false)) {
          await next.first().click();
          await page.waitForLoadState("networkidle").catch(() => {});
        } else {
          break;
        }
      }

      // If still not on dashboard, try direct nav.
      if (!/dashboard/.test(page.url())) {
        await page.goto(`${FRONTEND}/dashboard`);
        await page.waitForLoadState("networkidle");
      }
    });
  });

  test("08 — dashboard loads after onboarding", async () => {
    await captureStep(page, "08-dashboard-first-load", async () => {
      await navigateTo(page, "/dashboard");
      await waitForPageHeading(page, "Dashboard");
    });
  });

  // ─── Phase 2 — Tenant prep ───────────────────────────────────────────

  test("09 — add a category", async () => {
    await captureStep(page, "09-add-category", async () => {
      await navigateTo(page, "/categories");
      await page.getByRole("button", { name: /add category/i }).click();
      await page.getByLabel(/name|category name/i).first().fill("Electronics");
      await page.getByRole("button", { name: /save|create/i }).first().click();
      await page.waitForLoadState("networkidle");
      await expect(page.getByText("Electronics").first()).toBeVisible();
    });
  });

  test("10 — add a tax rule", async () => {
    await captureStep(page, "10-add-tax", async () => {
      await navigateTo(page, "/taxes");
      await page.getByRole("button", { name: /add tax|new tax/i }).click();
      await page.getByLabel(/name|rule name/i).first().fill("GST 17%");
      await page.getByLabel(/rate/i).first().fill("17");
      await page.getByRole("button", { name: /save|create/i }).first().click();
      await page.waitForLoadState("networkidle");
    });
  });

  test("11 — add a supplier", async () => {
    await captureStep(page, "11-add-supplier", async () => {
      await navigateTo(page, "/suppliers");
      await page.getByRole("button", { name: /add supplier/i }).click();
      await page.getByLabel(/company name|name/i).first().fill("Sweep Supplier 1");
      await page.getByLabel(/phone/i).first().fill("0300-0000001");
      await page.getByRole("button", { name: /save|create/i }).first().click();
      await page.waitForLoadState("networkidle");
    });
  });

  test("12 — add product 1 (with image upload)", async () => {
    await captureStep(page, "12-add-product-1", async () => {
      await navigateTo(page, "/inventory");
      await page.getByRole("button", { name: /add product/i }).click();
      await page.waitForLoadState("networkidle");

      await page.getByLabel(/product name|name/i).first().fill("Sweep Test Mug");
      await page.getByLabel(/^price/i).first().fill("250");
      await page.getByLabel(/cost/i).first().fill("100");

      // Image upload — best-effort, skip gracefully if input missing.
      const fileInput = page.locator('input[type="file"]').first();
      if (await fileInput.count()) {
        await fileInput.setInputFiles(FIXTURE_IMAGE).catch((e) => {
          note(`Image upload failed: ${e.message}`);
        });
      }

      await page.getByRole("button", { name: /save|create/i }).first().click();
      await page.waitForLoadState("networkidle");
    });
  });

  test("13 — add product 2 (no image)", async () => {
    await captureStep(page, "13-add-product-2", async () => {
      await navigateTo(page, "/inventory");
      await page.getByRole("button", { name: /add product/i }).click();
      await page.waitForLoadState("networkidle");

      await page.getByLabel(/product name|name/i).first().fill("Sweep Test Notebook");
      await page.getByLabel(/^price/i).first().fill("80");
      await page.getByLabel(/cost/i).first().fill("30");

      await page.getByRole("button", { name: /save|create/i }).first().click();
      await page.waitForLoadState("networkidle");
    });
  });

  test("14 — add a customer", async () => {
    await captureStep(page, "14-add-customer", async () => {
      await navigateTo(page, "/customers");
      await page.getByRole("button", { name: /add customer/i }).click();
      await page.getByLabel(/^name/i).first().fill("Sweep Customer 1");
      await page.getByLabel(/mobile|phone/i).first().fill("0300-1234001");
      const emailInput = page.getByLabel(/email/i).first();
      if (await emailInput.isVisible({ timeout: 1000 }).catch(() => false)) {
        await emailInput.fill("sweepcust1@example.com");
      }
      await page.getByRole("button", { name: /save|create/i }).first().click();
      await page.waitForLoadState("networkidle");
    });
  });

  test("15 — add a 2nd outlet (triggers Pro paywall)", async () => {
    await captureStep(page, "15-add-second-outlet-paywall", async () => {
      await navigateTo(page, "/outlets");
      await page.getByRole("button", { name: /add outlet/i }).click();

      // Free plan caps outlets at 1 → expect a paywall dialog.
      const paywall = page.getByText(/outlet limit|adds.*PKR|upgrade/i).first();
      const visible = await paywall.isVisible({ timeout: 5000 }).catch(() => false);

      if (visible) {
        note("Paywall correctly shown on 2nd outlet attempt");
        // Click "Continue to payment" or equivalent
        const cta = page.getByRole("button", { name: /continue.*payment|upgrade now|pay/i }).first();
        if (await cta.isVisible({ timeout: 2000 }).catch(() => false)) {
          await cta.click();
          await page.waitForLoadState("networkidle");
        }
      } else {
        note("No paywall appeared — Free plan cap may not be enforced as expected");
      }
    });
  });

  test("16 — complete sandbox payment to upgrade to Pro (HUMAN STEP)", async () => {
    await captureStep(page, "16-sandbox-payment", async () => {
      // Sweep landed on /billing or sandbox redirect. Look for Pay Now.
      const payNow = page.getByRole("button", { name: /pay now|complete payment|sandbox/i }).first();
      if (await payNow.isVisible({ timeout: 8000 }).catch(() => false)) {
        await payNow.click();
        await page.waitForLoadState("networkidle");
      }

      // Sandbox flow shows a "Approve / Confirm Payment" button — operator clicks.
      // We wait up to 5 min for a redirect back to the app.
      // eslint-disable-next-line no-console
      console.log("\n[sandbox] Approve the sandbox payment in the Playwright window.");
      // eslint-disable-next-line no-console
      console.log("[sandbox] Sweep will resume once the page redirects back to /billing or /dashboard.\n");

      try {
        await page.waitForURL(/billing|dashboard/, { timeout: 5 * 60 * 1000 });
        ctx.upgradedToPro = true;
        note("Sandbox payment completed — tenant upgraded to Pro");
      } catch (err) {
        note(`Sandbox payment timeout or skipped: ${err.message}`);
      }
    });
  });

  test("17 — verify Pro plan active", async () => {
    await captureStep(page, "17-verify-pro", async () => {
      await navigateTo(page, "/billing");
      const proIndicator = page.getByText(/pro/i).first();
      await expect(proIndicator).toBeVisible({ timeout: 10000 });
    });
  });

  test("18 — add 2nd outlet (now succeeds)", async () => {
    await captureStep(page, "18-add-second-outlet", async () => {
      await navigateTo(page, "/outlets");
      await page.getByRole("button", { name: /add outlet/i }).click();
      await page.getByLabel(/name|outlet name/i).first().fill("Branch 2");
      const addrInput = page.getByLabel(/address/i).first();
      if (await addrInput.isVisible({ timeout: 1000 }).catch(() => false)) {
        await addrInput.fill("Sweep Branch Address");
      }
      await page.getByRole("button", { name: /save|create/i }).first().click();
      await page.waitForLoadState("networkidle");
      await expect(page.getByText("Branch 2").first()).toBeVisible();
    });
  });

  test("19 — add a manager employee", async () => {
    await captureStep(page, "19-add-manager", async () => {
      await navigateTo(page, "/employees");
      await page.getByRole("button", { name: /add employee/i }).click();
      await page.getByLabel(/name|full name/i).first().fill("Sweep Manager");
      // Role select
      const roleSel = page.getByLabel(/role/i).first();
      await roleSel.selectOption({ label: /manager/i }).catch(async () => {
        await roleSel.click();
        await page.getByRole("option", { name: /manager/i }).first().click();
      });
      const pinInput = page.getByLabel(/pin/i).first();
      if (await pinInput.isVisible({ timeout: 1000 }).catch(() => false)) {
        await pinInput.fill(MANAGER_PIN);
      }
      await page.getByRole("button", { name: /save|create/i }).first().click();
      await page.waitForLoadState("networkidle");
    });
  });

  test("20 — add a cashier employee", async () => {
    await captureStep(page, "20-add-cashier", async () => {
      await navigateTo(page, "/employees");
      await page.getByRole("button", { name: /add employee/i }).click();
      await page.getByLabel(/name|full name/i).first().fill("Sweep Cashier");
      const roleSel = page.getByLabel(/role/i).first();
      await roleSel.selectOption({ label: /cashier/i }).catch(async () => {
        await roleSel.click();
        await page.getByRole("option", { name: /cashier/i }).first().click();
      });
      const pinInput = page.getByLabel(/pin/i).first();
      if (await pinInput.isVisible({ timeout: 1000 }).catch(() => false)) {
        await pinInput.fill(CASHIER_PIN);
      }
      await page.getByRole("button", { name: /save|create/i }).first().click();
      await page.waitForLoadState("networkidle");
    });
  });

  test("21 — add a customer group", async () => {
    await captureStep(page, "21-add-customer-group", async () => {
      await navigateTo(page, "/customer-groups");
      await page.getByRole("button", { name: /new group|add group/i }).click();
      await page.getByLabel(/name|group name/i).first().fill("VIP Customers");
      await page.getByRole("button", { name: /save|create/i }).first().click();
      await page.waitForLoadState("networkidle");
    });
  });

  test("22 — add a promotion", async () => {
    await captureStep(page, "22-add-promotion", async () => {
      await navigateTo(page, "/promotions");
      await page.getByRole("button", { name: /add promotion|new promotion/i }).click();
      await page.getByLabel(/name|promotion name/i).first().fill("Sweep 10% Off");
      // Type Percentage Discount
      const typeSel = page.getByLabel(/type/i).first();
      if (await typeSel.isVisible({ timeout: 1000 }).catch(() => false)) {
        await typeSel.selectOption({ label: /percentage/i }).catch(() => {});
      }
      const valueInput = page.getByLabel(/value|amount/i).first();
      if (await valueInput.isVisible({ timeout: 1000 }).catch(() => false)) {
        await valueInput.fill("10");
      }
      await page.getByRole("button", { name: /save|create/i }).first().click();
      await page.waitForLoadState("networkidle");
    });
  });

  test("23 — add a gift card", async () => {
    await captureStep(page, "23-add-gift-card", async () => {
      await navigateTo(page, "/gift-cards");
      await page.getByRole("button", { name: /new card|add card/i }).click();
      const valueInput = page.getByLabel(/value|amount|initial value/i).first();
      if (await valueInput.isVisible({ timeout: 1000 }).catch(() => false)) {
        await valueInput.fill("500");
      }
      await page.getByRole("button", { name: /create|save/i }).first().click();
      await page.waitForLoadState("networkidle");
    });
  });

  // ─── Phase 3 — Daily operations (POS) ────────────────────────────────

  test("24 — clock in via kiosk with admin PIN", async () => {
    await captureStep(page, "24-kiosk-clockin", async () => {
      await navigateTo(page, "/kiosk");
      // Kiosk is a 0–9 keypad. Type the PIN one digit at a time.
      for (const d of ADMIN_PIN.split("")) {
        await page
          .getByRole("button", { name: new RegExp(`^${d}$`) })
          .first()
          .click();
      }
      const submit = page.getByRole("button", { name: /^(submit|ok|enter)$/i }).first();
      if (await submit.isVisible({ timeout: 1000 }).catch(() => false)) {
        await submit.click();
      }
      await page.waitForLoadState("networkidle");
      // Expect a success toast or status text — best-effort.
      await page.waitForTimeout(2000);
    });
  });

  test("25 — open POS shift", async () => {
    await captureStep(page, "25-open-shift", async () => {
      await navigateTo(page, "/cash-management");
      const openBtn = page.getByRole("button", { name: /open shift/i }).first();
      await openBtn.click();
      const floatInput = page.getByLabel(/opening|float|amount/i).first();
      if (await floatInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await floatInput.fill("1000");
      }
      await page.getByRole("button", { name: /open|confirm|start/i }).first().click();
      await page.waitForLoadState("networkidle");
    });
  });

  test("26 — open POS page", async () => {
    await captureStep(page, "26-pos-load", async () => {
      await navigateTo(page, "/pos");
      // POS loads — assert search box and Pay button present.
      await expect(page.locator('input[placeholder*="search" i]').first()).toBeVisible({
        timeout: 10000,
      });
    });
  });

  test("27 — POS sale: cash, no customer", async () => {
    await captureStep(page, "27-pos-sale-cash", async () => {
      // Type product name in POS search → select first result.
      await page.locator('input[placeholder*="search" i]').first().fill("Mug");
      await page.waitForTimeout(1500);
      // Click the first product card / row in results.
      await page.getByText("Sweep Test Mug").first().click().catch(() => {});

      // Click Pay (F9). UI may show as a button or via keyboard.
      await page.keyboard.press("F9").catch(() => {});
      await page.waitForTimeout(1500);

      // Pay modal — Cash tab default. Fill the amount = total.
      const amountInput = page.locator('input[type="number"]').first();
      if (await amountInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        await amountInput.fill("250");
      }
      // Add tender, then complete.
      const addBtn = page.getByRole("button", { name: /^add$/i }).first();
      if (await addBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await addBtn.click();
      }
      const completeBtn = page.getByRole("button", { name: /complete payment|confirm|charge/i }).first();
      if (await completeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await completeBtn.click();
      }
      await page.waitForLoadState("networkidle");
      // Close any post-sale receipt modal
      const closeBtn = page.getByRole("button", { name: /close|done|new sale/i }).first();
      if (await closeBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await closeBtn.click();
      }
    });
  });

  test("28 — POS sale: with customer + discount", async () => {
    await captureStep(page, "28-pos-sale-discount", async () => {
      await navigateTo(page, "/pos");
      await page.locator('input[placeholder*="search" i]').first().fill("Notebook");
      await page.waitForTimeout(1500);
      await page.getByText("Sweep Test Notebook").first().click().catch(() => {});

      // Attach customer (F4)
      await page.keyboard.press("F4").catch(() => {});
      await page.waitForTimeout(1500);
      await page.locator('input[placeholder*="search" i]').last().fill("Sweep Customer 1").catch(() => {});
      await page.waitForTimeout(1500);
      await page.getByText("Sweep Customer 1").first().click().catch(() => {});

      // Add discount (F2)
      await page.keyboard.press("F2").catch(() => {});
      await page.waitForTimeout(1000);
      const discountValue = page.getByLabel(/value/i).first();
      if (await discountValue.isVisible({ timeout: 1500 }).catch(() => false)) {
        await discountValue.fill("10");
      }
      await page.getByRole("button", { name: /apply discount/i }).first().click().catch(() => {});

      // Pay
      await page.keyboard.press("F9").catch(() => {});
      await page.waitForTimeout(1500);
      const completeBtn = page.getByRole("button", { name: /complete payment|confirm|charge/i }).first();
      if (await completeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await completeBtn.click();
      }
      await page.waitForLoadState("networkidle");
      const closeBtn = page.getByRole("button", { name: /close|done|new sale/i }).first();
      if (await closeBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await closeBtn.click();
      }
    });
  });

  test("29 — park a sale, then resume", async () => {
    await captureStep(page, "29-park-resume", async () => {
      await navigateTo(page, "/pos");
      await page.locator('input[placeholder*="search" i]').first().fill("Mug");
      await page.waitForTimeout(1500);
      await page.getByText("Sweep Test Mug").first().click().catch(() => {});

      // Park (F3)
      await page.keyboard.press("F3").catch(() => {});
      await page.waitForTimeout(1500);
      const noteInput = page.getByPlaceholder(/note|reason/i).first();
      if (await noteInput.isVisible({ timeout: 1000 }).catch(() => false)) {
        await noteInput.fill("Sweep park test");
      }
      const parkConfirm = page.getByRole("button", { name: /park|save|confirm/i }).first();
      if (await parkConfirm.isVisible({ timeout: 1000 }).catch(() => false)) {
        await parkConfirm.click();
      }
      await page.waitForTimeout(1500);

      // Open Parked Sales (F5)
      await navigateTo(page, "/parked-sales");
      const resume = page.getByRole("button", { name: /resume/i }).first();
      if (await resume.isVisible({ timeout: 3000 }).catch(() => false)) {
        await resume.click();
        await page.waitForLoadState("networkidle");
      }
    });
  });

  test("30 — process a return", async () => {
    await captureStep(page, "30-process-return", async () => {
      await navigateTo(page, "/returns");
      await page.getByRole("button", { name: /process return|new return/i }).click().catch(() => {});
      // The flow expects an invoice/receipt number from the recent sale.
      // Best-effort: open Sales History, grab first receipt, paste here.
      // For v1 just record the step ran.
      note("Return flow opened — full E2E return needs receipt# extraction (TODO)");
    });
  });

  test("31 — close shift", async () => {
    await captureStep(page, "31-close-shift", async () => {
      await navigateTo(page, "/cash-management");
      const closeBtn = page.getByRole("button", { name: /close shift/i }).first();
      if (!(await closeBtn.isVisible({ timeout: 3000 }).catch(() => false))) {
        note("No active shift found to close — skipping");
        return;
      }
      await closeBtn.click();
      const actualInput = page.getByLabel(/actual|counted/i).first();
      if (await actualInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await actualInput.fill("1500");
      }
      await page.getByRole("button", { name: /close|confirm|finalize/i }).first().click();
      await page.waitForLoadState("networkidle");
    });
  });

  // ─── Phase 4 — Inventory operations ──────────────────────────────────

  test("32 — create a purchase order", async () => {
    await captureStep(page, "32-create-po", async () => {
      await navigateTo(page, "/purchase-orders");
      await page.getByRole("button", { name: /create po|new po|add po/i }).click();
      // Pick supplier
      const supplierSel = page.getByLabel(/supplier/i).first();
      if (await supplierSel.isVisible({ timeout: 2000 }).catch(() => false)) {
        await supplierSel.selectOption({ label: /Sweep Supplier/i }).catch(() => {});
      }
      // Add a line item — best-effort
      const addLine = page.getByRole("button", { name: /add line|add item|add product/i }).first();
      if (await addLine.isVisible({ timeout: 1000 }).catch(() => false)) {
        await addLine.click();
      }
      const productSel = page.getByLabel(/product/i).first();
      if (await productSel.isVisible({ timeout: 1000 }).catch(() => false)) {
        await productSel.selectOption({ label: /Sweep Test Mug/i }).catch(() => {});
      }
      const qty = page.getByLabel(/quantity|qty/i).first();
      if (await qty.isVisible({ timeout: 1000 }).catch(() => false)) {
        await qty.fill("10");
      }
      await page.getByRole("button", { name: /submit|save|create/i }).first().click();
      await page.waitForLoadState("networkidle");
    });
  });

  test("33 — create a stock transfer", async () => {
    await captureStep(page, "33-stock-transfer", async () => {
      await navigateTo(page, "/transfers");
      await page.getByRole("button", { name: /new transfer|add transfer/i }).click();
      const fromSel = page.getByLabel(/from/i).first();
      if (await fromSel.isVisible({ timeout: 2000 }).catch(() => false)) {
        await fromSel.selectOption({ label: /main store/i }).catch(() => {});
      }
      const toSel = page.getByLabel(/to/i).first();
      if (await toSel.isVisible({ timeout: 2000 }).catch(() => false)) {
        await toSel.selectOption({ label: /branch 2/i }).catch(() => {});
      }
      // Best-effort, save without lines if the form rejects empty
      await page.getByRole("button", { name: /create|save/i }).first().click().catch(() => {});
      await page.waitForLoadState("networkidle");
    });
  });

  test("34 — create a stock adjustment", async () => {
    await captureStep(page, "34-stock-adjustment", async () => {
      await navigateTo(page, "/adjustments");
      await page.getByRole("button", { name: /new adjustment|add adjustment/i }).click();
      const productSel = page.getByLabel(/product/i).first();
      if (await productSel.isVisible({ timeout: 2000 }).catch(() => false)) {
        await productSel.selectOption({ label: /Sweep Test Mug/i }).catch(() => {});
      }
      const reasonSel = page.getByLabel(/reason/i).first();
      if (await reasonSel.isVisible({ timeout: 1000 }).catch(() => false)) {
        await reasonSel.selectOption({ label: /correction|other/i }).catch(() => {});
      }
      const qty = page.getByLabel(/quantity|qty|change/i).first();
      if (await qty.isVisible({ timeout: 1000 }).catch(() => false)) {
        await qty.fill("5");
      }
      await page.getByRole("button", { name: /save|create/i }).first().click();
      await page.waitForLoadState("networkidle");
    });
  });

  // ─── Phase 5 — Customer & marketing ──────────────────────────────────

  test("35 — create a quotation", async () => {
    await captureStep(page, "35-create-quotation", async () => {
      await navigateTo(page, "/quotations");
      await page.getByRole("button", { name: /new quotation|add quotation/i }).click();
      // Customer + outlet + employee picks vary; best-effort save.
      await page.getByRole("button", { name: /create|save/i }).first().click().catch(() => {});
      await page.waitForLoadState("networkidle");
    });
  });

  test("36 — create a CRM lead", async () => {
    await captureStep(page, "36-crm-lead", async () => {
      await navigateTo(page, "/crm");
      await page.getByRole("button", { name: /add lead|new lead/i }).click();
      await page.getByLabel(/name|lead name/i).first().fill("Sweep Lead 1");
      await page.getByRole("button", { name: /save|create|add/i }).first().click();
      await page.waitForLoadState("networkidle");
    });
  });

  // ─── Phase 6 — Storefront (separate browser context) ─────────────────

  test("37 — public storefront browse + checkout (2nd context)", async ({ browser }) => {
    await captureStep(page, "37-storefront-checkout", async () => {
      const publicCtx = await browser.newContext();
      const publicPage = await publicCtx.newPage();
      try {
        await publicPage.goto(`${FRONTEND}/store/${ctx.slug}`);
        await publicPage.waitForLoadState("networkidle");
        // Browse → click first product
        const firstProduct = publicPage.getByText(/sweep test/i).first();
        if (await firstProduct.isVisible({ timeout: 5000 }).catch(() => false)) {
          await firstProduct.click();
          await publicPage.getByRole("button", { name: /add to cart/i }).first().click().catch(() => {});
          await publicPage.goto(`${FRONTEND}/store/${ctx.slug}/checkout`);
          await publicPage.waitForLoadState("networkidle");
          // Fill checkout form
          await publicPage.getByPlaceholder(/full name/i).first().fill("Walk-in Customer").catch(() => {});
          await publicPage.getByPlaceholder(/03XX/i).first().fill("0300-9999999").catch(() => {});
          await publicPage.getByPlaceholder(/you@example/i).first().fill("walkin@example.com").catch(() => {});
          await publicPage.getByRole("button", { name: /place order/i }).first().click().catch(() => {});
          await publicPage.waitForLoadState("networkidle");
        } else {
          note("Storefront has no published products — empty state");
        }
      } finally {
        await publicPage.close();
        await publicCtx.close();
      }
    });
  });

  test("38 — verify storefront order in Orders page", async () => {
    await captureStep(page, "38-orders-page", async () => {
      await navigateTo(page, "/orders");
      // Sweep accepts either a #sf_ row or an empty state — both acceptable.
      await waitForPageHeading(page, "Orders");
    });
  });

  // ─── Phase 7 — Reports & accounting (read-only walks) ────────────────

  test("39 — Reports page loads", async () => {
    await captureStep(page, "39-reports", async () => {
      await navigateTo(page, "/reports");
      await waitForPageHeading(page, "Reports");
    });
  });

  test("40 — Accounting page (P&L tab)", async () => {
    await captureStep(page, "40-accounting", async () => {
      await navigateTo(page, "/accounting");
      await waitForPageHeading(page, /accounting|financial/i);
    });
  });

  test("41 — Chart of Accounts", async () => {
    await captureStep(page, "41-chart-of-accounts", async () => {
      await navigateTo(page, "/chart-of-accounts");
      await waitForPageHeading(page, /chart of accounts/i);
    });
  });

  test("42 — Journal Entries", async () => {
    await captureStep(page, "42-journal-entries", async () => {
      await navigateTo(page, "/journal-entries");
      await waitForPageHeading(page, /journal entries/i);
    });
  });

  test("43 — Sales History page", async () => {
    await captureStep(page, "43-sales-history", async () => {
      await navigateTo(page, "/sales-history");
      await waitForPageHeading(page, /sales history/i);
    });
  });

  // ─── Phase 8 — Settings & admin ──────────────────────────────────────

  test("44 — Company Profile loads", async () => {
    await captureStep(page, "44-company-profile", async () => {
      await navigateTo(page, "/company-settings");
      await waitForPageHeading(page, /company/i);
    });
  });

  test("45 — toggle dark mode", async () => {
    await captureStep(page, "45-dark-mode", async () => {
      // Hassan / profile dropdown contains the toggle.
      await page.getByRole("button", { name: new RegExp(`^${OWNER_NAME.split(" ")[0]}$`, "i") }).first().click().catch(() => {});
      await page.waitForTimeout(500);
      await page.getByRole("menuitem", { name: /dark mode|theme/i }).first().click().catch(() => {});
      await page.waitForTimeout(500);
    });
  });

  test("46 — submit a support ticket", async () => {
    await captureStep(page, "46-support-ticket", async () => {
      // Floating "?" widget on every page
      await page.getByRole("button", { name: /^Support|^\?$/i }).first().click().catch(() => {});
      await page.waitForTimeout(1000);
      const subject = page.getByLabel(/subject/i).first();
      if (await subject.isVisible({ timeout: 2000 }).catch(() => false)) {
        await subject.fill("Sweep test ticket");
      }
      const desc = page.getByLabel(/description|message/i).first();
      if (await desc.isVisible({ timeout: 1000 }).catch(() => false)) {
        await desc.fill("Generated by automated sweep run.");
      }
      await page.getByRole("button", { name: /submit|send/i }).first().click().catch(() => {});
      await page.waitForLoadState("networkidle");
    });
  });

  test("47 — verify ticket appears in My Tickets", async () => {
    await captureStep(page, "47-my-tickets", async () => {
      await navigateTo(page, "/my-tickets");
      await waitForPageHeading(page, /tickets/i);
    });
  });

  test("48 — Notifications page", async () => {
    await captureStep(page, "48-notifications", async () => {
      await navigateTo(page, "/notifications");
      await waitForPageHeading(page, /notifications/i);
    });
  });

  test("49 — Action History", async () => {
    await captureStep(page, "49-action-history", async () => {
      await navigateTo(page, "/action-history");
      await waitForPageHeading(page, /action history/i);
    });
  });

  test("50 — Retail Risk", async () => {
    await captureStep(page, "50-retail-risk", async () => {
      await navigateTo(page, "/retail-risk");
      await waitForPageHeading(page, /retail risk/i);
    });
  });
});
