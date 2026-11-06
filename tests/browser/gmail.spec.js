import { test, expect } from "@playwright/test";
import { navigate } from "./navigation.js";

test("Gmail settings disclose gates and control bounded imports", async ({
  page,
}) => {
  let connected = false;
  let configured = false;
  let state = { status: "idle", processed: 0, proposed: 0 };
  await page.route("**/api/gmail/status", (route) =>
    route.fulfill({
      json: {
        configured,
        status: connected ? "connected" : "disconnected",
        retentionDays: 30,
      },
    }),
  );
  await page.route("**/api/gmail/import", async (route) => {
    if (route.request().method() === "POST") {
      expect(route.request().postDataJSON()).toEqual({
        after: "2026-10-01",
        before: "2026-11-01",
        maxMessages: 25,
      });
      state = { status: "running", processed: 5, proposed: 2 };
    }
    await route.fulfill({ json: state });
  });
  await page.route("**/api/gmail/import/cancel", async (route) => {
    state = { status: "canceled", processed: 5, proposed: 2 };
    await route.fulfill({ json: state });
  });
  await page.goto("/#signup");
  await page.getByLabel("Your name").fill("Gmail Reviewer");
  await page
    .getByLabel("Email address", { exact: true })
    .fill(`gmail-${Date.now()}-${Math.random()}@example.com`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("gmail-browser-password");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Make your next move, Gmail." }),
  ).toBeVisible();
  await navigate(page, "Settings");
  const panel = page.getByRole("region", { name: "Gmail recruiting import" });
  await expect(
    panel.getByRole("button", { name: "Connect Gmail" }),
  ).toBeDisabled();
  await expect(panel).toContainText(
    "Production AI and automatic stage updates are disabled.",
  );
  configured = true;
  connected = true;
  await expect(
    panel.getByRole("button", { name: "Start historical import" }),
  ).toBeVisible({ timeout: 10000 });
  await panel.getByLabel("From date").fill("2026-10-01");
  await panel.getByLabel("Until date (exclusive, UTC)").fill("2026-11-01");
  await panel.getByLabel("Maximum messages").fill("25");
  await panel.getByRole("button", { name: "Start historical import" }).click();
  await expect(panel).toContainText("Messages processed: 5");
  await expect(
    panel.getByRole("button", { name: "Start historical import" }),
  ).toBeDisabled();
  await panel.getByRole("button", { name: "Cancel import" }).click();
  await expect(panel).toContainText("Status: canceled");
  const workspace = await (await page.request.get("/api/workspace")).json();
  const id = "11111111-1111-4111-8111-111111111111";
  const evidenceId = "22222222-2222-4222-8222-222222222222";
  const reviewId = "33333333-3333-4333-8333-333333333333";
  workspace.applications = [
    {
      id,
      version: 1,
      company: "ReviewCo",
      title: "Engineer",
      stage: "Interviewing",
      priority: "Medium",
      owner: "You",
    },
  ];
  workspace.evidence = [
    {
      id: evidenceId,
      version: 1,
      sourceId: "gmail:synthetic",
      excerpt: "Please share your availability.",
      eventType: "availability",
      proposedContacts: [
        {
          email: "recruiter@example.com",
          name: "Recruiter",
          source: "Gmail From header",
        },
      ],
    },
  ];
  workspace.reviews = [
    {
      id: reviewId,
      version: 1,
      status: "accepted",
      evidenceId,
      applicationId: id,
      candidateApplicationIds: [id],
      proposedChanges: { owner: "You" },
    },
  ];
  await page.route("**/api/workspace", (route) =>
    route.fulfill({ json: workspace }),
  );
  await page.route(
    `**/api/recruiting/reviews/${reviewId}/contacts`,
    async (route) => {
      expect(route.request().postDataJSON().version).toBe(1);
      workspace.reviews[0].contactsSaved = true;
      await route.fulfill({ json: { ok: true } });
    },
  );
  let actionSaved = false;
  await page.route(
    `**/api/recruiting/reviews/${reviewId}/action`,
    async (route) => {
      const body = route.request().postDataJSON();
      expect(body.kind).toBe("task");
      expect(body.data).toEqual({
        title: "Send availability",
        applicationId: id,
        due: "2026-11-06",
        done: false,
      });
      actionSaved = true;
      await route.fulfill({ json: { ok: true } });
    },
  );
  await page.reload();
  await navigate(page, "Reviews");
  const review = page.getByRole("article", { name: "Review gmail:synthetic" });
  await expect(review).toContainText("Unverified identities");
  await review.getByRole("button", { name: "Save proposed contacts" }).click();
  await expect(
    review.getByRole("button", { name: "Contacts saved" }),
  ).toBeDisabled();
  await review
    .getByText("Add or update a follow-up action", { exact: true })
    .click();
  await review.getByLabel("Action title").fill("Send availability");
  await review.getByLabel("Confirmed date").fill("2026-11-06");
  await review.getByRole("button", { name: "Save reviewed action" }).click();
  await expect.poll(() => actionSaved).toBe(true);
});
