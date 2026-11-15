import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("public landing previews the workspace and connects signup, sign-in, and home", async ({
  page,
}, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Every application, contact and next step in one place.",
    }),
  ).toBeVisible();
  await expect(page.getByLabel("Your name")).toHaveCount(0);
  const preview = page.locator("#workspace-preview");
  await expect(preview).toContainText("Sample data · fictional employers");
  await expect(preview.getByText("Senior Product Designer")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Gmail import with a review queue" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Optional read-only Gmail is available only when configured for your account.",
      { exact: false },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Private by default" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("landing-full.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath("landing-hero.png"),
    animations: "disabled",
  });
  const a11y = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    a11y.violations.map((item) => ({
      id: item.id,
      nodes: item.nodes.map((node) => node.target),
    })),
  ).toEqual([]);

  await page.getByRole("link", { name: "Start your workspace" }).click();
  await expect(page.getByLabel("Your name")).toBeVisible();
  await page
    .getByRole("button", { name: "Already have an account? Sign in" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
  await expect(page.getByLabel("Your name")).toHaveCount(0);
  await page.getByRole("link", { name: "Offerly home" }).click();
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Every application, contact and next step in one place.",
    }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("landing keeps account entry controls inside narrow and tablet viewports", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [320, 820]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Every application, contact and next step in one place.",
      }),
    ).toBeVisible();
    for (const name of ["Get started", "Sign in", "Start your workspace"]) {
      const link = page.getByRole("link", { name, exact: true });
      const box = await link.boundingBox();
      expect(box).not.toBeNull();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
});
