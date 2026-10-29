// Exercise the same responsive menu a person uses, rather than forcing hidden clicks.
export async function navigate(page, name) {
  await page.locator(".sidebar").waitFor();
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
    .getByRole("button", { name: target, exact: typeof target === "string" })
    .click();
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
