import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: process.env.VTC_FAILURE_PROBE === "assertion" ? "test/probes" : "test/e2e",
  testMatch: "**/*.spec.ts",
  outputDir: ".local/testing/browser-results",
  reporter: "list",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 20000,
  use: {
    baseURL: "http://127.0.0.1:4173",
    browserName: "chromium",
    locale: "en-GB",
    timezoneId: "UTC",
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop-chromium", use: { viewport: { width: 1280, height: 800 } } },
    { name: "tablet-chromium", use: { viewport: { width: 768, height: 1024 } } },
    {
      name: "mobile-chromium",
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
  ],
  // The command validates its allocation, migrates it, and starts the built API/SPA.
  webServer: {
    command: "node --import tsx test/e2e/support/server.ts",
    url: "http://127.0.0.1:4173/health/ready",
    reuseExistingServer: false,
    timeout: 20000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 3000 },
  },
});
