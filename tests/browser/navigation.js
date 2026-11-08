// Exercise the same responsive menu a person uses, rather than forcing hidden clicks.
export async function navigate(page, name) {
  await page.locator(".sidebar").waitFor();
  const details = page.getByRole("dialog", { name: "Application details" });
  if (/^\/applications\/[^/]+$/.test(new URL(page.url()).pathname)) {
    await details
      .or(
        page.getByRole("heading", {
          name: "Application unavailable",
          exact: true,
        }),
      )
      .waitFor();
    if (await details.isVisible())
      await details.getByRole("button", { name: "Close details" }).click();
  } else if (await details.isVisible()) {
    await details.getByRole("button", { name: "Close details" }).click();
  }
  const menu = page.locator(".mobile-menu");
  if (
    (await menu.isVisible()) &&
    (await menu.getAttribute("aria-expanded")) === "false"
  ) {
    await menu.click();
  }
  const target = name === "Applications" ? /^Applications/ : name;
  await page
    .getByRole("navigation")
    .getByRole("link", { name: target, exact: typeof target === "string" })
    .click();
  await page.locator(".loading").waitFor({ state: "hidden" });
  await page
    .locator(".shell")
    .or(page.getByRole("heading", { name: "Welcome back.", exact: true }))
    .waitFor({ state: "visible" });
}
export async function openMenu(page) {
  await page.locator(".sidebar").waitFor();
  const menu = page.locator(".mobile-menu");
  if (
    (await menu.isVisible()) &&
    (await menu.getAttribute("aria-expanded")) === "false"
  )
    await menu.click();
}
