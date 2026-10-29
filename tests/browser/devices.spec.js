import { test, expect } from "@playwright/test";
import { navigate, openMenu } from "./navigation.js";

async function account(page) {
  await page.goto("/#signup");
  await page.getByLabel("Your name").fill("Device audit");
  await page
    .getByLabel("Email address")
    .fill(`test-device-${Date.now()}-${Math.random()}@example.com`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("device-regression-password");
  await expect(page.getByLabel("Your name")).toHaveValue("Device audit");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Make your next move, Device." }),
  ).toBeVisible();
}
async function create(page, data) {
  const response = await page.request.post("/api/records/application", {
    headers: { "X-Offerly-Request": "1" },
    data,
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}
const noOverflow = async (page) =>
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);

test("workspace supports compact, landscape, tablet and wide-screen navigation", async ({
  page,
}, testInfo) => {
  await account(page);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await create(page, {
    company: "Device Lab",
    title:
      "Senior Product Engineer — Accessible Design Systems and Platform Infrastructure",
    stage: "Interviewing",
    owner: "You",
  });
  await page.reload();
  const initial = page.viewportSize();
  for (const size of [
    initial,
    { width: 568, height: 320 },
    { width: 320, height: 568 },
  ]) {
    await page.setViewportSize(size);
    for (const destination of [
      "Applications",
      "Connections",
      "Documents",
      "Reviews",
      "Insights",
      "Settings",
      "Today",
    ]) {
      await navigate(page, destination);
      await noOverflow(page);
      if (destination === "Applications" && size.width <= 640) {
        const roleTarget = await page
          .locator(".table-role")
          .first()
          .boundingBox();
        const selectTarget = await page
          .locator(".selection-target")
          .first()
          .boundingBox();
        expect(
          roleTarget.x + roleTarget.width,
          "Role and selection targets must not overlap",
        ).toBeLessThanOrEqual(selectTarget.x);
      }
    }
  }
  await page.setViewportSize(initial);
  await navigate(page, "Applications");
  const role = page.getByRole("button", {
    name: /Senior Product Engineer.*Device Lab/,
  });
  if (testInfo.project.use.hasTouch) await role.tap();
  else await role.click();
  const detail = page.getByRole("dialog", { name: "Application details" });
  await expect(detail).toBeVisible();
  await detail.getByRole("button", { name: "Edit application" }).focus();
  await detail.getByRole("button", { name: "Edit application" }).click();
  await page
    .getByRole("dialog", { name: "application editor" })
    .getByRole("button", { name: "Close editor" })
    .click();
  await expect(
    detail.getByRole("button", { name: "Edit application" }),
  ).toBeFocused();
  await detail.getByRole("button", { name: "Close details" }).click();
  await openMenu(page);
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }).first(),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("editor follows visual viewport changes and keeps touch controls reachable", async ({
  page,
}) => {
  await account(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Add application", exact: true })
    .click();
  const editor = page.getByRole("dialog", { name: "application editor" });
  await editor.getByLabel("Company", { exact: true }).fill("Keyboard Lab");
  await editor.getByLabel("Role title").fill("Product engineer");
  // Deterministic keyboard/pan simulation, not a claim about physical hardware.
  await page.evaluate(() => {
    Object.defineProperty(visualViewport, "height", {
      configurable: true,
      get: () => 300,
    });
    Object.defineProperty(visualViewport, "offsetTop", {
      configurable: true,
      get: () => 80,
    });
    visualViewport.dispatchEvent(new Event("resize"));
  });
  await expect
    .poll(async () =>
      editor.evaluate((el) => Math.round(el.getBoundingClientRect().bottom)),
    )
    .toBeLessThanOrEqual(380);
  await expect
    .poll(async () =>
      editor.evaluate((el) => Math.round(el.getBoundingClientRect().top)),
    )
    .toBeGreaterThanOrEqual(80);
  const save = editor.getByRole("button", { name: "Save application" });
  await expect(save).toBeVisible();
  expect(
    await save.evaluate((el) => el.getBoundingClientRect().bottom <= 380),
  ).toBe(true);
  const company = editor.getByLabel("Company", { exact: true });
  await company.focus();
  await expect
    .poll(async () =>
      company.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return r.top >= 80 && r.bottom <= 380;
      }),
    )
    .toBe(true);
  expect(
    await company.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
  ).toBeGreaterThanOrEqual(16);
  await save.click();
  await expect(editor).toBeHidden();
  await page.evaluate(() => {
    delete visualViewport.height;
    delete visualViewport.offsetTop;
    visualViewport.dispatchEvent(new Event("resize"));
  });
  await navigate(page, "Applications");
  await expect(page.getByRole("table")).toContainText("Keyboard Lab");
  if (await page.evaluate(() => matchMedia("(pointer: coarse)").matches)) {
    for (const name of ["Table view", "Board view", "Import CSV"]) {
      const box = await page
        .getByRole("button", { name, exact: true })
        .boundingBox();
      expect(box.height, name + " height").toBeGreaterThanOrEqual(44);
      expect(box.width, name + " width").toBeGreaterThanOrEqual(44);
    }
  }
});

test("large application lists keep all records reachable with bounded rendering", async ({
  page,
}) => {
  test.setTimeout(60000);
  await account(page);
  for (let i = 0; i < 60; i++)
    await create(page, {
      company: `Device ${String(i).padStart(2, "0")}`,
      title: `Engineer ${i}`,
      stage: "Saved",
      owner: "You",
    });
  await page.reload();
  await navigate(page, "Applications");
  await page.getByLabel("Sort applications").selectOption("company");
  await expect(page.locator(".application-table tbody tr")).toHaveCount(25);
  await expect(
    page.getByRole("status", { name: "Application page" }),
  ).toContainText("1–25 of 60");
  await page.getByLabel("Select Device 00 · Engineer 0").check();
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(page.locator(".application-table tbody tr")).toHaveCount(25);
  await expect(
    page.getByRole("status", { name: "Application page" }),
  ).toContainText("26–50 of 60");
  await expect(
    page.getByRole("region", { name: "Bulk application editor" }),
  ).toContainText("1 selected");
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(page.locator(".application-table tbody tr")).toHaveCount(10);
  await page.getByLabel("Search applications").fill("Device 59");
  await expect(page.locator(".application-table tbody tr")).toHaveCount(1);
  await expect(page.getByRole("table")).toContainText("Engineer 59");
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Board view" }).click();
  await expect(page.locator(".job-card")).toHaveCount(25);
  await page
    .getByRole("button", { name: "Show more Saved applications", exact: true })
    .click();
  await expect(page.locator(".job-card")).toHaveCount(50);
  await expect(page.locator(".job-card").nth(25)).toBeFocused();
  await page
    .getByRole("button", { name: "Show more Saved applications", exact: true })
    .click();
  await expect(page.locator(".job-card")).toHaveCount(60);
  await expect(page.locator(".job-card").nth(50)).toBeFocused();
  await page.getByRole("button", { name: "Table view" }).click();
  await page.getByLabel("Select matching applications (up to 100)").check();
  await expect(
    page.getByRole("region", { name: "Bulk application editor" }),
  ).toContainText("60 selected");
  await noOverflow(page);
});
