import { chromium } from "@playwright/test";
import { loginMT, STORE_CODE, USERNAME } from "./helpers/auth.js";
import { writeFileSync } from "fs";
import { resolve } from "path";

const AUTH_FILE = resolve(import.meta.dirname, "auth.json");
const TOKEN_FILE = resolve(import.meta.dirname, "token.json");

// Skip the shared-tenant pre-login when only the sweep project is being run.
// The sweep provisions its own fresh tenant and doesn't read auth.json.
// Detection: Playwright passes --project=<name> through to argv.
function onlySweepProject() {
  const argv = process.argv.join(" ");
  return /--project[= ]sweep\b/.test(argv);
}

export default async function globalSetup() {
  if (onlySweepProject()) {
    console.log(
      "[setup] Sweep-only run detected — skipping shared-tenant pre-login.",
    );
    return;
  }

  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: "https://sanopos.com" });
  const page = await context.newPage();

  console.log(`\n[setup] Logging in to sanopos.com as ${USERNAME}@${STORE_CODE} ...`);
  try {
    await loginMT(page);
    console.log("[setup] Login OK — saving session");

    await context.storageState({ path: AUTH_FILE });

    const token = await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem("authSession") || "{}");
      return s.token || null;
    });
    if (!token) {
      throw new Error(
        "login reached /dashboard but localStorage held no authSession token — " +
          "helpers/api.js would send `Bearer null` on every call",
      );
    }
    writeFileSync(TOKEN_FILE, JSON.stringify({ token }, null, 2));
  } catch (err) {
    // HARD FAIL — do not warn-and-continue.
    //
    // This used to warn and return, so a dead shared tenant produced a run that
    // *looked* green: specs proceeded with a stale auth.json (or none), hit
    // redirects/empty pages, and their assertions no-op'd or skipped. A test
    // suite that cannot authenticate proves nothing, and saying so loudly is
    // the whole point of the net. Sweep is unaffected — it skips this setup
    // entirely (see onlySweepProject above), so failing here cannot block it.
    throw new Error(
      `[setup] ABORTING: could not log in to the shared test tenant ` +
        `"${STORE_CODE}" as "${USERNAME}".\n` +
        `  Cause: ${err.message}\n` +
        `  These specs run against PRODUCTION and are meaningless without a session.\n` +
        `  Fix: confirm the tenant + employee still exist in /admin, or point the\n` +
        `  run at another tenant without touching code:\n` +
        `    E2E_TENANT=<slug> E2E_USERNAME="<Employee Name>" E2E_PASSWORD=<pw> E2E_PIN=<pin> npx playwright test\n` +
        `  (The sweep project provisions its own tenant: npx playwright test --project=sweep)`,
    );
  } finally {
    await browser.close();
  }
}
