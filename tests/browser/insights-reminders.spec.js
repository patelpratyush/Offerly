import { test, expect } from "@playwright/test";
import { navigate } from "./navigation.js";

test("insights metrics, reminder rules and calendar export work end to end", async ({
  page,
}) => {
  const headers = { "X-Offerly-Request": "1" };
  async function post(path, data) {
    const response = await page.request.post(`/api${path}`, { headers, data });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  }
  await post("/auth/register", {
    name: "Insights Test",
    email: `insights-${Date.now()}-${Math.random()}@example.test`,
    password: "insights-test-password",
    timezone: "UTC",
  });
  const day = (offset) =>
    new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
  const application = await post("/records/application", {
    company: "Metric Co",
    title: "Analyst",
    stage: "Interviewing",
    appliedDate: day(-14),
    source: "Referral",
  });
  await post("/records/round", {
    title: "Panel",
    applicationId: application.id,
    status: "Scheduled",
    date: day(10),
    time: "14:00",
    timezone: "UTC",
  });
  await post("/records/assessment", {
    title: "Take-home",
    applicationId: application.id,
    status: "Not started",
    due: day(12),
  });
  await page.goto("/insights");
  await page.locator(".loading").waitFor({ state: "hidden" });
  await expect(
    page.getByRole("heading", { name: "What your own records show" }),
  ).toBeVisible();
  await expect(
    page.getByText(/Descriptive only, small sample/).first(),
  ).toBeVisible();
  await expect(page.getByText("Unique submitted applications")).toBeVisible();
  await expect(page.getByText("1 / 1").first()).toBeVisible();
  await expect(
    page.getByRole("table", { name: "Outcomes by source" }),
  ).toContainText("Referral");
  await expect(
    page.getByRole("link", { name: /Export insights CSV/ }),
  ).toHaveAttribute("href", /\/api\/insights\.csv/);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);

  await navigate(page, "Today");
  const todayReminders = page.getByRole("region", {
    name: "Reminder deliveries",
  });
  await expect(todayReminders).toContainText("Interview: Panel");
  await expect(todayReminders).toContainText("Pending");
  await expect(
    todayReminders.getByRole("button", { name: /Open application/ }).first(),
  ).toBeVisible();

  await navigate(page, "Settings");
  await expect(
    page.getByRole("list", { name: "Calendar agenda" }),
  ).toContainText("Original: ");
  const rules = page.getByRole("heading", { name: "Reminder rules" });
  await expect(rules).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Reminder deliveries" }),
  ).toContainText("Interview: Panel");
  await expect(page.getByText(/Email delivery is not enabled/)).toBeVisible();
  const second = page.getByRole("checkbox", {
    name: "Before interviews (second)",
  });
  await second.uncheck();
  await page.getByRole("button", { name: "Save reminder preferences" }).click();
  await expect(page.getByText("Reminder preferences saved.")).toBeVisible();
  await expect(second).not.toBeChecked();
  const view = await (
    await page.request.get("/api/reminder-settings", { headers })
  ).json();
  expect(
    view.deliveries.filter((d) => d.state === "pending").map((d) => d.ruleId),
  ).not.toContain("interview_1h");
  const dateOnly = view.deliveries.find((d) => d.ruleId === "assessment_24h");
  expect(dateOnly?.precision).toBe("date");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download calendar (.ics)" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("offerly-calendar.ics");
  const path = await download.path();
  const { readFile } = await import("node:fs/promises");
  const ics = await readFile(path, "utf8");
  expect(ics).toContain("BEGIN:VCALENDAR");
  expect(ics).toContain("DTSTART;VALUE=DATE:");
  expect(ics).toMatch(/DTSTART:\d{8}T140000Z/);
  await expect(page.getByText("Downloaded 2 events.")).toBeVisible();
});

test("insights show honest empty states for a new account", async ({
  page,
}) => {
  const headers = { "X-Offerly-Request": "1" };
  const res = await page.request.post("/api/auth/register", {
    headers,
    data: {
      name: "Empty Test",
      email: `empty-${Date.now()}-${Math.random()}@example.test`,
      password: "empty-test-password-1",
      timezone: "UTC",
    },
  });
  expect(res.ok()).toBe(true);
  await page.goto("/insights");
  await expect(
    page.getByRole("heading", {
      name: "No submitted applications with a known date yet",
    }),
  ).toBeVisible();
  await expect(
    page.getByText(/Descriptive only, small sample/).first(),
  ).toBeVisible();
  await page.goto("/settings");
  await expect(page.getByText(/No reminders planned/)).toBeVisible();
});
