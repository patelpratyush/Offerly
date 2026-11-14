import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Synthetic account and records only; they live in the temporary browser-test DB.
async function account(page, name = "Shell") {
  await page.goto("/#signup");
  await page.getByLabel("Your name").fill(name);
  await page
    .getByLabel("Email address")
    .fill(`test-shell-${Date.now()}-${Math.random()}@example.com`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("shell-regression-password");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(
    page.getByRole("heading", { name: `Make your next move, ${name}.` }),
  ).toBeVisible();
}
const post = async (page, path, data) => {
  const response = await page.request.post(`/api${path}`, {
    headers: { "X-Offerly-Request": "1" },
    data,
  });
  expect(response.ok(), await response.text()).toBe(true);
};
const nav = (page) => page.getByRole("navigation", { name: "Workspace" });

test("rail exposes native station links with route-derived state", async ({
  page,
}) => {
  await account(page);
  const links = nav(page).getByRole("link");
  await expect(links).toHaveCount(10);
  await expect(
    nav(page).getByRole("link", { name: "Today", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(links.first()).toHaveAttribute("href", "/today");
  await nav(page).getByRole("link", { name: "Documents", exact: true }).click();
  await expect(page).toHaveURL(/\/documents$/);
  await expect(
    nav(page).getByRole("link", { name: "Documents", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".topbar")).toContainText("DOC");
  await expect(page.locator(".topbar time")).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to workspace" }),
  ).toBeVisible();
});

test("command palette jumps to pages and applications without leaking text into the URL", async ({
  page,
}) => {
  await account(page);
  await post(page, "/records/application", {
    company: "Acme Rail",
    title: "Signalling Engineer",
    stage: "Interviewing",
    priority: "Medium",
    owner: "You",
    source: "Manual",
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Make your next move, Shell." }),
  ).toBeVisible();
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "Command palette" });
  const box = dialog.getByRole("combobox");
  await expect(box).toBeFocused();
  await expect(box).toHaveAttribute("aria-expanded", "true");
  await box.fill("signal");
  await expect(
    dialog.getByRole("option", { name: /Acme Rail — Signalling Engineer/ }),
  ).toBeVisible();
  await expect(dialog.getByRole("status")).toContainText("1 results");
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  const detail = page.getByRole("dialog", { name: "Application details" });
  await expect(detail).toBeVisible();
  expect(page.url()).not.toContain("Acme");
  expect(page.url()).not.toContain("signal");
  await detail.getByRole("button", { name: "Close details" }).click();

  // Pages, and focus returns to where the palette was opened from.
  await page.keyboard.press("/");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("combobox").fill("insights");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/insights$/);
  await page.keyboard.press("Control+k");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  // No match shows an honest empty state.
  await page.keyboard.press("Control+k");
  await dialog.getByRole("combobox").fill("zzzzqqq");
  await expect(dialog.getByText("Nothing matches")).toBeVisible();
  await page.keyboard.press("Escape");
});

test("palette adds an application or a task", async ({ page }) => {
  await account(page);
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox").fill("add task");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "task editor" })).toBeVisible();
  // The dialog's Escape handler attaches just after it paints; retry the key.
  await expect(async () => {
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "task editor" })).toBeHidden({
      timeout: 1000,
    });
  }).toPass({ timeout: 8000 });
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox").fill("add app");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("dialog", { name: "application editor" }),
  ).toBeVisible();
});

test("single-key shortcuts navigate, pause while typing and in dialogs", async ({
  page,
}) => {
  await account(page);
  await page.keyboard.press("g");
  await page.keyboard.press("a");
  await expect(page).toHaveURL(/\/applications$/);
  await expect(
    page.getByRole("status").filter({ hasText: "Opened Applications" }),
  ).toHaveCount(1);
  await page.keyboard.press("g");
  await page.keyboard.press("s");
  await expect(page).toHaveURL(/\/settings$/);
  await page.keyboard.press("g");
  await page.keyboard.press("t");
  await expect(page).toHaveURL(/\/today$/);

  await page.keyboard.press("?");
  const help = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(help).toBeVisible();
  await page.keyboard.press("g");
  await page.keyboard.press("a");
  await expect(page).toHaveURL(/\/today$/);
  await page.keyboard.press("Escape");
  await expect(help).toBeHidden();

  await page.keyboard.press("n");
  const editor = page.getByRole("dialog", { name: "application editor" });
  await expect(editor).toBeVisible();
  // Typing in a field and with a dialog open never triggers shortcuts.
  await editor.getByLabel("Company", { exact: true }).fill("ngn/ g?");
  await expect(editor.getByLabel("Company", { exact: true })).toHaveValue(
    "ngn/ g?",
  );
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(editor).toBeHidden();

  // Typing in a page search field must not fire either.
  await page.goto("/applications");
  const search = page.getByRole("searchbox").first();
  if (await search.count()) {
    await search.fill("n?g");
    await expect(search).toHaveValue("n?g");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
});

test("shell has no accessibility violations and mobile shows the station bar", async ({
  page,
}, testInfo) => {
  await account(page);
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "Command palette" });
  const audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    audit.violations.map((v) => ({
      id: v.id,
      targets: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  const shellAudit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    shellAudit.violations.map((v) => ({
      id: v.id,
      targets: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
  if (testInfo.project.name === "mobile") {
    const box = await nav(page).boundingBox();
    const viewport = page.viewportSize();
    expect(box.y + box.height).toBeGreaterThanOrEqual(viewport.height - 1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await nav(page).getByRole("link", { name: "Reviews", exact: true }).click();
    await expect(page).toHaveURL(/\/reviews$/);
    await page.getByRole("button", { name: "Jump to…" }).click();
    await expect(dialog).toBeVisible();
  }
});
