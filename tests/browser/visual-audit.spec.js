import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { navigate } from "./navigation.js";

// Every record below is synthetic and exists only in the temporary browser-test DB.
test("redesigned main pages stay usable with real synthetic workspace data", async ({
  page,
}, testInfo) => {
  test.setTimeout(90000);
  const directory = "reference/flavor-2026-11/screenshots";
  mkdirSync(directory, { recursive: true });
  const errors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const post = async (path, data) => {
    const response = await page.request.post(`/api${path}`, {
      headers: { "X-Offerly-Request": "1" },
      data,
    });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator("h1")).toBeVisible();
  await page.screenshot({
    path: `${directory}/landing-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.goto("/signin");
  await expect(page.getByLabel("Email address")).toBeVisible();
  await page.screenshot({
    path: `${directory}/signin-${testInfo.project.name}.png`,
    fullPage: true,
  });
  const signInAudit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect
    .soft(
      signInAudit.violations.map((v) => ({
        id: v.id,
        targets: v.nodes.map((n) => n.target),
      })),
      "Sign in",
    )
    .toEqual([]);
  await page.goto("/signup");
  await expect(page.getByLabel("Your name")).toBeVisible();
  await page.screenshot({
    path: `${directory}/signup-${testInfo.project.name}.png`,
    fullPage: true,
  });
  const signUpAudit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect
    .soft(
      signUpAudit.violations.map((v) => ({
        id: v.id,
        targets: v.nodes.map((n) => n.target),
      })),
      "Sign up",
    )
    .toEqual([]);
  await post("/auth/register", {
    name: "Taylor Morgan",
    email: `visual-${Date.now()}-${Math.random()}@example.test`,
    password: "visual-audit-password",
    timezone: "America/New_York",
  });
  const application = await post("/records/application", {
    company: "Northstar Studio",
    title: "Product Engineer",
    stage: "Interviewing",
    owner: "You",
    priority: "High",
    appliedDate: "2026-10-28",
    location: "New York, NY",
    notes:
      "Synthetic portfolio conversation. Prepare examples of accessible product work.",
  });
  await post("/records/application", {
    company: "Northstar Studio",
    title: "Platform Engineer",
    stage: "Submitted",
    owner: "Employer",
    priority: "Medium",
    appliedDate: "2026-11-02",
    location: "Remote",
  });
  await post("/records/application", {
    company: "Fieldwork Labs",
    title: "Frontend Engineer",
    stage: "Saved",
    owner: "You",
    priority: "Medium",
    location: "Brooklyn, NY",
  });
  await post("/records/task", {
    title: "Prepare project walkthrough",
    applicationId: application.id,
    due: "2026-11-05",
    done: false,
  });
  await post("/records/contact", {
    name: "Alex Rivera",
    email: "alex@example.test",
    role: "Recruiter",
    company: "Northstar Studio",
    applicationIds: [application.id],
  });
  const file = await post("/files", {
    name: "synthetic-resume.pdf",
    body: Buffer.from(
      "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF",
    ).toString("base64"),
  });
  const originalDocument = await post("/records/document", {
    title: "Product engineering resume",
    fileId: file.id,
    applicationIds: [application.id],
  });
  await post("/records/document_usage", {
    applicationId: application.id,
    documentVersionId: originalDocument.id,
    submittedDate: "2026-10-28",
    purpose: "Resume",
  });
  const nextFile = await post("/files", {
    name: "synthetic-resume-v2.pdf",
    body: Buffer.from(
      "%PDF-1.4\n%version-two\n1 0 obj<</Type/Catalog>>endobj\n%%EOF",
    ).toString("base64"),
  });
  await post("/records/document", {
    title: "Product engineering resume — revised",
    fileId: nextFile.id,
    documentId: originalDocument.id,
    applicationIds: [application.id],
  });
  await post("/records/round", {
    title: "Engineering team conversation",
    applicationId: application.id,
    status: "Scheduled",
    date: "2027-01-15",
    time: "10:30",
    timezone: "America/New_York",
  });
  await post("/records/assessment", {
    title: "Product architecture exercise",
    applicationId: application.id,
    due: "2027-01-18",
  });
  await post("/recruiting/evidence", {
    operationId: crypto.randomUUID(),
    sourceId: "synthetic-review-portfolio",
    excerpt:
      "Thank you for your portfolio. Our engineering team will review it and respond. This is synthetic test evidence.",
    effectiveAt: "2026-11-05T10:00:00-05:00",
    company: "Northstar Studio",
    title: "Product Engineer",
    applicationId: application.id,
    changes: { owner: "Employer" },
  });
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/workspace")).json()).reviews
          .length,
    )
    .toBe(1);
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.goto("/today");
  for (const name of [
    "Today",
    "Applications",
    "Reviews",
    "Connections",
    "Documents",
    "Insights",
    "Settings",
  ]) {
    await navigate(page, name);
    await expect(page).toHaveURL(new RegExp(`/${name.toLowerCase()}$`));
    await expect(page.locator(".loading")).toBeHidden();
    await expect(
      page.getByRole("heading", {
        name: name === "Today" ? "Make your next move, Taylor." : name,
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.locator(".shell")).toBeVisible();
    if (name === "Settings") {
      await expect(
        page
          .getByRole("region", { name: "AI recruiting extraction" })
          .getByRole("status"),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", {
          name: "Gmail recruiting import",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByText("Loading connection status…", { exact: true }),
      ).toBeHidden();
      await expect(
        page.getByRole("heading", { name: "Delete account", exact: true }),
      ).toBeVisible();
    }
    if (name === "Insights") {
      await expect(page.locator("main")).toContainText(
        "2 of 3 applications have a recorded applied date. 1 date is unknown.",
      );
      await expect(
        page.getByRole("img", { name: "Interviewing: 1 of 3 applications" }),
      ).toBeVisible();
    }
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    await page.screenshot({
      path: `${directory}/${name.toLowerCase()}-${testInfo.project.name}.png`,
      fullPage: true,
    });
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect
      .soft(
        result.violations.map((v) => ({
          id: v.id,
          targets: v.nodes.map((n) => n.target),
        })),
        name,
      )
      .toEqual([]);
    if (name === "Today") {
      await page.locator('.brief-signals a[href="#today-actions"]').click();
      await expect(page).toHaveURL(/\/today#today-actions$/);
      await expect(page.locator("#today-actions")).toBeInViewport();
      await page.locator('.brief-signals a[href="#reply-ownership"]').click();
      await expect(page).toHaveURL(/\/today#reply-ownership$/);
      await expect(page.locator("#reply-ownership")).toBeInViewport();
    }
    if (name === "Applications") {
      await page.getByRole("button", { name: "Board view" }).click();
      await expect(
        page.getByRole("button", { name: "Board view" }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator(".job-card")).toHaveCount(3);
      await page.screenshot({
        path: `${directory}/board-${testInfo.project.name}.png`,
        fullPage: true,
      });
      const boardAudit = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
      expect
        .soft(
          boardAudit.violations.map((v) => ({
            id: v.id,
            targets: v.nodes.map((n) => n.target),
          })),
          "Board",
        )
        .toEqual([]);
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        )
        .toBe(true);
      await page.getByRole("button", { name: "Table view" }).click();
    }
  }
  await page.goto(`/applications/${application.id}`);
  await expect(
    page.getByRole("dialog", { name: "Application details" }),
  ).toBeVisible();
  await page.screenshot({
    path: `${directory}/application-detail-${testInfo.project.name}.png`,
    fullPage: false,
  });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  expect(errors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
