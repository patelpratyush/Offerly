import { navigate } from "./navigation.js";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { buildDocx } from "../../server/docx-text.js";

const headers = { "X-Offerly-Request": "1" };
async function post(page, path, data) {
  const response = await page.request.post("/api" + path, { headers, data });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

test("preparation workspace: answers, interview prep, manual drafts, tailoring and contact import", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let sent = 0;
  page.on("request", (request) => {
    if (/\/(send|gmail\/send)/i.test(request.url())) sent++;
  });
  await page.goto("/#signup");
  await page.getByLabel("Your name").fill("Prep Tester");
  await page
    .getByLabel("Email address", { exact: true })
    .fill(`prep-${Date.now()}-${Math.random()}@example.com`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("prep-workspace-password");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Make your next move, Prep." }),
  ).toBeVisible();
  const application = await post(page, "/records/application", {
    company: "Northstar",
    title: "Backend Engineer",
    stage: "Interviewing",
    appliedDate: "2026-01-05",
    description:
      "Requirements\n- Python and AWS experience\n- Kubernetes operations experience",
  });
  await post(page, "/records/round", {
    title: "Technical interview",
    applicationId: application.id,
    status: "Scheduled",
    date: "2026-12-01",
    timezone: "America/New_York",
  });
  await post(page, "/records/contact", {
    name: "Riley Chen",
    email: "riley@northstar.example",
    applicationIds: [application.id],
  });
  const file = await post(page, "/files", {
    name: "resume.docx",
    body: buildDocx("Python engineer\nBuilt AWS services").toString("base64"),
  });
  await post(page, "/records/document", {
    title: "Resume",
    fileId: file.id,
    label: "Resume",
    applicationIds: [application.id],
  });
  await page.reload();
  await navigate(page, "Prepare");
  await expect(page).toHaveURL(/\/prepare$/);
  await expect(
    page.getByRole("button", { name: "Add application" }),
  ).toHaveCount(0);
  await expect(
    page.getByText("never sends email", { exact: false }),
  ).toBeVisible();

  // Answers: sensitive values need explicit confirmation.
  await page.getByRole("button", { name: "Add answer" }).click();
  const answer = page.getByRole("form", { name: "Answer editor" });
  await answer.getByLabel("Question").fill("Expected salary?");
  await answer.getByLabel("Type").selectOption("salary");
  await answer.getByLabel("Answer", { exact: true }).fill("150000");
  await answer.getByRole("button", { name: "Save answer" }).click();
  await expect(answer.getByRole("alert")).toContainText("confirm this exact");
  await answer.getByLabel("I confirm this exact answer").check();
  await answer.getByRole("button", { name: "Save answer" }).click();
  await expect(page.getByText("Answer saved.")).toBeVisible();
  await expect(
    page.getByText(/Last confirmed \d{4}-\d{2}-\d{2}/),
  ).toBeVisible();
  await expect(page.getByText("6 characters")).toBeVisible();

  // Interview preparation, distinct from assessments.
  await page.getByRole("tab", { name: "Interview prep" }).click();
  await page.getByLabel("Interview round").selectOption({ index: 1 });
  const prep = page.getByRole("form", { name: "Interview preparation" });
  await prep.getByLabel("Your preparation notes").fill("Review system design");
  await prep.getByRole("button", { name: "Add person" }).click();
  await prep.getByLabel("Name", { exact: true }).fill("Riley Chen");
  await prep
    .getByLabel("Saved connection")
    .selectOption({ label: "Riley Chen" });
  await prep.getByRole("button", { name: "Add practice question" }).click();
  await prep
    .getByLabel("Question", { exact: true })
    .fill("Describe a migration");
  await prep.getByLabel("Post-interview notes").fill("Went well");
  await prep.getByRole("button", { name: "Save preparation" }).click();
  await expect(page.getByText("Preparation saved.")).toBeVisible();

  // Manual drafts: placeholders, recipients, no Send control.
  await prep.getByRole("button", { name: /Draft a thank-you/ }).click();
  const draft = page.getByRole("form", { name: "Message draft editor" });
  await expect(draft.getByLabel("Body")).toHaveValue(/Hi Riley,/);
  await expect(draft.getByLabel("Body")).toHaveValue(
    /\[\[add one specific topic/,
  );
  await expect(draft.getByText("Linked application:")).toBeVisible();
  await expect(
    draft.getByText("riley@northstar.example").first(),
  ).toBeVisible();
  await expect(
    draft.getByText(/not Completed|marked "Scheduled"/),
  ).toBeVisible();
  await expect(
    draft.getByRole("button", { name: "Open in my mail app" }),
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: /^send/i })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^send/i })).toHaveCount(0);
  await draft
    .getByLabel("Body")
    .fill("Hi Riley,\n\nThank you for your time.\n\nBest,\nPrep Tester");
  const mail = draft.getByRole("link", { name: "Open in my mail app" });
  await expect(mail).toHaveAttribute(
    "href",
    /^mailto:riley%40northstar\.example\?subject=.*&body=Hi%20Riley/,
  );
  await draft.getByLabel("Status").selectOption("ready");
  await draft.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Draft saved as ready.")).toBeVisible();

  // Tailoring: comparison with explicit gaps and a new immutable version.
  await page.getByRole("tab", { name: "Tailor a resume" }).click();
  await page
    .getByRole("combobox", { name: /^Application/ })
    .selectOption({ index: 1 });
  await page.getByLabel("Resume version").selectOption({ index: 1 });
  await page
    .getByRole("button", { name: "Load text from this version" })
    .click();
  await expect(page.getByLabel("Your edited text")).toHaveValue(
    /Python engineer/,
  );
  const coverage = page.getByRole("region", { name: "Requirement coverage" });
  await expect(coverage.getByText("Gap: not found")).toBeVisible();
  await expect(coverage.getByText("Not found: kubernetes")).toBeVisible();
  await page
    .getByLabel("Your edited text")
    .fill("Python engineer\nBuilt AWS services\nOperated Kubernetes clusters");
  await expect(coverage.getByText("Gap: not found")).toHaveCount(0);
  await page.getByLabel(/I reviewed this text/).check();
  await page.getByRole("button", { name: "Save as new version" }).click();
  await expect(page.getByText(/Saved as a new document version/)).toBeVisible();
  await expect(page.getByText(/PDF export .* not available/)).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download .docx" }).click();
  expect((await downloadPromise).suggestedFilename()).toMatch(/\.docx$/);
  await navigate(page, "Documents");
  await expect(page.getByText("Tailored (edited text)").first()).toBeVisible();

  // Contact import with preview and unverified provenance.
  await navigate(page, "Prepare");
  await page.getByRole("tab", { name: "Import contacts" }).click();
  await page
    .getByLabel(/Or paste CSV text/)
    .fill("Name,Email\nSam Rowe,sam@example.com\n,bad@example.com\nX,nope");
  await page.getByRole("button", { name: "Preview import" }).click();
  await expect(
    page.getByText("Invalid, will be skipped").first(),
  ).toBeVisible();
  await page.getByRole("button", { name: /Import 1 new contact/ }).click();
  await expect(page.getByText(/1 contact imported/)).toBeVisible();
  const contacts = (await (await page.request.get("/api/workspace")).json())
    .contacts;
  const sam = contacts.find((c) => c.name === "Sam Rowe");
  expect(sam.provenance.name.source).toBe("Imported");
  expect(sam.emailConfirmed).toBe(false);

  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(
    accessibility.violations.map(({ id, nodes }) => ({
      id,
      targets: nodes.map((node) => node.target),
    })),
  ).toEqual([]);
  expect(sent).toBe(0);
  expect(errors).toEqual([]);
});
