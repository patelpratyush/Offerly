import { navigate } from "./navigation.js";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("offer decisions persist independently of stage and listing revisions preserve original evidence", async ({
  page,
}, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/#signup");
  await page.getByLabel("Your name").fill("Avery");
  await page
    .getByLabel("Email address")
    .fill(`offer-listing-${Date.now()}-${Math.random()}@example.com`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("offer-listing-test-password");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Make your next move, Avery." }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Add application", exact: true })
    .click();
  const editor = page.getByRole("dialog", { name: "application editor" });
  await editor.getByLabel("Company", { exact: true }).fill("EvidenceCo");
  await editor.getByLabel("Role title").fill("Evidence Engineer");
  await editor
    .getByLabel("Stage", { exact: true })
    .selectOption("Interviewing");
  await editor.getByText("Compensation & offer", { exact: false }).click();
  await editor
    .getByLabel("Offer outcome", { exact: true })
    .selectOption("Accepted");
  await editor.getByLabel("Offer received date").fill("2026-10-18");
  await editor.getByLabel("Offer decision date").fill("2026-10-19");
  await editor.getByText("Listing & source", { exact: false }).click();
  await editor
    .getByLabel("Saved job description")
    .fill("Original listing: build accessible tools.");
  await editor.getByLabel("Listing captured date").fill("2026-10-17");
  await editor
    .getByLabel("Listing source URL")
    .fill("https://example.com/careers/original");
  const accessibility = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(
    accessibility.violations.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
  await editor.getByRole("button", { name: "Save application" }).click();
  await expect(editor).toBeHidden();
  await navigate(page, /Applications/);
  await page.getByRole("button", { name: "Open Evidence Engineer" }).click();
  const detail = page.getByRole("dialog", { name: "Application details" });
  const history = detail.getByRole("region", { name: "Listing history" });
  await expect(
    history.getByText("Captured 2026-10-17", { exact: true }),
  ).toBeVisible();
  await detail.getByRole("button", { name: "Edit application" }).click();
  await expect(editor.getByLabel("Offer outcome", { exact: true })).toHaveValue(
    "Accepted",
  );
  await expect(editor.getByLabel("Stage", { exact: true })).toHaveValue(
    "Interviewing",
  );
  await editor
    .getByLabel("Offer outcome", { exact: true })
    .selectOption("Declined");
  await editor.getByLabel("Offer decision date").fill("2026-10-20");
  await editor
    .getByLabel("Saved job description")
    .fill("Revised listing: build reliable accessible tools.");
  await editor.getByLabel("Listing captured date").fill("2026-10-20");
  await editor
    .getByLabel("Listing source URL")
    .fill("https://example.com/careers/revised");
  await editor.getByRole("button", { name: "Save application" }).click();
  await expect(editor).toBeHidden();
  await page.reload();
  await navigate(page, /Applications/);
  await page.getByRole("button", { name: "Open Evidence Engineer" }).click();
  await expect(history.locator("article")).toHaveCount(2);
  await history
    .getByText("Saved description · version 1", { exact: true })
    .click();
  await history
    .getByText("Saved description · version 2", { exact: true })
    .click();
  await expect(
    history.getByText("Original listing: build accessible tools.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    history.getByText("Revised listing: build reliable accessible tools.", {
      exact: true,
    }),
  ).toBeVisible();
  const original = history
    .locator("article")
    .filter({ hasText: "Captured 2026-10-17" });
  await expect(
    original.getByRole("link", { name: "View listing source" }),
  ).toHaveAttribute("href", "https://example.com/careers/original");
  await page.screenshot({
    path: `test-results/listing-history-${testInfo.project.name}.png`,
    fullPage: true,
    animations: "disabled",
  });
  await detail.getByRole("button", { name: "Edit application" }).click();
  await expect(editor.getByLabel("Offer outcome", { exact: true })).toHaveValue(
    "Declined",
  );
  await expect(editor.getByLabel("Offer decision date")).toHaveValue(
    "2026-10-20",
  );
  await expect(editor.getByLabel("Offer received date")).toHaveValue(
    "2026-10-18",
  );
  await expect(editor.getByLabel("Stage", { exact: true })).toHaveValue(
    "Interviewing",
  );
  const response = await page.request.get("/api/workspace");
  expect(response.ok()).toBeTruthy();
  const workspace = await response.json();
  expect(workspace.applications[0]).toMatchObject({
    offerOutcome: "Declined",
    offerDecisionDate: "2026-10-20",
    stage: "Interviewing",
  });
  expect(workspace.listingSnapshots).toHaveLength(2);
  expect(errors).toEqual([]);
});
