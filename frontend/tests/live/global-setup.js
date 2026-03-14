import { chromium } from "@playwright/test";
import { loginMT } from "./helpers/auth.js";
import { writeFileSync, existsSync } from "fs";
import { resolve } from "path";

const STATE_FILE = resolve(import.meta.dirname, "state.json");
const AUTH_FILE = resolve(import.meta.dirname, "live-auth.json");
const TOKEN_FILE = resolve(import.meta.dirname, "live-token.json");

export default async function globalSetup() {
  // Only initialise state.json if it doesn't exist yet — preserve state written
  // by earlier specs so sequential runs (01, 02, …) can read what 00-setup wrote.
  if (!existsSync(STATE_FILE)) {
    writeFileSync(STATE_FILE, JSON.stringify({}, null, 2));
  }

  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: "https://sanopos.vercel.app" });
  const page = await context.newPage();

  console.log("\n🔐 Global setup: logging in to sanopos.vercel.app...");
  await loginMT(page);
  console.log("✅ Login successful — saving session to live-auth.json");

  await context.storageState({ path: AUTH_FILE });

  // Extract JWT token and save to file so api.js can use it without page.evaluate
  const token = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("authSession") || "{}");
    return s.token || null;
  });
  writeFileSync(TOKEN_FILE, JSON.stringify({ token }, null, 2));
  console.log("✅ Token saved to live-token.json");

  await browser.close();
}
