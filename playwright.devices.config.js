import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config.js";

export default defineConfig({
  ...base,
  testMatch: "devices.spec.js",
  testIgnore: [],
  use: { ...base.use, reducedMotion: "reduce" },
  projects: [
    {
      name: "android",
      use: { ...devices["Pixel 7"], browserName: "chromium" },
    },
    { name: "iphone", use: { ...devices["iPhone 13"], browserName: "webkit" } },
    { name: "ipad", use: { ...devices["iPad Pro 11"], browserName: "webkit" } },
    {
      name: "firefox",
      use: { browserName: "firefox", viewport: { width: 1280, height: 720 } },
    },
    {
      name: "compact",
      use: {
        browserName: "chromium",
        viewport: { width: 320, height: 568 },
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      name: "ultrawide",
      use: { browserName: "chromium", viewport: { width: 2560, height: 1440 } },
    },
  ],
});
