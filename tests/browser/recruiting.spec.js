import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("reviewed evidence, protected fields, undo and reminder lifecycle work on each viewport", async ({
  page,
}, testInfo) => {
  test.setTimeout(60000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/#signup");
  await page.getByLabel("Your name").fill("Reviewer");
  await page
    .getByLabel("Email address", { exact: true })
    .fill(`review-${Date.now()}-${Math.random()}@example.com`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("review-browser-password");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Make your next move, Reviewer." }),
  ).toBeVisible();
  const create = async () => {
    const res = await page.request.post("/api/records/application", {
      headers: { "X-Offerly-Request": "1" },
      data: { company: "ReviewCo", title: "Engineer", stage: "Saved" },
    });
    expect(res.ok()).toBeTruthy();
    return res.json();
  };
  const app = await create();
  await create();
  const changed = await page.request.put(`/api/records/application/${app.id}`, {
    headers: { "X-Offerly-Request": "1" },
    data: { ...app, stage: "Preparing" },
  });
  expect(changed.ok()).toBeTruthy();
  await page.reload();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Reviews", exact: true })
    .click();
  await page.getByLabel("Source identifier").fill("review-source-1");
  await page
    .getByLabel("Evidence time (ISO timestamp with UTC offset)")
    .fill("2026-10-20T10:00:00-04:00");
  await page
    .getByLabel("Evidence excerpt", { exact: true })
    .fill(
      "We would like to invite you to interview. Please confirm availability.",
    );
  await page.getByLabel("Possible company").fill("ReviewCo");
  await page.getByLabel("Possible role").fill("Engineer");
  await page
    .getByLabel("User-proposed stage", { exact: true })
    .selectOption("Interviewing");
  await page.getByRole("button", { name: "Queue evidence for review" }).click();
  const review = page.getByRole("article", { name: "Review review-source-1" });
  await expect(review).toBeVisible({ timeout: 10000 });
  await expect(
    review.getByRole("button", { name: "Accept proposed update" }),
  ).toBeDisabled();
  await review
    .getByLabel("Review target application", { exact: true })
    .selectOption(app.id);
  await review.getByRole("button", { name: "Accept proposed update" }).click();
  await expect(review.getByRole("alert")).toContainText("Manual field lock");
  await review.getByRole("checkbox").check();
  await review.getByRole("button", { name: "Accept proposed update" }).click();
  await expect(review.getByText("accepted", { exact: true })).toBeVisible();
  await review.getByRole("button", { name: "Undo review decision" }).click();
  await expect(review.getByText("undone", { exact: true })).toBeVisible();
  const workspace = await (await page.request.get("/api/workspace")).json();
  expect(workspace.applications.find((a) => a.id === app.id).stage).toBe(
    "Preparing",
  );
  expect(
    workspace.fieldLocks.find((l) => l.applicationId === app.id).locked,
  ).toBe(true);
  const axe = await new AxeBuilder({ page })
    .include("main")
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(
    axe.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/recruiting-${testInfo.project.name}.png`,
    fullPage: true,
    animations: "disabled",
  });
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Today", exact: true })
    .click();
  const reminders = page.getByRole("region", { name: "In-app reminders" });
  await reminders.getByText("Add reminder", { exact: true }).click();
  await reminders
    .getByLabel("Reminder title")
    .fill("Prepare thoughtful questions");
  await reminders
    .getByLabel("Reminder application", { exact: true })
    .selectOption(app.id);
  await reminders
    .getByLabel("Reminder date", { exact: true })
    .fill("2020-01-01");
  await reminders.getByRole("button", { name: "Create reminder" }).click();
  await expect(reminders.getByText(/Due · 2020-01-01/)).toBeVisible();
  await reminders
    .getByLabel("Snooze date for Prepare thoughtful questions")
    .fill("2099-01-01");
  await reminders
    .getByRole("button", {
      name: "Snooze Prepare thoughtful questions",
      exact: true,
    })
    .click();
  await expect(reminders.getByText(/Scheduled · 2099-01-01/)).toBeVisible();
  await reminders
    .getByRole("button", {
      name: "Dismiss Prepare thoughtful questions",
      exact: true,
    })
    .click();
  await expect(reminders.getByText("No active reminders.")).toBeVisible();
  await page.reload();
  await expect(reminders.getByText("No active reminders.")).toBeVisible();
  expect(errors).toEqual([]);
});
