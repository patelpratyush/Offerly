import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function createApplication(page, company, title) {
  const response = await page.request.post("/api/records/application", {
    headers: { "X-Offerly-Request": "1" },
    data: { company, title, stage: "Saved" },
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function workspace(page) {
  const response = await page.request.get("/api/workspace");
  expect(response.ok()).toBeTruthy();
  return response.json();
}

test("rich contacts retain sources, explicit confirmations and multiple application links", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/#signup");
  await page.getByLabel("Your name").fill("Contact Tester");
  await page
    .getByLabel("Email address", { exact: true })
    .fill(`contact-${Date.now()}-${Math.random()}@example.com`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("contact-workspace-password");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Make your next move, Contact." }),
  ).toBeVisible();
  const first = await createApplication(page, "Northstar", "Backend Engineer");
  const second = await createApplication(
    page,
    "Southstar",
    "Platform Engineer",
  );
  await page.reload();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Connections", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add connection", exact: true })
    .first()
    .click();
  const editor = page.getByRole("dialog", { name: "contact editor" });
  await editor.getByLabel("Full name", { exact: true }).fill("Alex Rivera");
  await editor
    .getByLabel("Email address", { exact: true })
    .fill("alex@agency.example");
  await editor.getByLabel("Employer", { exact: true }).fill("Talent Partners");
  await editor.getByLabel("Role", { exact: true }).fill("Senior recruiter");
  await editor
    .getByLabel("Recruiting agency", { exact: true })
    .fill("Talent Partners Agency");
  await editor.getByLabel("Hiring company", { exact: true }).fill("Northstar");
  await editor
    .getByLabel("Relationship type", { exact: true })
    .selectOption("Recruiter");
  await editor.getByLabel("Phone", { exact: true }).fill("+1 212 555 0123");
  await editor
    .getByLabel("LinkedIn URL", { exact: true })
    .fill("https://www.linkedin.com/in/alex-rivera");
  await editor
    .getByLabel("Last interaction", { exact: true })
    .fill("2026-10-19");
  await editor
    .getByLabel("Notes", { exact: true })
    .fill("Discussed two separate opportunities.");
  await editor
    .locator("summary")
    .filter({ hasText: /^Employer source/ })
    .click();
  await editor
    .getByLabel("Employer source", { exact: true })
    .selectOption("Email signature");
  await editor
    .getByLabel("Employer evidence", { exact: true })
    .fill("Signature on the October 19 scheduling email");
  await expect(
    editor.getByLabel("Employer confirmed by me", { exact: true }),
  ).not.toBeChecked();
  await editor
    .locator("summary")
    .filter({ hasText: /^Email address source/ })
    .click();
  await editor
    .getByLabel("Email address confirmed by me", { exact: true })
    .check();
  await editor
    .getByRole("button", { name: "Add email address", exact: true })
    .click();
  await editor
    .getByLabel("Additional email 1", { exact: true })
    .fill("alex@personal.example");
  await editor
    .getByLabel("Email 2 source", { exact: true })
    .selectOption("Introduction");
  await editor
    .getByLabel("Email 2 evidence", { exact: true })
    .fill("Alex shared this address during our introduction");
  await editor.getByLabel("Email 2 confirmed by me", { exact: true }).check();
  await editor
    .getByLabel("Northstar · Backend Engineer", { exact: true })
    .check();
  await editor
    .getByLabel("Southstar · Platform Engineer", { exact: true })
    .check();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const accessibility = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(
    accessibility.violations.map(({ id, nodes }) => ({
      id,
      targets: nodes.map((node) => node.target),
    })),
  ).toEqual([]);
  await page.screenshot({
    path: `test-results/contact-editor-${test.info().project.name}.png`,
    fullPage: true,
    animations: "disabled",
  });
  await editor
    .getByRole("button", { name: "Save contact", exact: true })
    .click();
  await expect(editor).toBeHidden();
  let current = await workspace(page);
  expect(current.contacts).toHaveLength(1);
  const saved = current.contacts[0];
  expect(saved).toMatchObject({
    name: "Alex Rivera",
    email: "alex@agency.example",
    emailConfirmed: true,
    company: "Talent Partners",
    role: "Senior recruiter",
    agency: "Talent Partners Agency",
    hiringCompany: "Northstar",
    relationshipType: "Recruiter",
    phone: "+1 212 555 0123",
    linkedinUrl: "https://www.linkedin.com/in/alex-rivera",
    lastInteraction: "2026-10-19",
    notes: "Discussed two separate opportunities.",
    provenance: {
      company: {
        source: "Email signature",
        evidence: "Signature on the October 19 scheduling email",
        confirmed: false,
      },
    },
    additionalEmails: [
      {
        email: "alex@personal.example",
        source: "Introduction",
        confirmed: true,
      },
    ],
  });
  expect(saved.applicationIds.sort()).toEqual([first.id, second.id].sort());
  expect(saved.provenance.company.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  await page.reload();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Connections", exact: true })
    .click();
  await page
    .getByRole("button", { name: /Alex Rivera.*alex@agency.example/ })
    .click();
  await expect(
    editor.getByLabel("Hiring company", { exact: true }),
  ).toHaveValue("Northstar");
  await expect(
    editor.getByLabel("Northstar · Backend Engineer", { exact: true }),
  ).toBeChecked();
  await expect(
    editor.getByLabel("Southstar · Platform Engineer", { exact: true }),
  ).toBeChecked();
  await editor
    .locator("summary")
    .filter({ hasText: /^Employer source/ })
    .click();
  await expect(
    editor.getByLabel("Employer evidence", { exact: true }),
  ).toHaveValue("Signature on the October 19 scheduling email");
  await editor
    .getByLabel("Email address", { exact: true })
    .fill("alex.new@agency.example");
  await editor
    .locator("summary")
    .filter({ hasText: /^Email address source/ })
    .click();
  await expect(
    editor.getByLabel("Email address confirmed by me", { exact: true }),
  ).not.toBeChecked();
  await editor
    .getByRole("button", { name: "Save contact", exact: true })
    .click();
  await expect(editor).toBeHidden();
  current = await workspace(page);
  expect(current.contacts[0].emailConfirmed).toBe(false);
  expect(current.contacts[0].provenance.email.confirmed).toBe(false);
  expect(current.contacts[0].provenance.company).toEqual(
    saved.provenance.company,
  );
  await page
    .getByRole("button", { name: "Add connection", exact: true })
    .click();
  await editor.getByLabel("Full name", { exact: true }).fill("Alex Rivera");
  await editor
    .getByLabel("Email address", { exact: true })
    .fill("different.alex@example.com");
  await editor
    .getByRole("button", { name: "Save contact", exact: true })
    .click();
  await expect(editor).toBeHidden();
  current = await workspace(page);
  expect(current.contacts).toHaveLength(2);
  expect(new Set(current.contacts.map((contact) => contact.id)).size).toBe(2);
  expect(
    current.contacts.every((contact) => contact.name === "Alex Rivera"),
  ).toBe(true);
  await page.getByLabel("Search connections").fill("personal.example");
  await expect(page.locator(".person-card")).toHaveCount(1);
  await expect(page.locator(".person-card")).toContainText(
    "2 linked applications",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
