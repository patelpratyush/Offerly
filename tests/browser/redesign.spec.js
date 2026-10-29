import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { navigate, openMenu } from "./navigation.js";

async function account(page) {
  await page.goto("/#signup");
  await page.getByLabel("Your name").fill("Design audit");
  await page
    .getByLabel("Email address")
    .fill(`test-design-${Date.now()}-${Math.random()}@example.com`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("design-regression-password");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Make your next move, Design." }),
  ).toBeVisible();
}

// Real API-created synthetic records; failure injection affects only one save.
test("responsive records, filter parity, and failed-save editor retain meaningful state", async ({
  page,
}) => {
  await account(page);
  const editor = page.getByRole("dialog", { name: "application editor" });
  await page
    .getByRole("button", { name: "Add application", exact: true })
    .click();
  await expect(editor.getByLabel("Compensation minimum")).toBeHidden();
  await editor.getByRole("button", { name: "Save application" }).click();
  await expect(editor.getByText("Company is required.")).toBeVisible();
  await expect(editor.getByLabel("Company", { exact: true })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await editor
    .getByLabel("Company", { exact: true })
    .fill("Long Company Name for Accessible Product Tools");
  await editor
    .getByLabel("Role title")
    .fill(
      "Senior Engineer — Accessible Design Systems, Platform and Infrastructure",
    );
  await editor
    .getByLabel("Stage", { exact: true })
    .selectOption("Interviewing");
  await editor.getByLabel("Next response", { exact: true }).selectOption("You");
  await page.route("**/api/records/application", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Save unavailable. Retry your changes." }),
    }),
  );
  await editor.getByRole("button", { name: "Save application" }).click();
  await expect(editor.getByRole("alert")).toContainText("Save unavailable");
  await expect(editor.getByLabel("Role title")).toHaveValue(
    "Senior Engineer — Accessible Design Systems, Platform and Infrastructure",
  );
  await page.unroute("**/api/records/application");
  await editor.getByRole("button", { name: "Save application" }).click();
  await expect(editor).toBeHidden();
  await navigate(page, /Applications/);
  await page.getByLabel("Search applications").fill("No matching company");
  await expect(
    page.getByRole("heading", { name: "No applications match these filters." }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .first()
    .click();
  await expect(page.getByRole("table")).toContainText("Long Company Name");
  await page.getByText("More filters", { exact: false }).click();
  await page.getByLabel("Response owner filter").selectOption("You");
  await expect(
    page.getByRole("status").filter({ hasText: "active filter" }),
  ).toContainText("1 application");
  await page.getByRole("button", { name: "Board view" }).click();
  await expect(page.locator(".job-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Table view" }).click();
  await expect(page.getByRole("table")).toContainText("Your reply is next");
  await expect(page.getByRole("table")).toContainText(
    "No task or deadline set",
  );
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    results.violations.map((v) => ({
      id: v.id,
      targets: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("dialog keyboard containment, Escape, focus restoration and actionable Today rows", async ({
  page,
}) => {
  await account(page);
  const trigger = page.getByRole("button", {
    name: "Add application",
    exact: true,
  });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "application editor" });
  await expect(page.locator("main")).toHaveAttribute("inert", "");
  await expect(
    dialog.getByRole("button", { name: "Close editor" }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    dialog.getByRole("button", { name: "Save application" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    dialog.getByRole("button", { name: "Close editor" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  const response = await page.request.post("/api/records/task", {
    headers: { "X-Offerly-Request": "1" },
    data: { title: "Call recruiter", due: "2026-01-01", done: false },
  });
  expect(response.ok()).toBeTruthy();
  await page.reload();
  await page
    .getByRole("button", { name: "Call recruiter · Edit task" })
    .click();
  const task = page.getByRole("dialog", { name: "task editor" });
  await task.getByLabel("Task", { exact: true }).fill("Email recruiter");
  await task.getByRole("button", { name: "Save task" }).click();
  await expect(
    page.getByRole("button", { name: "Email recruiter · Edit task" }),
  ).toBeVisible();
  await openMenu(page);
  await expect(
    page
      .getByRole("navigation")
      .getByRole("button", { name: "Today", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await navigate(page, "Connections");
  await expect(page.locator(".mobile-menu")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
});
