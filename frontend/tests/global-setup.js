import { chromium } from "@playwright/test";
import { loginMT } from "./helpers/auth.js";
import { writeFileSync } from "fs";
import { resolve } from "path";

const AUTH_FILE = resolve(import.meta.dirname, "auth.json");
const TOKEN_FILE = resolve(import.meta.dirname, "token.json");

export default async function globalSetup() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: "https://sanopos.com" });
  const page = await context.newPage();

  console.log("\n[setup] Logging in to sanopos.com ...");
  await loginMT(page);
  console.log("[setup] Login OK — saving session");

  await context.storageState({ path: AUTH_FILE });

  const token = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("authSession") || "{}");
    return s.token || null;
  });
  writeFileSync(TOKEN_FILE, JSON.stringify({ token }, null, 2));

  await browser.close();
}
