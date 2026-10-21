import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("public landing previews stages and connects signup, sign-in, and home", async ({
  page,
}, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Big possibilities. A little more headspace.",
    }),
  ).toBeVisible();
  await expect(page.getByLabel("Your name")).toHaveCount(0);
  const preview = page.locator("#workspace-preview");
  const movingCard = preview.locator(".lp-job-card");
  const initialTransform = await movingCard.evaluate(
    (element) => getComputedStyle(element).transform,
  );
  await expect
    .poll(() =>
      movingCard.evaluate((element) => getComputedStyle(element).transform),
    )
    .not.toBe(initialTransform);
  await page.getByRole("button", { name: "Pause page motion" }).click();
  await expect(movingCard).toHaveCSS("animation-play-state", "paused");
  await expect(page.locator(".lp-ribbon-track")).toHaveCSS(
    "animation-play-state",
    "paused",
  );
  await expect(page.locator(".lp-bloom-petals").first()).toHaveCSS(
    "animation-play-state",
    "paused",
  );
  await expect(page.locator(".lp-coffee-steam").first()).toHaveCSS(
    "animation-play-state",
    "paused",
  );
  await page.getByRole("button", { name: "Play page motion" }).click();
  await expect(movingCard).toHaveCSS("animation-play-state", "running");
  await preview.getByRole("button", { name: "Offer" }).click();
  await expect(
    preview.getByRole("heading", { name: "Senior Designer" }),
  ).toBeVisible();
  await expect(preview.getByRole("button", { name: "Offer" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await preview.getByRole("button", { name: "Saved" }).click();
  await expect(
    preview.getByRole("heading", { name: "Product Designer" }),
  ).toBeVisible();
  await page
    .getByText("Do I need to connect my inbox?", { exact: true })
    .click();
  await expect(
    page.getByText("Automatic inbox connections are not currently available.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  await page.getByRole("button", { name: "Pause animation" }).click();
  await expect(
    page.getByRole("button", { name: "Play animation" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".lp-coffee-steam").first()).toHaveCSS(
    "animation-play-state",
    "paused",
  );
  await expect(movingCard).toHaveCSS("animation-play-state", "paused");
  await expect(page.locator(".lp-headspace")).toHaveAttribute(
    "data-revealed",
    "true",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".lp-coffee-steam").first()).toHaveCSS(
    "animation-name",
    "none",
  );
  await expect(
    page.getByRole("button", { name: "Play animation" }),
  ).toBeHidden();
  await expect(movingCard).toHaveCSS("animation-name", "none");
  await expect(page.locator(".lp-ribbon-track")).toHaveCSS(
    "animation-name",
    "none",
  );
  await expect(page.locator(".lp-bloom-petals").first()).toHaveCSS(
    "animation-name",
    "none",
  );
  await expect(
    page.getByRole("button", { name: "Play page motion" }),
  ).toBeHidden();
  await page.emulateMedia({ reducedMotion: "no-preference" });
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

  await page.getByRole("link", { name: "Make room for what’s next" }).click();
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
      name: "Big possibilities. A little more headspace.",
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
        name: "Big possibilities. A little more headspace.",
      }),
    ).toBeVisible();
    for (const name of [
      "Get started",
      "Sign in",
      "Make room for what’s next",
    ]) {
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
