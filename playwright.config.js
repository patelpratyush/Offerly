import { defineConfig } from "@playwright/test";
export default defineConfig({
  workers: 2,
  testDir: "./tests/browser",
  use: { baseURL: "http://127.0.0.1:4173", headless: true },
  webServer: {
    command: "node tests/support/serve.js",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 } } },
  ],
});
