import { test, expect } from "@playwright/test";

test("saved recovery code restores access", async ({ page }) => {
  const email = `test-recovery-${Date.now()}-${Math.random()}@example.com`;
  const password = "browser-recovery-original-123";
  const replacement = "browser-recovery-replacement-456";
  await page.goto("/#signup");
  await page.getByLabel("Your name").fill("Recovery tester");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByLabel("Current password for recovery codes", { exact: true })
    .fill(password);
  await page
    .getByRole("button", { name: "Generate new recovery codes" })
    .click();
  await expect(page.locator("pre")).toBeVisible();
  const code = (await page.locator("pre").innerText()).split("\n")[0];
  await page
    .getByRole("button", { name: "I saved these codes — dismiss" })
    .click();
  await expect(page.locator("pre")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Sign out", exact: true })
    .last()
    .click();
  await page.goto("/#signin");
  await page
    .getByRole("button", { name: "Forgot password? Use a recovery code" })
    .click();
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Recovery code", { exact: true }).fill(code);
  await page.getByLabel("New password", { exact: true }).fill(replacement);
  await page
    .getByRole("button", { name: "Reset password", exact: true })
    .click();
  await expect(
    page.getByText(
      "Password reset. Sign in, then generate new recovery codes in Settings.",
    ),
  ).toBeVisible();
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(replacement);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Settings", exact: true }),
  ).toBeVisible();
});
