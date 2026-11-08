import { test, expect } from "@playwright/test";
import { navigate, openMenu } from "./navigation.js";

const headers = { "X-Offerly-Request": "1" };
async function account(page) {
  const credentials = {
    name: "Route Test",
    email: `route-${Date.now()}-${Math.random()}@example.test`,
    password: "route-regression-password",
    timezone: "UTC",
  };
  const response = await page.request.post("/api/auth/register", {
    headers,
    data: credentials,
  });
  expect(response.ok()).toBe(true);
  return credentials;
}
async function create(page, kind, data) {
  const response = await page.request.post(`/api/records/${kind}`, {
    headers,
    data,
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
async function signIn(page, credentials) {
  await page.getByLabel("Email address").fill(credentials.email);
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

test("main pages use native links, direct routes, refresh, and browser history", async ({
  page,
}) => {
  await account(page);
  await page.goto("/today");
  for (const [name, path] of [
    ["Applications", "/applications"],
    ["Reviews", "/reviews"],
    ["Connections", "/connections"],
    ["Documents", "/documents"],
    ["Insights", "/insights"],
    ["Settings", "/settings"],
    ["Today", "/today"],
  ]) {
    await navigate(page, name);
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(page).toHaveTitle(new RegExp(name));
    await openMenu(page);
    await expect(
      page.getByRole("navigation").getByRole("link", {
        name: name === "Applications" ? /^Applications/ : name,
        exact: name !== "Applications",
      }),
    ).toHaveAttribute("aria-current", "page");
    await page.reload();
    await expect(page.locator(".sidebar")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
  }
  if (page.viewportSize().width >= 1000) {
    const [newTab] = await Promise.all([
      page.context().waitForEvent("page"),
      page
        .getByRole("navigation")
        .getByRole("link", { name: /^Applications/ })
        .click({ modifiers: ["ControlOrMeta"] }),
    ]);
    await expect(newTab).toHaveURL(/\/applications$/);
    await expect(
      newTab.getByRole("heading", { name: "Applications", exact: true }),
    ).toBeVisible();
    await newTab.close();
  }
  await navigate(page, "Applications");
  await navigate(page, "Documents");
  await page.goBack();
  await expect(page).toHaveURL(/\/applications$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/documents$/);
  await page.goto("/not-a-real-page");
  await expect(
    page.getByRole("heading", { name: /not found|couldn.t find/i }),
  ).toBeVisible();
});

test("protected deep link returns after sign-in and rejects external return destinations", async ({
  page,
}) => {
  const credentials = await account(page);
  await page.request.post("/api/logout", { headers, data: {} });
  await page.goto("/documents");
  await expect(page).toHaveURL(/\/signin\?/);
  await expect(page.locator(".sidebar")).toHaveCount(0);
  await signIn(page, credentials);
  await expect(page).toHaveURL(/\/documents$/);
  await page.request.post("/api/logout", { headers, data: {} });
  await page.goto("/signin?returnTo=https%3A%2F%2Fevil.example%2Fsteal");
  await signIn(page, credentials);
  await expect(page).toHaveURL(/\/today$/);
});

test("legacy authentication hashes migrate while real landing anchors remain anchors", async ({
  page,
}) => {
  await page.goto("/#signin");
  await expect(page).toHaveURL(/\/signin$/);
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
  await page.goto("/#signup");
  await expect(page).toHaveURL(/\/signup$/);
  await expect(page.getByLabel("Your name")).toBeVisible();
  await page.goto("/#features");
  await expect(page).toHaveURL(/\/#features$/);
});

test("application detail URL survives refresh and closes back to originating list", async ({
  page,
  browser,
}) => {
  await account(page);
  const application = await create(page, "application", {
    company: "Routing Lab",
    title: "Route Engineer",
    stage: "Saved",
    owner: "You",
  });
  await page.goto("/applications");
  await page.getByRole("button", { name: "Open Route Engineer" }).click();
  await expect(page).toHaveURL(new RegExp(`/applications/${application.id}`));
  await page.reload();
  const detail = page.getByRole("dialog", { name: "Application details" });
  await expect(detail).toContainText("Route Engineer");
  await detail.getByRole("button", { name: "Close details" }).click();
  await expect(page).toHaveURL(/\/applications$/);
  await page.goto("/today");
  await page
    .getByRole("button", { name: /Saved.*Route Engineer.*Routing Lab/ })
    .click();
  await expect(page).toHaveURL(new RegExp(`/applications/${application.id}`));
  await page.goBack();
  await expect(page).toHaveURL(/\/today$/);
  await expect(detail).toBeHidden();
  await page.goto("/applications/not-owned-or-real");
  await expect(
    page.getByRole("heading", { name: /not found|unavailable|couldn.t find/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Application details" }),
  ).toHaveCount(0);
  const otherContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
  });
  const otherPage = await otherContext.newPage();
  try {
    await otherPage.goto(new URL("/signin", page.url()).href);
    await account(otherPage);
    await otherPage.goto(
      new URL(`/applications/${application.id}`, page.url()).href,
    );
    await expect(
      otherPage.getByRole("heading", { name: "Application unavailable" }),
    ).toBeVisible();
    await expect(otherPage.getByText("Route Engineer")).toHaveCount(0);
  } finally {
    await otherContext.close();
  }
});

test("application filter and board state survive refresh and history", async ({
  page,
}) => {
  await account(page);
  await create(page, "application", {
    company: "Searchable Lab",
    title: "Filter Engineer",
    stage: "Saved",
  });
  await page.goto("/applications");
  await page.getByLabel("Stage filter", { exact: true }).selectOption("Saved");
  await page.getByRole("button", { name: "Board view" }).click();
  await expect.poll(() => new URL(page.url()).search).not.toBe("");
  const filteredUrl = page.url();
  await page.reload();
  await expect(page.getByLabel("Stage filter", { exact: true })).toHaveValue(
    "Saved",
  );
  await expect(page.locator(".job-card")).toHaveCount(1);
  await navigate(page, "Documents");
  await page.goBack();
  await expect(page).toHaveURL(filteredUrl);
  await expect(page.getByLabel("Stage filter", { exact: true })).toHaveValue(
    "Saved",
  );
});

test("session expiry removes private detail and routes to sign-in", async ({
  page,
}) => {
  await account(page);
  const application = await create(page, "application", {
    company: "Private Routing Lab",
    title: "Private Engineer",
    stage: "Saved",
    notes: "Synthetic private route notes",
  });
  await page.goto(`/applications/${application.id}`);
  const detail = page.getByRole("dialog", { name: "Application details" });
  await expect(detail).toContainText("Synthetic private route notes");
  await page.request.post("/api/logout", { headers, data: {} });
  await detail.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page).toHaveURL(/\/signin(?:\?|$)/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("Synthetic private route notes")).toHaveCount(0);
  await page.goBack();
  await expect(page.locator(".sidebar")).toHaveCount(0);
});

test("revoked session cannot navigate into cached private pages", async ({
  page,
}) => {
  await account(page);
  await create(page, "application", {
    company: "Cached Private Lab",
    title: "Cached Private Role",
    stage: "Saved",
  });
  await page.goto("/applications");
  await expect(page.getByRole("table")).toContainText("Cached Private Role");
  await page.request.post("/api/logout", { headers, data: {} });
  await navigate(page, "Documents");
  await expect(page).toHaveURL(/\/signin(?:\?|$)/);
  await expect(page.locator(".sidebar")).toHaveCount(0);
  await expect(page.getByText("Cached Private Role")).toHaveCount(0);
  await page.goBack();
  await expect(page.locator(".sidebar")).toHaveCount(0);
});

test("session revalidation preserves unsaved editor drafts and detail keyboard focus", async ({
  page,
}) => {
  await account(page);
  await page.goto("/applications");
  await page
    .getByRole("button", { name: "Add application", exact: true })
    .first()
    .click();
  const editor = page.getByRole("dialog", { name: "application editor" });
  await editor.getByLabel("Company", { exact: true }).fill("Draft Lab");
  await editor.getByLabel("Role title").fill("Unsaved Draft Engineer");
  await Promise.all([
    page.waitForResponse((response) =>
      response.url().endsWith("/api/workspace"),
    ),
    page.evaluate(() => window.dispatchEvent(new Event("pageshow"))),
  ]);
  await expect(page.locator(".loading")).toBeHidden();
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel("Role title")).toHaveValue(
    "Unsaved Draft Engineer",
  );
  await expect(editor.getByLabel("Company", { exact: true })).toHaveValue(
    "Draft Lab",
  );
  await editor.getByRole("button", { name: "Save application" }).click();
  await expect(editor).toBeHidden();
  await page
    .getByRole("button", { name: "Open Unsaved Draft Engineer" })
    .click();
  const detail = page.getByRole("dialog", { name: "Application details" });
  await expect(detail).toBeVisible();
  await Promise.all([
    page.waitForResponse((response) =>
      response.url().endsWith("/api/workspace"),
    ),
    page.evaluate(() => window.dispatchEvent(new Event("pageshow"))),
  ]);
  await expect(page.locator(".loading")).toBeHidden();
  await expect(detail).toBeVisible();
  await detail.getByRole("button", { name: "Close details" }).focus();
  await page.keyboard.press("Shift+Tab");
  expect(
    await page.evaluate(() =>
      document
        .querySelector('[role="dialog"]')
        .contains(document.activeElement),
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(detail).toBeHidden();
  await expect(page).toHaveURL(/\/applications$/);
});
