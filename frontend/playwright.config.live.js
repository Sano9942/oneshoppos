/* eslint-env node */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/live",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["html", { outputFolder: "playwright-report-live" }], ["list"]],

  globalSetup: "./tests/live/global-setup.js",

  timeout: 60000,

  use: {
    baseURL: "https://sanopos.vercel.app",
    storageState: "./tests/live/live-auth.json",
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
