import { test, expect } from "@playwright/test";

test("sign-in transition preserves email filled before hashchange renders", async ({
  page,
}) => {
  await page.goto("/#signup");
  await expect(
    page.getByRole("button", { name: "Already have an account? Sign in" }),
  ).toBeVisible();
  const email = "fast-autofill@example.test";
  // Browser autofill can run in the same task as clicking the auth-mode link,
  // before the asynchronous hashchange event renders the new mode.
  await page.evaluate((value) => {
    const toggle = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "Already have an account? Sign in",
    );
    toggle.click();
    document.querySelector('input[name="email"]').value = value;
  }, email);
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Email address")).toHaveValue(email);
});
