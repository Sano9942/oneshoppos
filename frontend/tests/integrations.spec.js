import { test, expect } from "@playwright/test";
import { navigateTo, waitForPageShell } from "./helpers/nav.js";

test.describe("Integrations Hub", () => {
  test("hub page loads at /settings/integrations", async ({ page }) => {
    await navigateTo(page, "/settings/integrations");
    await expect(
      page.getByRole("heading", { name: /integration/i }).first()
    ).toBeVisible({ timeout: 15000 });
  });

  test("All tab shows integration cards", async ({ page }) => {
    await navigateTo(page, "/settings/integrations");
    await expect(
      page.getByRole("heading", { name: /integration/i }).first()
    ).toBeVisible({ timeout: 15000 });
    // All tab should be active by default — look for cards
    const cards = page.locator("[class*=card], [class*=Card], [class*=border]").filter({ hasText: /connect|manage|configure/i });
    await expect(cards.first()).toBeVisible({ timeout: 10000 });
  });

  test("Marketplaces tab filter works", async ({ page }) => {
    await navigateTo(page, "/settings/integrations");
    await page.getByRole("button", { name: /marketplace/i }).or(page.getByText(/marketplace/i)).first().click();
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/daraz|shopify/i).first()).toBeVisible({ timeout: 10000 });
  });

  test("Social Commerce tab filter works", async ({ page }) => {
    await navigateTo(page, "/settings/integrations");
    await page.getByRole("button", { name: /social/i }).or(page.getByText(/social commerce/i)).first().click();
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/facebook/i).first()).toBeVisible({ timeout: 10000 });
  });

  test("Messaging tab filter works", async ({ page }) => {
    await navigateTo(page, "/settings/integrations");
    await page.getByRole("button", { name: /messaging/i }).or(page.getByText(/messaging/i)).first().click();
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/whatsapp/i).first()).toBeVisible({ timeout: 10000 });
  });

  test("Product Feeds tab filter works", async ({ page }) => {
    await navigateTo(page, "/settings/integrations");
    await page.getByRole("button", { name: /product feed/i }).or(page.getByText(/product feed/i)).first().click();
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/google merchant/i).first()).toBeVisible({ timeout: 10000 });
  });

  test("Couriers tab shows courier cards", async ({ page }) => {
    await navigateTo(page, "/settings/integrations");
    await page.getByRole("button", { name: /courier/i }).or(page.getByText(/courier/i)).first().click();
    await page.waitForLoadState("networkidle");
    // Should have multiple courier cards (leopards, tcs, blueex, etc.)
    await expect(page.getByText(/leopards|tcs|blueex|trax|callcourier/i).first()).toBeVisible({ timeout: 10000 });
  });

  test("Daraz card visible with Connect/Manage button", async ({ page }) => {
    await navigateTo(page, "/settings/integrations");
    await expect(page.getByText(/daraz/i).first()).toBeVisible({ timeout: 15000 });
    const darazCard = page.locator("[class*=card], [class*=Card], [class*=border]").filter({ hasText: /daraz/i }).first();
    await expect(
      darazCard.getByRole("button", { name: /connect|manage|configure/i })
    ).toBeVisible({ timeout: 5000 });
  });

  test("Facebook card visible", async ({ page }) => {
    await navigateTo(page, "/settings/integrations");
    await expect(page.getByText(/facebook/i).first()).toBeVisible({ timeout: 15000 });
  });

  test("WhatsApp card visible", async ({ page }) => {
    await navigateTo(page, "/settings/integrations");
    await expect(page.getByText(/whatsapp/i).first()).toBeVisible({ timeout: 15000 });
  });

  test("Google Merchant card visible", async ({ page }) => {
    await navigateTo(page, "/settings/integrations");
    await expect(page.getByText(/google merchant/i).first()).toBeVisible({ timeout: 15000 });
  });

  test("clicking a channel card opens config modal or form", async ({ page }) => {
    await navigateTo(page, "/settings/integrations");
    const connectBtn = page.locator("[class*=card], [class*=Card], [class*=border]")
      .filter({ hasText: /daraz|facebook|whatsapp/i })
      .first()
      .getByRole("button", { name: /connect|manage|configure/i });
    await connectBtn.click();
    await page.waitForLoadState("networkidle");
    // Either a modal appears or we navigate to a config page
    const modalOrForm = page.getByRole("dialog").or(page.getByRole("form")).or(page.locator("[class*=modal], [class*=Modal]")).or(page.getByText(/api key|credential|secret|token|connect/i));
    await expect(modalOrForm.first()).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Shopify Integration", () => {
  test("Shopify page loads at /integrations/shopify", async ({ page }) => {
    await navigateTo(page, "/integrations/shopify");
    await expect(
      page.getByRole("heading", { name: /shopify/i }).first()
    ).toBeVisible({ timeout: 15000 });
  });

  test("Shopify overview tab renders", async ({ page }) => {
    await navigateTo(page, "/integrations/shopify");
    await page.getByRole("tab", { name: /overview/i }).or(page.getByText(/overview/i)).first().click();
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/overview|connection|status|store/i).first()).toBeVisible({ timeout: 10000 });
  });

  test("Shopify import tab renders", async ({ page }) => {
    await navigateTo(page, "/integrations/shopify");
    await page.getByRole("tab", { name: /import/i }).or(page.getByText(/import/i)).first().click();
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/import|product|sync/i).first()).toBeVisible({ timeout: 10000 });
  });

  test("Shopify mappings tab renders", async ({ page }) => {
    await navigateTo(page, "/integrations/shopify");
    await page.getByRole("tab", { name: /mapping/i }).or(page.getByText(/mapping/i)).first().click();
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/mapping|map|product|category/i).first()).toBeVisible({ timeout: 10000 });
  });

  test("Shopify sync tab renders", async ({ page }) => {
    await navigateTo(page, "/integrations/shopify");
    await page.getByRole("tab", { name: /sync/i }).or(page.getByText(/sync/i)).first().click();
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/sync|stock|inventory|order/i).first()).toBeVisible({ timeout: 10000 });
  });

  test("Shopify events tab renders", async ({ page }) => {
    await navigateTo(page, "/integrations/shopify");
    await page.getByRole("tab", { name: /event/i }).or(page.getByText(/event/i)).first().click();
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/event|webhook|log|history/i).first()).toBeVisible({ timeout: 10000 });
  });

  test("Shopify settings tab renders", async ({ page }) => {
    await navigateTo(page, "/integrations/shopify");
    await page.getByRole("tab", { name: /setting/i }).or(page.getByText(/setting/i)).first().click();
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/setting|config|credential|token/i).first()).toBeVisible({ timeout: 10000 });
  });
});

test.describe("WooCommerce Integration", () => {
  test("WooCommerce page loads with connection form", async ({ page }) => {
    await navigateTo(page, "/integrations/woocommerce");
    await expect(
      page.getByRole("heading", { name: /woocommerce/i }).first()
    ).toBeVisible({ timeout: 15000 });
    // Should have a connection form with URL/key/secret fields
    await expect(
      page.getByText(/url|store url|consumer key|secret|connect/i).first()
    ).toBeVisible({ timeout: 10000 });
  });
});
