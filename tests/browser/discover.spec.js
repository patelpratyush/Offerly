import { navigate } from "./navigation.js";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// The catalog is seeded by tests/support/seed-discovery.js from fixture data
// through the real connectors; no network is used.
test("discovery shows honest coverage, freshness, duplicates, filters and alerts", async ({
  page,
}) => {
  test.setTimeout(90000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/#signup");
  await page.getByLabel("Your name").fill("Scout");
  await page
    .getByLabel("Email address", { exact: true })
    .fill(`discover-${Date.now()}-${Math.random()}@example.com`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("discover-browser-password");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Make your next move, Scout." }),
  ).toBeVisible();
  const created = await page.request.post("/api/records/application", {
    headers: { "X-Offerly-Request": "1" },
    data: {
      company: "Acme",
      title: "Backend",
      stage: "Submitted",
      requisition: "REQ-100",
    },
  });
  expect(created.ok()).toBeTruthy();
  await page.reload();

  await navigate(page, "Discover");
  await expect(page).toHaveURL(/\/discover/);
  await expect(
    page.getByRole("heading", { name: "Discover", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("This is not the whole job market."),
  ).toBeVisible();

  // Latest: one canonical job for the two-source opening, both links kept.
  await page.getByRole("button", { name: "Latest", exact: true }).click();
  const backend = page.getByRole("article", {
    name: "Senior Backend Engineer",
  });
  await expect(backend).toHaveCount(1);
  await expect(
    backend.getByText(/Already applied \(Submitted\)/),
  ).toBeVisible();
  await expect(
    backend.getByRole("link", { name: /Greenhouse listing/ }),
  ).toBeVisible();
  await expect(
    backend.getByRole("link", { name: /Lever listing/ }),
  ).toBeVisible();
  const analyst = page.getByRole("article", { name: "Data Analyst" });
  await expect(analyst.getByText(/\(date only\)/)).toBeVisible();
  await expect(
    page
      .getByRole("article", { name: "Platform Engineer" })
      .getByText("Posted"),
  ).toBeVisible();

  // Posted two weeks ago but discovered today: New yes, Latest 24h no.
  await page.getByLabel("Recency window").selectOption("24h");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(backend).toBeVisible();
  await expect(analyst).toHaveCount(0);
  await page.getByRole("button", { name: "New to your feed" }).click();
  await expect(analyst).toBeVisible();

  // Ambiguous 150-500 size is excluded from strict Small, included on opt-in.
  await page.getByLabel("Recency window").selectOption("");
  await page
    .getByRole("group", { name: "Company size" })
    .getByLabel(/Small/)
    .check();
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.getByRole("article")).toHaveCount(0);
  await page.getByLabel("Include ambiguous size ranges").check();
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(analyst).toBeVisible();
  await page.getByRole("button", { name: "Reset" }).click();

  // Save, dismiss with a reason, and see state in the right views.
  await page.getByRole("button", { name: "Latest", exact: true }).click();
  const platform = page.getByRole("article", { name: "Platform Engineer" });
  await platform.getByRole("button", { name: /^Save/ }).click();
  await expect(platform.getByRole("button", { name: /Saved/ })).toBeVisible();
  await page.getByRole("button", { name: "Saved", exact: true }).click();
  await expect(platform).toBeVisible();
  await page.getByRole("button", { name: "Latest", exact: true }).click();
  await analyst.getByRole("button", { name: /Not for me/ }).click();
  await analyst.getByLabel("Why dismiss?").selectOption("wrong_location");
  await analyst.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(analyst).toHaveCount(0);

  // Profile approval makes fit explainable and never claims a probability.
  await page.getByRole("button", { name: "Candidate profile" }).click();
  await page
    .getByLabel("Target roles (comma separated)")
    .fill("backend engineer");
  await page.getByLabel("Approved skills (one per line)").fill("Python");
  await page.getByLabel("Seniority").selectOption("senior");
  await page.getByRole("button", { name: "Approve profile" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Profile approved" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Best matches" }).click();
  // Roles already applied to are not recommended again.
  await expect(platform).toBeVisible();
  await expect(backend).toHaveCount(0);
  await platform.getByText("Why this score and eligibility").click();
  await expect(
    platform.getByText(/not a probability of an interview/),
  ).toBeVisible();
  await expect(platform.getByText(/Gap:/).first()).toBeVisible();

  // Alerts are in-app only and delivered only on request.
  await page.getByRole("button", { name: /^Alerts/ }).click();
  await page.getByLabel("Rule name").fill("Backend roles");
  await page.getByLabel("Also alert on jobs found in the last 7 days").check();
  await page
    .getByLabel("Include jobs whose eligibility needs verification")
    .check();
  await page.getByRole("button", { name: "Save alert rule" }).click();
  await expect(page.getByText("In-app only; no email is sent.")).toBeVisible();
  await page.getByRole("button", { name: "Check for new matches now" }).click();
  await expect(page.getByText(/rule "Backend roles"/).first()).toBeVisible();

  const axe = await new AxeBuilder({ page }).analyze();
  expect(
    axe.violations.filter((v) => ["serious", "critical"].includes(v.impact)),
  ).toEqual([]);

  await navigate(page, "Companies");
  await expect(page).toHaveURL(/\/companies/);
  await expect(page.getByText(/not the whole job market/)).toBeVisible();
  const acme = page.getByRole("article", { name: "Acme" });
  await expect(acme.getByText(/Ambiguous \(150–500/)).toBeVisible();
  await expect(acme.getByText("Verified recently").first()).toBeVisible();
  const globex = page.getByRole("article", { name: "Globex" });
  await expect(
    globex.getByText("No cited size estimate; size is not guessed."),
  ).toBeVisible();
  await acme.getByRole("button", { name: /Watch/ }).click();
  await expect(acme.getByRole("button", { name: /Watching/ })).toBeVisible();
  const axeCompanies = await new AxeBuilder({ page }).analyze();
  expect(
    axeCompanies.violations.filter((v) =>
      ["serious", "critical"].includes(v.impact),
    ),
  ).toEqual([]);
  expect(errors).toEqual([]);
});

test("signed-out visitors cannot reach discover", async ({ page }) => {
  await page.goto("/discover");
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
});
