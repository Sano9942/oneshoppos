#!/usr/bin/env node
/**
 * Marketing-site verification sweep — LOCAL ONLY.
 * Visits every marketing route at desktop + key routes at mobile width,
 * captures full-page screenshots to docs/fable5/marketing-site/screens/,
 * collects console errors, and runs the signup-render + login E2E checks.
 *
 * Usage (from frontend/): node tools/marketing-verify.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "http://localhost:5173";
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "fable5", "marketing-site", "screens");
mkdirSync(OUT, { recursive: true });

const ROUTES = [
  ["home", "/"],
  ["industries", "/industries"],
  ["industry-retail", "/industries/retail"],
  ["industry-restaurants", "/industries/restaurants"],
  ["industry-salons", "/industries/salons"],
  ["industry-clinics", "/industries/clinics"],
  ["industry-gyms", "/industries/gyms"],
  ["industry-wholesale", "/industries/wholesale"],
  ["industry-rentals", "/industries/rentals"],
  ["industry-hotels", "/industries/hotels"],
  ["industry-repair", "/industries/repair-shops"],
  ["industry-photographers", "/industries/photographers"],
  ["pricing", "/pricing"],
  ["why-sanopos", "/why-sanopos"],
];

const browser = await chromium.launch();
const errors = [];

async function sweep(viewport, tag, routes) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`[${tag}] ${page.url()} :: ${m.text().slice(0, 160)}`);
  });
  page.on("pageerror", (e) => errors.push(`[${tag}] ${page.url()} :: PAGEERROR ${String(e).slice(0, 160)}`));
  for (const [name, route] of routes) {
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1600);
    await page.screenshot({ path: path.join(OUT, `${name}${tag === "mobile" ? "-mobile" : ""}.png`), fullPage: true });
    console.log(`✓ ${tag} ${route}`);
  }
  await ctx.close();
}

await sweep({ width: 1280, height: 800 }, "desktop", ROUTES);
await sweep({ width: 390, height: 844 }, "mobile", [ROUTES[0], ROUTES[2], ROUTES[12]]);

// ── signup renders + login E2E ────────────────────────────────
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();

await page.goto(`${BASE}/signup`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
const signupOk = await page.getByText(/free plan/i).first().isVisible().catch(() => false);
await page.screenshot({ path: path.join(OUT, "signup.png"), fullPage: false });
console.log(`signup page renders: ${signupOk ? "OK" : "CHECK MANUALLY"}`);

await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.getByPlaceholder(/aceshardware/i).fill("golv_general_retail");
await page.getByPlaceholder(/employee username/i).fill("Owner");
await page.getByPlaceholder(/enter your password/i).fill("1234");
await page.getByRole("button", { name: /sign in/i }).click();
await page.waitForURL(/context-select|dashboard/, { timeout: 15000 });
await page.waitForTimeout(2500);
const loginOk = /dashboard|context-select/.test(page.url());
console.log(`login E2E: ${loginOk ? "OK" : "FAILED"} (${page.url()})`);
await ctx.close();

await browser.close();
console.log(errors.length ? `\nCONSOLE ERRORS (${errors.length}):\n` + errors.join("\n") : "\nno console errors.");
