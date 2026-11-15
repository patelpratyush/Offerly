import { defineConfig } from "@playwright/test";
// E2E_WEB_PORT / E2E_API_PORT let parallel local runs use separate servers.
const web = process.env.E2E_WEB_PORT || "4173";
export default defineConfig({
  workers: 2,
  testDir: "./tests/browser",
  testIgnore: "**/devices.spec.js",
  use: { baseURL: `http://127.0.0.1:${web}`, headless: true },
  webServer: {
    command: "node tests/support/serve.js",
    // Wait for the API behind Vite too; homepage readiness alone can race
    // mobile tests against backend startup after desktop project shuts down.
    url: `http://127.0.0.1:${web}/api/auth/config`,
    reuseExistingServer: false,
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 } } },
  ],
});
