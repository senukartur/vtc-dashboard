import type { Page } from "@playwright/test";
import { expect } from "./fixtures.ts";

// The live workspace switches language from the user menu; public, preview, anonymous and
// unavailable shells keep the banner select. Only one of the two is exposed at a time.
export function userMenuTrigger(page: Page) {
  return page.getByRole("button", { name: /(Account menu|Меню аккаунта)$/ });
}
export async function openUserMenu(page: Page) {
  await userMenuTrigger(page).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  return menu;
}
export async function switchLanguage(page: Page, locale: "ru" | "en") {
  const select = page.getByRole("banner").getByRole("combobox", { name: /^(Language|Язык)$/ });
  const trigger = userMenuTrigger(page);
  await expect(select.or(trigger)).toBeVisible();
  if (await select.isVisible()) await select.selectOption(locale);
  else {
    const menu = await openUserMenu(page);
    await menu
      .getByRole("menuitemradio", { name: locale === "en" ? "English" : "Русский", exact: true })
      .click();
    await expect(menu).toHaveCount(0);
  }
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
}
export async function signOutFromMenu(page: Page) {
  const menu = await openUserMenu(page);
  await menu.getByRole("menuitem", { name: /^(Sign out|Выйти)$/ }).click();
}
