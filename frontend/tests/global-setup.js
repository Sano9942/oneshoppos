import { chromium } from "@playwright/test";
import { loginMT } from "./helpers/auth.js";
import { writeFileSync } from "fs";
import { resolve } from "path";

const AUTH_FILE = resolve(import.meta.dirname, "auth.json");
const TOKEN_FILE = resolve(import.meta.dirname, "token.json");

// Skip the packagesmall pre-login when only the sweep project is being run.
// The sweep provisions its own fresh tenant and doesn't read auth.json.
// Detection: Playwright passes --project=<name> through to argv.
function onlySweepProject() {
  const argv = process.argv.join(" ");
  return /--project[= ]sweep\b/.test(argv);
}

export default async function globalSetup() {
  if (onlySweepProject()) {
    console.log(
      "[setup] Sweep-only run detected — skipping packagesmall pre-login.",
    );
    return;
  }

  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: "https://sanopos.com" });
  const page = await context.newPage();

  console.log("\n[setup] Logging in to sanopos.com ...");
  try {
    await loginMT(page);
    console.log("[setup] Login OK — saving session");

    await context.storageState({ path: AUTH_FILE });

    const token = await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem("authSession") || "{}");
      return s.token || null;
    });
    writeFileSync(TOKEN_FILE, JSON.stringify({ token }, null, 2));
  } catch (err) {
    // packagesmall was deleted (Apr 30 2026). The 28 legacy specs still
    // target it and will all fail individually — that's tracked separately.
    // Don't let their global-setup failure block other projects (sweep).
    console.warn(
      `[setup] WARNING: packagesmall login failed (${err.message}).`,
    );
    console.warn(
      `[setup] Legacy specs targeting packagesmall will fail. Sweep is unaffected.`,
    );
  } finally {
    await browser.close();
  }
}
