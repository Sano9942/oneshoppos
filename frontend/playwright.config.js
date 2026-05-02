import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "*.spec.js",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["html", { outputFolder: "playwright-report" }], ["list"]],

  globalSetup: "./tests/global-setup.js",

  timeout: 60000,

  use: {
    baseURL: "https://sanopos.com",
    storageState: "./tests/auth.json",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 15000,
    navigationTimeout: 30000,
  },

  projects: [
    {
      name: "chromium",
      testIgnore: /sweep\//,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // Full real-user sweep project — option 2.
      // Provisions a fresh tenant via signup, walks every feature, leaves
      // tenant alive for manual cleanup. ~3–4 hour run time, headed-only.
      // Does NOT use the shared auth.json — sweep logs in as the new
      // tenant's admin during the run.
      name: "sweep",
      testMatch: /sweep\/.*\.spec\.js/,
      timeout: 4 * 60 * 60 * 1000, // 4h per spec
      use: {
        ...devices["Desktop Chrome"],
        storageState: undefined,
        headless: false,
        launchOptions: {
          slowMo: 200,
        },
        actionTimeout: 30000,
        navigationTimeout: 60000,
        trace: "on",
        video: "retain-on-failure",
        screenshot: "only-on-failure",
      },
    },
  ],
});
