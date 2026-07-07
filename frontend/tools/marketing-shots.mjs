#!/usr/bin/env node
/**
 * Marketing screenshot capture — LOCAL ONLY.
 *
 * Logs into each seeded golv_* tenant (see tools/marketing-seed/seed.mjs) and
 * captures the hero screen per industry family into
 * frontend/src/assets/marketing/raw/*.png at 1440×900 @2x.
 *
 * Usage (from frontend/): node tools/marketing-shots.mjs [shot-name ...]
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "http://localhost:5173";
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "assets", "marketing", "raw");
mkdirSync(OUT, { recursive: true });

const SHOTS = [
  { name: "retail-pos", slug: "golv_general_retail", brand: "Everline Market", route: "/pos", posSearchAdd: ["Soy Candle", "Ceramic Mug", "Olive Wood"] },
  { name: "retail-dashboard", slug: "golv_general_retail", brand: "Everline Market", route: "/dashboard" },
  { name: "restaurant-floor", slug: "golv_restaurant", brand: "Saffron House", route: "/restaurant/floor" },
  { name: "salon-calendar", slug: "golv_salon", brand: "Velvet & Vine Salon", route: "/appointments/calendar" },
  { name: "clinic-plans", slug: "golv_dental_clinic", brand: "Brightside Dental", route: "/treatment-plans" },
  { name: "gym-timetable", slug: "golv_gym", brand: "Ironworks Fitness", route: "/classes/timetable" },
  { name: "wholesale-customers", slug: "golv_wholesale", brand: "Crestline Distribution", route: "/customers" },
  { name: "rental-contracts", slug: "golv_car_rental", brand: "Metro Car Hire", route: "/rentals" },
  { name: "hotel-rooms", slug: "golv_hotel", brand: "The Juniper Hotel", route: "/rooms" },
  { name: "repair-tickets", slug: "golv_repair_shop", brand: "Circuit City Repairs", route: "/service-tickets" },
  { name: "photo-projects", slug: "golv_photography_studio", brand: "North Light Studio", route: "/projects" },
];

const wanted = process.argv.slice(2);
const list = wanted.length ? SHOTS.filter((s) => wanted.includes(s.name)) : SHOTS;

const browser = await chromium.launch();

async function login(page, slug) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder(/aceshardware/i).fill(slug);
  await page.getByPlaceholder(/employee username/i).fill("Owner");
  await page.getByPlaceholder(/enter your password/i).fill("1234");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/context-select|dashboard|setup/, { timeout: 15000 });
  // the app may auto-continue past context-select for single-outlet admins —
  // give it a moment, then only interact if we're still stuck there
  await page.waitForTimeout(1800);
  if (page.url().includes("context-select")) {
    try {
      await page.locator("div.max-h-60 button").first().click({ timeout: 4000 });
    } catch { /* may already be auto-selected */ }
    try {
      await page.getByRole("button", { name: /continue/i }).click({ timeout: 4000 });
    } catch { /* may have auto-navigated meanwhile */ }
    await page.waitForTimeout(1500);
  }
}

// Dismiss banners/onboarding cards and swap the tenant slug for the demo
// brand so screenshots read like a real business.
async function cleanup(page, slug, brandName) {
  for (let pass = 0; pass < 3; pass++) {
    const xs = page.locator("button:has(svg.lucide-x)");
    const n = await xs.count().catch(() => 0);
    let clicked = false;
    for (let i = 0; i < n; i++) {
      const b = xs.nth(i);
      if (await b.isVisible().catch(() => false)) {
        await b.click({ timeout: 1500 }).catch(() => {});
        clicked = true;
        await page.waitForTimeout(300);
        break; // DOM changed — re-query
      }
    }
    if (!clicked) break;
  }
  await page.evaluate(
    ([s, b]) => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      for (const n of nodes) {
        if (n.nodeValue && n.nodeValue.includes(s)) n.nodeValue = n.nodeValue.replaceAll(s, b);
      }
    },
    [slug, brandName]
  );
  await page.waitForTimeout(300);
}

for (const shot of list) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  // announcements are platform noise in a marketing shot — serve an empty list
  await page.route("**/api/announcements/active*", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: "[]" })
  );
  try {
    await login(page, shot.slug);
    await page.goto(`${BASE}${shot.route}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    await cleanup(page, shot.slug, shot.brand);
    if (shot.posSearchAdd) {
      const box = page.getByPlaceholder(/search products by name/i);
      for (const term of shot.posSearchAdd) {
        try {
          await box.fill(term);
          await page.waitForTimeout(900);
          await page.locator("div,button,li").filter({ hasText: new RegExp(term, "i") }).last().click({ timeout: 3000 });
          await page.waitForTimeout(500);
        } catch {
          console.log(`  (pos add "${term}" skipped)`);
        }
      }
      await page.waitForTimeout(800);
    }
    const file = path.join(OUT, `${shot.name}.png`);
    await page.screenshot({ path: file });
    console.log(`✓ ${shot.name}  (${shot.slug}${shot.route})`);
  } catch (e) {
    console.log(`✗ ${shot.name}: ${String(e.message).split("\n")[0].slice(0, 200)}`);
    try {
      await page.screenshot({ path: path.join(OUT, `${shot.name}.FAIL.png`) });
    } catch {}
  } finally {
    await ctx.close();
  }
}

await browser.close();
console.log("done.");
