import type { Locator, Page, TestInfo } from "@playwright/test";
import { capabilities, type Role } from "../../apps/api/src/modules/identity/permissions.ts";
import { accountFixture, fixtureId } from "../../apps/web/src/features/account/fixtures.ts";
import { eventFixture } from "./support/events.ts";
import { expect, test } from "./support/fixtures.ts";
import { openUserMenu, switchLanguage, userMenuTrigger } from "./support/locale.ts";
import { inertNotifications } from "./support/notifications.ts";

const meta = { requestId: "synthetic-navigation" };
const error = (status: number) => ({ status, json: { error: { code: "PRIVATE_SENTINEL" } } });
// Synthetic shell fixture: one fictional member whose roles map through the real server capabilities.
async function mockWorkspace(page: Page, roles: Role[] = ["trainee"]) {
  const state = { me: 200, logout: 200 };
  const self = accountFixture();
  self.data.member.roles = [...roles];
  self.data.capabilities = capabilities(roles);
  await page.route("**/api/v1/**", (route) => {
    const notification = inertNotifications(route);
    if (notification) return notification;
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/auth/csrf")
      return route.fulfill({ json: { data: { token: "NONFUNCTIONAL_FIXTURE" }, meta } });
    if (path === "/api/v1/me")
      return route.fulfill(
        state.me === 200 ? { json: self, headers: { ETag: '"v1"' } } : error(state.me),
      );
    if (path === "/api/v1/me/upcoming-event")
      return route.fulfill({ json: { data: eventFixture(), meta } });
    if (path === "/api/v1/me/email-change")
      return route.fulfill({ json: { data: { pending: null }, meta } });
    if (path === "/api/v1/auth/logout")
      return route.fulfill(
        state.logout === 200 ? { json: { data: { id: fixtureId, version: 2 }, meta } } : error(503),
      );
    if (path === "/api/v1/auth/login") {
      state.me = 200;
      return route.fulfill({ json: self, headers: { ETag: '"v1"' } });
    }
    return route.fulfill(error(503));
  });
  return state;
}
const wide = (page: Page) => (page.viewportSize()?.width ?? 0) > 1050;
const mainNavigation = (page: Page) =>
  page.getByRole("navigation", { name: /^(Main navigation|Основная навигация)$/ });
const menuButton = (page: Page) =>
  page.getByRole("button", { name: /^(Open navigation|Открыть навигацию)$/ });
/** Runs checks against the sidebar on desktop or the navigation dialog on tablet/phone. */
async function inNavigation(page: Page, check: (navigation: Locator) => Promise<void>) {
  await expect(userMenuTrigger(page)).toBeVisible();
  const dialog = !wide(page);
  if (dialog) {
    await menuButton(page).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  }
  await check(mainNavigation(page));
  if (dialog) {
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
}
async function contrast(locator: Locator) {
  return locator.evaluate((element) => {
    const rgba = (value: string) => {
      const numbers = value.match(/[\d.]+/g)?.map(Number) ?? [];
      return [numbers[0] ?? 0, numbers[1] ?? 0, numbers[2] ?? 0, numbers[3] ?? 1];
    };
    const mix = (front: number[], back: number[]) =>
      [0, 1, 2].map(
        (index) =>
          (front[index] ?? 0) * (front[3] ?? 1) + (back[index] ?? 0) * (1 - (front[3] ?? 1)),
      );
    const ancestors: Element[] = [];
    for (let node: Element | null = element; node; node = node.parentElement)
      ancestors.unshift(node);
    let background = [255, 255, 255];
    for (const node of ancestors)
      background = mix(rgba(getComputedStyle(node).backgroundColor), background);
    const foreground = mix(rgba(getComputedStyle(element).color), background);
    const luminance = (color: number[]) =>
      color
        .map((value) => value / 255)
        .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
        .reduce((sum, value, index) => sum + value * ([0.2126, 0.7152, 0.0722][index] ?? 0), 0);
    const a = luminance(foreground),
      b = luminance(background);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
}
async function capture(page: Page, info: TestInfo, name: string) {
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: false });
}

const company = ["Events", "Drivers", "Qualifications"];
const review = ["Dispatch", "Duplicate reconciliation"];
const management = ["Applications", "Members and roles", "Game catalogs", "Company settings"];
for (const { roles, groups, report } of [
  {
    roles: ["trainee"],
    groups: { "My work": ["Overview", "My trips", "Drafts"], Company: company },
    report: true,
  },
  {
    roles: ["dispatcher"],
    groups: { "My work": ["Overview", "My trips"], Company: company, Review: review },
    report: false,
  },
  {
    roles: ["driver", "dispatcher"],
    groups: { "My work": ["Overview", "My trips", "Drafts"], Company: company, Review: review },
    report: true,
  },
  {
    roles: ["deputy_director"],
    groups: {
      "My work": ["Overview", "My trips"],
      Company: company,
      Review: review,
      Management: management,
    },
    report: false,
  },
] as { roles: Role[]; groups: Record<string, string[]>; report: boolean }[])
  test(`${roles.join("+")} sees only its navigation groups and personal pages stay in the user menu`, async ({
    page,
  }, info) => {
    await mockWorkspace(page, roles);
    await page.goto("/account/dashboard");
    await inNavigation(page, async (navigation) => {
      for (const name of ["My work", "Company", "Review", "Management"]) {
        const list = navigation.getByRole("list", { name, exact: true });
        if (groups[name]) await expect(list.getByRole("link")).toHaveText(groups[name]);
        else await expect(list).toHaveCount(0);
      }
      await expect(
        navigation.getByRole("link", {
          name: /^(Account|Account and security|Connections|Steam, TruckersMP and telemetry|Notifications|Home)$/,
        }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("link", { name: "New report", exact: true }).filter({ visible: true }),
      ).toHaveCount(report ? 1 : 0);
    });
    if (roles.includes("deputy_director")) {
      await switchLanguage(page, "ru");
      await inNavigation(page, async (navigation) => {
        await expect(
          navigation.getByRole("list", { name: "Моя работа", exact: true }).getByRole("link"),
        ).toHaveText(["Обзор", "Мои рейсы"]);
        await expect(
          navigation.getByRole("list", { name: "Управление", exact: true }).getByRole("link"),
        ).toHaveText(["Заявки", "Участники и роли", "Каталоги игр", "Настройки компании"]);
      });
      await capture(page, info, `navigation-${roles.join("-")}-ru`);
    }
  });

test("breadcrumb, document title and current markers follow the route in RU and EN", async ({
  page,
}) => {
  await mockWorkspace(page, ["driver", "deputy_director"]);
  const crumb = page.getByRole("navigation", { name: /^(Breadcrumb|Навигационная цепочка)$/ });
  const current = async (link: string, value: string | null) =>
    inNavigation(page, async (navigation) => {
      const target = navigation.getByRole("link", { name: link, exact: true });
      if (value) await expect(target).toHaveAttribute("aria-current", value);
      else await expect(target).not.toHaveAttribute("aria-current", /.+/);
    });
  await page.goto("/account/trips");
  await expect(crumb.getByRole("listitem")).toHaveText(["My work", "My trips"]);
  await expect(crumb.locator('[aria-current="page"]')).toHaveText("My trips");
  await expect(page).toHaveTitle("My trips · Yukon Union");
  await current("My trips", "page");
  const banner = page.getByRole("banner");
  await expect(banner.locator(".event-nearest strong")).toContainText(
    "Fictional Yukon evening convoy",
  );
  await expect(banner.getByRole("button", { name: /Open notifications/ })).toBeVisible();
  await page.goto(`/account/drivers/${fixtureId}`);
  await expect(crumb.getByRole("listitem")).toHaveText(["Company", "Drivers", "Driver profile"]);
  await expect(crumb.getByRole("link", { name: "Drivers", exact: true })).toHaveAttribute(
    "href",
    "/account/drivers",
  );
  await current("Drivers", "true");
  await page.goto("/account/review/reconciliation");
  await expect(crumb.getByRole("listitem")).toHaveText(["Review", "Duplicate reconciliation"]);
  await current("Duplicate reconciliation", "page");
  await current("Dispatch", null);
  await page.goto("/account/admin/members");
  await expect(crumb.getByRole("listitem")).toHaveText(["Management", "Members and roles"]);
  await page.goto("/account");
  await expect(crumb.getByRole("listitem")).toHaveText(["Account", "Account and security"]);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Account and security");
  await switchLanguage(page, "ru");
  await expect(crumb.getByRole("listitem")).toHaveText(["Аккаунт", "Аккаунт и безопасность"]);
  await expect(page).toHaveTitle("Аккаунт и безопасность · Yukon Union");
});

test("user menu is keyboard operable, routes to main and switches language without losing input", async ({
  page,
}) => {
  await mockWorkspace(page);
  await page.goto("/account/trips");
  const trigger = userMenuTrigger(page);
  await expect(trigger).toBeVisible();
  // Desktop keeps it in the sidebar footer; tablet and phone move it into the topbar.
  await expect(page.getByRole("banner").getByRole("button", { name: /Account menu$/ })).toHaveCount(
    wide(page) ? 0 : 1,
  );
  await trigger.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem")).toHaveText([
    "My driver profile",
    "Account and security",
    "Steam, TruckersMP and telemetry",
    "Public site",
    "Sign out",
  ]);
  await expect(menu.getByRole("menuitem", { name: "My driver profile" })).toHaveAttribute(
    "href",
    `/account/drivers/${fixtureId}`,
  );
  await expect(menu.getByRole("menuitemradio")).toHaveText(["Русский", "English"]);
  await expect(menu.getByRole("menuitemradio", { name: "English" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(menu.getByRole("menuitem", { name: "My driver profile" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "Account and security" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "My driver profile" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "Account and security" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole("main")).toBeFocused();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Account and security");
  await page.getByLabel("Display timezone", { exact: true }).fill("Europe/Warsaw");
  const opened = await openUserMenu(page);
  await opened.getByRole("menuitemradio", { name: "Русский", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  await expect(trigger).toBeFocused();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Аккаунт и безопасность");
  await expect(page.getByLabel("Часовой пояс отображения", { exact: true })).toHaveValue(
    "Europe/Warsaw",
  );
});

test("language select stays only where no authenticated user menu exists", async ({ page }) => {
  const state = await mockWorkspace(page);
  const select = page.getByRole("banner").getByRole("combobox", { name: /^(Language|Язык)$/ });
  await page.goto("/account/trips");
  await expect(userMenuTrigger(page)).toBeVisible();
  await expect(page.getByRole("banner").getByRole("combobox")).toHaveCount(0);
  await page.goto("/login");
  await expect(select).toBeVisible();
  state.me = 401;
  await page.goto("/account");
  await expect(
    page.getByRole("heading", {
      name: /^(Sign in to open your account|Войдите, чтобы открыть аккаунт)$/,
    }),
  ).toBeVisible();
  await expect(select).toBeVisible();
  await expect(userMenuTrigger(page)).toHaveCount(0);
});

test("pages no longer repeat shell navigation", async ({ page }) => {
  await mockWorkspace(page, ["driver", "deputy_director"]);
  await page.goto("/account/admin/settings");
  await expect(page.getByRole("navigation", { name: /Breadcrumb/ })).toBeVisible();
  await expect(
    page.getByRole("navigation", {
      name: /^(Administration and connections|Администрирование и подключения)$/,
    }),
  ).toHaveCount(0);
  await page.goto("/account/trips");
  const main = page.getByRole("main");
  await expect(main.getByRole("link", { name: "Saved drafts", exact: true })).toBeVisible();
  await expect(main.getByRole("link", { name: "New report", exact: true })).toBeVisible();
  await expect(
    main.getByRole("link", {
      name: /^(Dispatch|Review workspace|Reconciliation|Duplicate reconciliation)$/,
    }),
  ).toHaveCount(0);
});

test("desktop sidebar collapses to a persistent icon rail with accessible labels", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop-chromium", "The icon rail exists only above 1050px.");
  await mockWorkspace(page);
  await page.goto("/account/trips");
  const sidebar = page.getByRole("complementary", { name: "Workspace", exact: true });
  const collapse = page.getByRole("button", { name: "Collapse sidebar", exact: true });
  await expect(collapse).toHaveAttribute("aria-expanded", "true");
  await collapse.click();
  const expand = page.getByRole("button", { name: "Expand sidebar", exact: true });
  await expect(expand).toHaveAttribute("aria-expanded", "false");
  await expect
    .poll(async () => (await sidebar.boundingBox())?.width ?? 999)
    .toBeLessThanOrEqual(64);
  const events = mainNavigation(page).getByRole("link", { name: "Events", exact: true });
  await expect(events).toHaveAttribute("title", "Events");
  await capture(page, info, "navigation-rail");
  await events.click();
  await expect(page).toHaveURL(/\/account\/events$/);
  await page.reload();
  await expect(expand).toHaveAttribute("aria-expanded", "false");
  await expect
    .poll(async () => (await sidebar.boundingBox())?.width ?? 999)
    .toBeLessThanOrEqual(64);
  await expand.click();
  await expect(collapse).toHaveAttribute("aria-expanded", "true");
  await expect.poll(async () => (await sidebar.boundingBox())?.width ?? 0).toBeGreaterThan(150);
  await expect(events).not.toHaveAttribute("title", /.+/);
});

test("sign-in lands on Overview unless returning to a protected deep link", async ({ page }) => {
  const state = await mockWorkspace(page);
  state.me = 401;
  async function signIn() {
    await expect(page).toHaveURL(/\/login$/);
    await switchLanguage(page, "en");
    await page.getByLabel("Email", { exact: true }).fill("member@example.invalid");
    await page.getByLabel("Password", { exact: true }).fill("NONFUNCTIONAL_FIXTURE");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  await page.goto("/login");
  await signIn();
  await expect(page).toHaveURL(/\/account\/dashboard$/);
  await expect(
    page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("listitem"),
  ).toHaveText(["My work", "Overview"]);
  state.me = 401;
  await page.goto("/account/trips?scope=company");
  await page
    .getByRole("main")
    .getByRole("link", { name: /^(Sign in|Войти)$/ })
    .click();
  await signIn();
  await expect(page).toHaveURL(/\/account\/trips\?scope=company$/);
});

test("skip link, route focus and navigation dialog restoration still hold", async ({ page }) => {
  await mockWorkspace(page);
  await page.goto("/account/trips");
  await expect(userMenuTrigger(page)).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  if (wide(page)) {
    await mainNavigation(page).getByRole("link", { name: "Events", exact: true }).click();
    await expect(page).toHaveURL(/\/account\/events$/);
    await expect(page.getByRole("main")).toBeFocused();
    return;
  }
  const menu = menuButton(page);
  const dialog = page.getByRole("dialog", { name: "Navigation", exact: true });
  for (const step of ["route", "current", "escape"] as const) {
    await menu.click();
    await expect(dialog).toBeVisible();
    if (step === "escape") await page.keyboard.press("Escape");
    else await dialog.getByRole("link", { name: "Events", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(menu).toBeFocused();
  }
  await expect(page).toHaveURL(/\/account\/events$/);
});

test("navigation rows use the compact scale with visible hover and readable contrast", async ({
  page,
}) => {
  await mockWorkspace(page);
  await page.goto("/account/trips");
  const coarse = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
  await inNavigation(page, async (navigation) => {
    const idle = navigation.getByRole("link", { name: "Events", exact: true });
    const active = navigation.getByRole("link", { name: "My trips", exact: true });
    const title = navigation.getByText("Company", { exact: true });
    const height = (await idle.boundingBox())?.height ?? 0;
    if (coarse) expect(height).toBeGreaterThanOrEqual(40);
    else {
      expect(height).toBeGreaterThanOrEqual(29.5);
      expect(height).toBeLessThan(44);
    }
    for (const target of [idle, active, title])
      expect(await contrast(target)).toBeGreaterThanOrEqual(4.5);
    if (wide(page)) {
      await idle.hover();
      await expect(idle).toHaveCSS("background-color", "rgb(24, 34, 56)");
      expect(await contrast(idle)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

test("sign-out from the user menu ends the session or keeps private content hidden until rechecked", async ({
  page,
}) => {
  const state = await mockWorkspace(page);
  state.logout = 503;
  await page.goto("/account");
  await expect(
    page.getByRole("main").getByText("Fictional Yukon Member", { exact: true }),
  ).toBeVisible();
  let menu = await openUserMenu(page);
  await menu.getByRole("menuitem", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("main").getByRole("status")).toContainText(
    "Sign-out could not be confirmed",
  );
  await expect(userMenuTrigger(page)).toHaveCount(0);
  await expect(page.getByText("Fictional Yukon Member", { exact: true })).toHaveCount(0);
  await expect(page.locator(".account-address")).toHaveCount(0);
  await page.getByRole("button", { name: "Check session before returning", exact: true }).click();
  await expect(userMenuTrigger(page)).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Account and security");
  state.logout = 200;
  menu = await openUserMenu(page);
  await menu.getByRole("menuitem", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Sign in to open your account", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("main")).toBeFocused();
  await expect(userMenuTrigger(page)).toHaveCount(0);
});
