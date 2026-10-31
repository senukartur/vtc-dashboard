import type { Page } from "@playwright/test";
import { expect } from "./fixtures.ts";

// The live workspace switches language from the user menu (tablet/desktop) or the More sheet of
// the phone bottom bar; public, preview, anonymous and unavailable shells keep the banner select.
// Only one of them is exposed at a time.
export function userMenuTrigger(page: Page) {
  return page.getByRole("button", { name: /(Account menu|Меню аккаунта)$/ });
}
/** Phones (below 768px) use the bottom bar and More sheet instead of the topbar user menu. */
export function phone(page: Page) {
  return (page.viewportSize()?.width ?? 0) < 768;
}
export function moreButton(page: Page) {
  return page
    .getByRole("navigation", { name: /^(Main sections|Основные разделы)$/ })
    .getByRole("button", { name: /^(More|Ещё)$/ });
}
/** The visible way into account items: More on phones, the user menu trigger elsewhere. */
export function accountEntry(page: Page) {
  return phone(page) ? moreButton(page) : userMenuTrigger(page);
}
export async function openUserMenu(page: Page) {
  await userMenuTrigger(page).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  return menu;
}
export async function openMoreSheet(page: Page) {
  await moreButton(page).click();
  const sheet = page.getByRole("dialog", { name: /^(More|Ещё)$/ });
  await expect(sheet).toBeVisible();
  return sheet;
}
/** Chooses a routed account item from the More sheet on phones or the user menu elsewhere. */
export async function chooseAccountItem(page: Page, name: RegExp) {
  if (phone(page)) await (await openMoreSheet(page)).getByRole("link", { name }).click();
  else await (await openUserMenu(page)).getByRole("menuitem", { name }).click();
}
export async function switchLanguage(page: Page, locale: "ru" | "en") {
  const select = page.getByRole("banner").getByRole("combobox", { name: /^(Language|Язык)$/ });
  await expect(select.or(accountEntry(page))).toBeVisible();
  const language = locale === "en" ? "English" : "Русский";
  if (await select.isVisible()) await select.selectOption(locale);
  else if (phone(page)) {
    const sheet = await openMoreSheet(page);
    const option = sheet
      .getByRole("group", { name: /^(Language|Язык)$/ })
      .getByRole("button", { name: language, exact: true });
    await option.click();
    await expect(option).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
  } else {
    const menu = await openUserMenu(page);
    await menu.getByRole("menuitemradio", { name: language, exact: true }).click();
    await expect(menu).toHaveCount(0);
  }
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
}
export async function signOutFromMenu(page: Page) {
  if (phone(page))
    await (await openMoreSheet(page)).getByRole("button", { name: /^(Sign out|Выйти)$/ }).click();
  else {
    const menu = await openUserMenu(page);
    await menu.getByRole("menuitem", { name: /^(Sign out|Выйти)$/ }).click();
  }
}
