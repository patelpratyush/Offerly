import { navigate } from "./navigation.js";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
async function account(page) {
  await page.goto("/#signup");
  await page.getByLabel("Your name").fill("Morgan");
  await page
    .getByLabel("Email address")
    .fill(`test-tracking-${Date.now()}-${Math.random()}@example.com`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("workspace-test-password");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Make your next move, Morgan." }),
  ).toBeVisible();
}
async function create(page, kind, data) {
  const r = await page.request.post("/api/records/" + kind, {
    data,
    headers: { "X-Offerly-Request": "1" },
  });
  expect(r.ok()).toBeTruthy();
  return r.json();
}

test("guided CSV mapping, duplicate decisions, archive undo and shared filters", async ({
  page,
}) => {
  await account(page);
  await navigate(page, /Applications/);
  await page.getByRole("button", { name: "Import CSV" }).click();
  const dialog = page.getByRole("dialog", { name: "Import applications" });
  await dialog.getByLabel("Choose CSV").setInputFiles({
    name: "my-search.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "Employer,Position,Submitted,Channel,Arrangement,ID\nAcme,Backend Engineer,03/04/2026,Referral,Remote,A1\nAcme,Backend Engineer,03/04/2026,Referral,Remote,A1\nAcme,Data Engineer,06/04/2026,Careers,Hybrid,A2\nBeta,Designer,,Careers,On-site,B1\n,Incomplete role,,Careers,On-site,B2",
    ),
  });
  await dialog
    .getByLabel("Map Company", { exact: true })
    .selectOption("Employer");
  await dialog.getByLabel("Map Role title").selectOption("Position");
  await dialog.getByLabel("Map Applied date").selectOption("Submitted");
  await dialog.getByLabel("Map Source").selectOption("Channel");
  await dialog.getByLabel("Map Work arrangement").selectOption("Arrangement");
  await dialog.getByLabel("Map Requisition ID").selectOption("ID");
  await dialog.getByLabel("CSV date format").selectOption("DMY");
  await dialog.getByRole("button", { name: "Preview import" }).click();
  await expect(
    dialog.getByText("Acme · Saved · 2026-04-03").first(),
  ).toBeVisible();
  await expect(
    dialog.getByText("Company: enter a value.", { exact: true }),
  ).toBeVisible();
  await expect(dialog).not.toContainText('"invalid_type"');
  await expect(dialog.getByLabel("Decision for row 6")).toHaveCount(0);
  await expect(dialog.getByLabel("Decision for row 3")).toHaveValue("skip");
  await dialog.getByLabel("Decision for row 3").selectOption("keep");
  await dialog.getByRole("button", { name: "Import 4 applications" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(5);
  await page.getByRole("button", { name: /Review duplicates/ }).click();
  const review = page.getByRole("dialog", { name: "Duplicate review" });
  await expect(
    review.getByText("Same employer and requisition ID"),
  ).toBeVisible();
  await review
    .getByRole("button", { name: "Archive this application" })
    .last()
    .click();
  await expect(
    review.getByRole("heading", { name: "All caught up." }),
  ).toBeVisible();
  await review.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(
    review.getByText("Same employer and requisition ID"),
  ).toBeVisible();
  await review
    .getByRole("button", { name: /These are different applications/ })
    .click();
  await expect(
    review.getByRole("heading", { name: "All caught up." }),
  ).toBeVisible();
  await review.getByRole("button", { name: "Close duplicate review" }).click();
  await page.getByText("More filters", { exact: false }).first().click();
  await page.getByLabel("Source filter").selectOption("Careers");
  await page.getByLabel("Applied from", { exact: true }).fill("2026-04-01");
  await page.getByLabel("Applied through", { exact: true }).fill("2026-04-30");
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(2);
  await expect(page.getByRole("table")).toContainText("Data Engineer");
  await page.getByLabel("Include unknown dates in date range").check();
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(3);
  await page.getByRole("button", { name: "Board view" }).click();
  await expect(page.locator(".board .job-card")).toHaveCount(2);
  await page.getByLabel("Work arrangement filter").selectOption("Hybrid");
  await expect(page.locator(".board .job-card")).toHaveCount(1);
  await expect(page.locator(".board .job-card")).toContainText("Data Engineer");
  await page.reload();
  await navigate(page, /Applications/);
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(5);
});

test("assessment deadlines, activity timeline and polished responsive pipeline", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await account(page);
  const fixtures = [
    ["Northstar", "Backend Engineer", "Interviewing", "Remote", "High"],
    ["Linear Labs", "Product Engineer", "Submitted", "Hybrid", "High"],
    ["Arcadia", "Data Engineer", "Assessment", "Remote", "Medium"],
    ["Forma", "Software Engineer", "Saved", "On-site", "Medium"],
    ["Canvas Works", "Frontend Engineer", "Under review", "Remote", "Medium"],
    ["Evergreen", "Platform Engineer", "Offer", "Hybrid", "High"],
  ];
  const apps = [];
  for (let i = 0; i < fixtures.length; i++) {
    const [company, title, stage, workArrangement, priority] = fixtures[i];
    apps.push(
      await create(page, "application", {
        company,
        title,
        stage,
        workArrangement,
        priority,
        location: i % 2 ? "New York, NY" : "Remote · US",
        source: i % 2 ? "Referral" : "Careers page",
        owner: i % 2 ? "Employer" : "You",
        appliedDate: `2026-10-${String(i + 10).padStart(2, "0")}`,
        notes: "Focus on the team’s product and engineering priorities.",
      }),
    );
  }
  await create(page, "task", {
    title: "Prepare project walkthrough",
    applicationId: apps[0].id,
    due: "2027-01-14",
  });
  await create(page, "task", {
    title: "Send portfolio to recruiter",
    applicationId: apps[1].id,
    due: "2027-01-15",
  });
  await create(page, "round", {
    title: "Engineering team conversation",
    applicationId: apps[0].id,
    status: "Scheduled",
    date: "2027-01-15",
    time: "10:30",
    timezone: "America/New_York",
  });
  await create(page, "assessment", {
    title: "Data modeling exercise",
    applicationId: apps[2].id,
    due: "2027-01-18",
  });
  await page.reload();
  await expect(page.getByText("Data modeling exercise")).toBeVisible();
  await page.screenshot({
    path: `test-results/redesign-today-${test.info().project.name}.png`,
    fullPage: true,
    animations: "disabled",
  });
  await navigate(page, /Applications/);
  await page.getByRole("button", { name: "Board view" }).click();
  await page.screenshot({
    path: `test-results/redesign-board-${test.info().project.name}.png`,
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Table view" }).click();
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(
    accessibility.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
  await page.screenshot({
    path: `test-results/redesign-table-${test.info().project.name}.png`,
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: /Data Engineer Arcadia/ }).click();
  const detail = page.getByRole("dialog", { name: "Application details" });
  await detail.getByRole("button", { name: /Data modeling exercise/ }).click();
  const assessment = page.getByRole("dialog", { name: "assessment editor" });
  await assessment.getByLabel("Assessment status").selectOption("Completed");
  await assessment.getByLabel("Completion date").fill("2026-10-19");
  await assessment.getByLabel("Result or score (optional)").fill("Passed");
  await assessment.getByRole("button", { name: "Save assessment" }).click();
  await expect(
    detail.getByRole("button", { name: /Data modeling exercise.*Completed/ }),
  ).toBeVisible();
  await detail.getByRole("button", { name: "Activity", exact: true }).click();
  await expect(
    detail.getByText("Assessment: Not started → Completed"),
  ).toBeVisible();
  await expect(detail.getByText("Passed", { exact: true })).toBeVisible();
  await page.screenshot({
    path: `test-results/redesign-detail-${test.info().project.name}.png`,
    fullPage: true,
    animations: "disabled",
  });
  await detail.getByRole("button", { name: "Close details" }).click();
  await navigate(page, "Today");
  await expect(page.getByText("No assessment deadlines.")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("saved views survive reload and bulk edits work in table and board", async ({
  page,
}) => {
  await account(page);
  await create(page, "application", {
    company: "Acme",
    title: "Backend Engineer",
    stage: "Saved",
    workArrangement: "Remote",
  });
  await create(page, "application", {
    company: "Beta",
    title: "Data Engineer",
    stage: "Saved",
    workArrangement: "On-site",
  });
  await page.reload();
  await navigate(page, /Applications/);
  await page.getByText("More filters", { exact: false }).click();
  await page.getByLabel("Work arrangement filter").selectOption("Remote");
  await page.getByText("Save or manage views", { exact: true }).click();
  await page.getByLabel("View name").fill("Remote roles");
  await page.getByRole("button", { name: "Save new view" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "View saved" }),
  ).toContainText("View saved");
  await page.reload();
  await navigate(page, /Applications/);
  await page
    .getByLabel("Saved view", { exact: true })
    .selectOption({ label: "Remote roles" });
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(2);
  await page.getByLabel("Select Acme · Backend Engineer").check();
  await page.getByLabel("Bulk value").selectOption("High");
  await page.getByRole("button", { name: "Apply to 1 selected" }).click();
  await expect(page.getByRole("table")).toContainText("High");
  await expect(
    page.getByRole("region", { name: "Bulk application editor" }),
  ).toBeHidden();
  await page.getByRole("button", { name: "Board view" }).click();
  await page.getByText("Save or manage views", { exact: true }).click();
  await page.getByRole("button", { name: "Update view", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "View updated" }),
  ).toContainText("View updated");
  await page.getByLabel("Select Acme · Backend Engineer").check();
  await page.getByLabel("Bulk field").selectOption("archived");
  await page.getByRole("button", { name: "Apply to 1 selected" }).click();
  await expect(
    page.getByRole("button", { name: /Backend Engineer/ }),
  ).toHaveCount(0);
  await page.getByLabel("Show archived").check();
  await expect(
    page.getByRole("button", { name: /Backend Engineer/ }),
  ).toBeVisible();
  await page.getByLabel("Select Acme · Backend Engineer").check();
  await page.getByLabel("Bulk value").selectOption("Restore");
  await page.getByRole("button", { name: "Apply to 1 selected" }).click();
  await page.getByLabel("Show archived").uncheck();
  await expect(
    page.getByRole("button", { name: /Backend Engineer/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Remove view" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Saved view removed" }),
  ).toContainText("Saved view removed");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("duplicate merge previews links and undo restores them", async ({
  page,
}) => {
  await account(page);
  const left = await create(page, "application", {
    company: "MergeCo",
    title: "Engineer",
    stage: "Saved",
  });
  const right = await create(page, "application", {
    company: "MergeCo",
    title: "Engineer",
    stage: "Submitted",
  });
  await create(page, "task", {
    title: "Contact recruiter",
    applicationId: right.id,
  });
  await create(page, "contact", {
    name: "Riley Recruiter",
    applicationIds: [right.id],
  });
  await page.reload();
  await navigate(page, /Applications/);
  await page.getByRole("button", { name: /Review duplicates/ }).click();
  const dialog = page.getByRole("dialog", { name: "Duplicate review" });
  await dialog
    .getByRole("button", { name: "Preview merge into left application" })
    .click();
  const preview = dialog.getByRole("region", { name: "Merge preview" });
  await expect(preview).toContainText("Contact recruiter");
  await expect(preview).toContainText("Riley Recruiter");
  await preview.getByRole("button", { name: "Confirm merge" }).click();
  await expect(dialog).toContainText("Merged applications");
  let w = await (await page.request.get("/api/workspace")).json();
  expect(w.tasks[0].applicationId).toBe(left.id);
  await dialog.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Preview merge into left application" }),
  ).toBeVisible();
  w = await (await page.request.get("/api/workspace")).json();
  expect(w.tasks[0].applicationId).toBe(right.id);
});

test("expired sessions discard private dialogs and filters before another account signs in", async ({
  page,
}) => {
  await account(page);
  await create(page, "application", {
    company: "PrivateCo",
    title: "Private role",
    stage: "Saved",
    notes: "Private prior-account notes",
  });
  await page.reload();
  await navigate(page, /Applications/);
  await page.getByLabel("Search applications").fill("PrivateCo");
  await page.getByRole("button", { name: "Open Private role" }).click();
  const detail = page.getByRole("dialog", { name: "Application details" });
  await expect(detail).toContainText("Private prior-account notes");
  const logout = await page.request.post("/api/logout", {
    data: {},
    headers: { "X-Offerly-Request": "1" },
  });
  expect(logout.ok()).toBeTruthy();
  await detail.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page.getByLabel("Your name")).toBeVisible();
  await page.getByLabel("Your name").fill("New Account");
  await page
    .getByLabel("Email address")
    .fill(`fresh-${Date.now()}-${Math.random()}@example.com`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("new-workspace-password");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Make your next move, New." }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("Private prior-account notes")).toHaveCount(0);
  await navigate(page, /Applications/);
  await expect(page.getByLabel("Search applications")).toHaveValue("");
});

test("late timeline responses cannot replace the currently open application history", async ({
  page,
}) => {
  await account(page);
  const first = await create(page, "application", {
    company: "FirstCo",
    title: "First role",
    stage: "Saved",
    notes: "History for first role",
  });
  await create(page, "application", {
    company: "SecondCo",
    title: "Second role",
    stage: "Saved",
    notes: "History for second role",
  });
  await page.reload();
  await navigate(page, /Applications/);
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let fetched;
  const ready = new Promise((resolve) => {
    fetched = resolve;
  });
  await page.route(`**/api/events/${first.id}`, async (route) => {
    const response = await route.fetch();
    fetched();
    await gate;
    await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "Open First role" }).click();
  await ready;
  await page.getByRole("button", { name: "Close details" }).click();
  await page.getByRole("button", { name: "Open Second role" }).click();
  const detail = page.getByRole("dialog", { name: "Application details" });
  await detail.getByRole("button", { name: "Activity", exact: true }).click();
  await expect(detail).toContainText("History for second role");
  const delivered = page.waitForResponse(`**/api/events/${first.id}`);
  release();
  await delivered;
  await expect(page.locator(".shell")).toHaveAttribute("aria-busy", "false");
  await expect(detail).toContainText("History for second role");
  await expect(detail).not.toContainText("History for first role");
});

test("signing out clears private state in other open tabs", async ({
  page,
  context,
}) => {
  await account(page);
  await create(page, "application", {
    company: "TabsCo",
    title: "Private tab role",
    stage: "Saved",
  });
  const second = await context.newPage();
  try {
    await second.goto("/#signup");
    await navigate(second, /Applications/);
    await second.getByRole("button", { name: "Open Private tab role" }).click();
    await expect(
      second.getByRole("dialog", { name: "Application details" }),
    ).toBeVisible();
    await navigate(page, "Settings");
    await page
      .getByRole("main")
      .getByRole("button", { name: "Sign out", exact: true })
      .click();
    await expect(page.getByLabel("Your name")).toBeVisible();
    await expect(second.getByLabel("Your name")).toBeVisible();
    await expect(second.getByRole("dialog")).toHaveCount(0);
  } finally {
    await second.close();
  }
});
