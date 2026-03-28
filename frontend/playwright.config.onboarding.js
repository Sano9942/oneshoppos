/* eslint-env node */
import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for onboarding E2E tests (21–23).
 * No global setup — these tests handle their own auth.
 */
export default defineConfig({
  testDir: "./tests/live",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["html", { outputFolder: "playwright-report-onboarding" }], ["list"]],

  timeout: 120000,

  use: {
    baseURL: "https://sanopos.com",
    // No storageState — each test manages its own auth
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 30000,
    navigationTimeout: 45000,
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
