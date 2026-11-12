import { navigate } from "./navigation.js";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Digest controls and feed paging. The catalog is the fixture-seeded one from
// tests/support/seed-discovery.js; no network is used.
test("digest cadence warns about short recency windows and the feed pages on request", async ({
  page,
}) => {
  test.setTimeout(90000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/#signup");
  await page.getByLabel("Your name").fill("Digest");
  await page
    .getByLabel("Email address", { exact: true })
    .fill(`digest-${Date.now()}-${Math.random()}@example.com`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("digest-browser-password");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Make your next move, Digest." }),
  ).toBeVisible();

  // Simulate a second page: the first response advertises a cursor and the
  // follow-up request (which carries it) returns an empty final page.
  const cursors = [];
  await page.route("**/api/discovery/feed?**", async (route) => {
    const url = new URL(route.request().url());
    const cursor = url.searchParams.get("cursor");
    if (cursor) {
      cursors.push(cursor);
      await route.fulfill({
        json: {
          view: "latest",
          jobs: [],
          hasMore: false,
          nextCursor: null,
          profileApproved: true,
          generatedAt: new Date().toISOString(),
        },
      });
      return;
    }
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({
      response,
      json: { ...data, hasMore: true, nextCursor: "next-page-token" },
    });
  });

  await navigate(page, "Discover");
  await page.getByRole("button", { name: "Latest", exact: true }).click();
  await expect(
    page.getByRole("article", { name: "Senior Backend Engineer" }),
  ).toBeVisible();
  await expect(page.getByText(/more available/)).toBeVisible();
  await page.getByRole("button", { name: "Load more jobs" }).click();
  await expect(
    page.getByRole("button", { name: "Load more jobs" }),
  ).toHaveCount(0);
  expect(cursors).toEqual(["next-page-token"]);
  await page.unroute("**/api/discovery/feed?**");

  // A 24-hour recency window is shorter than a weekly digest interval.
  await page.getByLabel("Recency window").selectOption("24h");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await page.getByRole("button", { name: /^Alerts/ }).click();
  await page.getByLabel("Rule name").fill("Weekly backend");
  await expect(page.getByText(/shorter than the weekly digest/)).toHaveCount(0);
  await page.getByLabel("Delivery").selectOption("weekly");
  await expect(
    page.getByText(/recency window \(24h\) is shorter than the weekly/),
  ).toBeVisible();
  await page.getByLabel("Delivery").selectOption("daily");
  await expect(page.getByText(/is shorter than the daily/)).toHaveCount(0);
  await page.getByLabel("Delivery").selectOption("weekly");
  await page.getByRole("button", { name: "Save alert rule" }).click();
  await expect(page.getByText("In-app only; no email is sent.")).toBeVisible();
  const rules = page.getByRole("list").filter({ hasText: "weekly digest" });
  await expect(rules.getByText(/Weekly backend/)).toBeVisible();
  await expect(rules.getByText(/shorter than its weekly/)).toBeVisible();

  // Digests only send on schedule; nothing is delivered early.
  await expect(page.getByText(/No digests yet/)).toBeVisible();
  await page.getByRole("button", { name: "Check for new matches now" }).click();
  await expect(page.getByText(/No digests yet/)).toBeVisible();
  await page.getByLabel("Digest time (your local time)").selectOption("6");
  await expect(page.getByText("Digest time saved.")).toBeVisible();
  await page.getByLabel("Weekly digest day").selectOption("3");
  await expect(page.getByText("Digest day saved.")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: /^Alerts/ }).click();
  await expect(page.getByLabel("Digest time (your local time)")).toHaveValue(
    "6",
  );

  const axe = await new AxeBuilder({ page }).analyze();
  expect(
    axe.violations.filter((v) => ["serious", "critical"].includes(v.impact)),
  ).toEqual([]);
  expect(errors).toEqual([]);
});
