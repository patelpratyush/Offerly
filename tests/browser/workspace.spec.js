import { test, expect } from "@playwright/test";
test("manual workspace persists application, round, task and document", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/#signup");
  await page.getByLabel("Your name").fill("Taylor");
  await page
    .getByLabel("Email address")
    .fill(`test-${Date.now()}-${Math.random()}@example.com`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("test-workspace-password");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Make your next move, Taylor." }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Add application", exact: true })
    .click();
  const modal = page.getByRole("dialog", { name: "application editor" });
  await modal.getByLabel("Company", { exact: true }).fill("Acme");
  await modal.getByLabel("Role title").fill("Backend Engineer");
  await modal.getByLabel("Stage", { exact: true }).selectOption("Interviewing");
  await modal
    .getByLabel("Notes", { exact: true })
    .fill("Met recruiter at the career fair.");
  await modal.getByLabel("Compensation minimum").fill("90000");
  await modal.getByLabel("Compensation maximum").fill("120000.50");
  await modal.getByLabel("Currency code (e.g. USD)").fill("USD");
  await modal.getByLabel("Pay period").selectOption("Year");
  await modal.getByLabel("Pay basis").selectOption("Base");
  await modal.getByRole("button", { name: "Save application" }).click();
  await expect(modal).toBeHidden();
  await page
    .getByRole("button", { name: /Interviewing.*Backend Engineer.*Acme/ })
    .click();
  const detail = page.getByRole("dialog", { name: "Application details" });
  await expect(
    detail.getByText("Met recruiter at the career fair.").first(),
  ).toBeVisible();
  await expect(
    detail.getByRole("region", { name: "Compensation" }),
  ).toContainText("90000–120000.50 · USD · Per year · Base compensation");
  await detail
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Interview rounds" }) })
    .getByRole("button", { name: "Add", exact: true })
    .click();
  const round = page.getByRole("dialog", { name: "round editor" });
  await round.getByLabel("Round name").fill("Technical conversation");
  await round.getByLabel("Status").selectOption("Scheduled");
  await round.getByLabel("Date", { exact: true }).fill("2027-01-15");
  await round.getByLabel("Time", { exact: true }).fill("10:30");
  await round.getByRole("button", { name: "Save round" }).click();
  await expect(detail.getByText("Technical conversation")).toBeVisible();
  await detail
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Tasks", exact: true }) })
    .getByRole("button", { name: "Add", exact: true })
    .click();
  const task = page.getByRole("dialog", { name: "task editor" });
  await task
    .getByLabel("Task", { exact: true })
    .fill("Prepare project walkthrough");
  await task.getByRole("button", { name: "Save task" }).click();
  await expect(detail.getByText("Prepare project walkthrough")).toBeVisible();
  await detail.getByRole("button", { name: "Close details" }).click();
  await page.reload();
  await expect(page.getByText("Prepare project walkthrough")).toBeVisible();
  await page
    .getByRole("button", { name: "Applications", exact: false })
    .first()
    .click();
  await expect(page.getByRole("table")).toContainText("Backend Engineer");
  await page.getByRole("button", { name: "Board view" }).click();
  await expect(
    page.getByRole("button", { name: /Interviewing.*Backend Engineer.*Acme/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Documents", exact: true }).click();
  await page
    .getByRole("button", { name: "Upload document", exact: true })
    .first()
    .click();
  const doc = page.getByRole("dialog", { name: "document editor" });
  await doc.getByLabel("Version name").fill("Resume v1");
  await doc.getByLabel(/File \(PDF/).setInputFiles({
    name: "resume.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF"),
  });
  await doc.getByLabel("Acme · Backend Engineer").check();
  await doc.getByRole("button", { name: "Save document" }).click();
  await expect(page.getByRole("heading", { name: "Resume v1" })).toBeVisible();
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await page.screenshot({
    path: `test-results/workspace-${test.info().project.name}.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("password change signs out all sessions and new password restores access", async ({
  page,
}) => {
  const email = `test-password-${Date.now()}-${Math.random()}@example.com`;
  await page.goto("/#signup");
  await page.getByLabel("Your name").fill("Security Test");
  await page.getByLabel("Email address").fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("original-test-password");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Make your next move, Security." }),
  ).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  await page
    .getByLabel("Current password", { exact: true })
    .fill("original-test-password");
  await page
    .getByLabel("New password", { exact: true })
    .fill("replacement-test-password");
  await page
    .getByRole("button", { name: "Change password and sign out" })
    .click();
  await expect(
    page.getByRole("button", { name: "Already have an account? Sign in" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Already have an account? Sign in" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
  await page.getByLabel("Email address").fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("replacement-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page
      .getByRole("navigation")
      .getByRole("button", { name: "Settings", exact: true }),
  ).toBeVisible();
});
