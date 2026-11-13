import type { Locator, Page, TestInfo } from "@playwright/test";
import type { components } from "@vtc/contracts";
import { capabilities, type Role } from "../../apps/api/src/modules/identity/permissions.ts";
import { accountFixture, fixtureId } from "../../apps/web/src/features/account/fixtures.ts";
import { eventFixture } from "./support/events.ts";
import { browserCase, expect, test } from "./support/fixtures.ts";
import {
  accountEntry,
  moreButton,
  openMoreSheet,
  openUserMenu,
  phone,
  signOutFromMenu,
  switchLanguage,
  userMenuTrigger,
} from "./support/locale.ts";
import { inertNotifications } from "./support/notifications.ts";

const meta = { requestId: "synthetic-navigation" };
const computedAt = "2026-11-12T08:00:00.000Z";
const summaryPath = "/api/v1/me/workspace-summary";
type Summary = components["schemas"]["WorkspaceSummary"];
const error = (status: number) => ({ status, json: { error: { code: "PRIVATE_SENTINEL" } } });
// Synthetic shell fixture: one fictional member whose roles map through the real server capabilities.
async function mockWorkspace(page: Page, roles: Role[] = ["trainee"], locale: "en" | "ru" = "en") {
  const self = accountFixture(locale);
  self.data.member.roles = [...roles];
  self.data.capabilities = capabilities(roles);
  const state = {
    self,
    me: 200,
    logout: 200,
    summaryStatus: 200,
    summaryReads: 0,
    summary: { computedAt } as Summary,
    stagedDispatch: false,
    summaryGate: undefined as Promise<void> | undefined,
    onSummary: undefined as (() => void) | undefined,
  };
  await page.route("**/api/v1/**", async (route) => {
    const notification = inertNotifications(route);
    if (notification) return notification;
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === "/api/v1/auth/csrf")
      return route.fulfill({ json: { data: { token: "NONFUNCTIONAL_FIXTURE" }, meta } });
    if (path === "/api/v1/me")
      return route.fulfill(
        state.me === 200 ? { json: self, headers: { ETag: '"v1"' } } : error(state.me),
      );
    if (path === "/api/v1/me/upcoming-event")
      return route.fulfill({ json: { data: eventFixture(), meta } });
    if (path === summaryPath) {
      state.summaryReads += 1;
      const { reviewQueue, ...sections } = state.summary;
      const dispatch =
        state.stagedDispatch && reviewQueue
          ? {
              reviewQueue: {
                computedAt,
                waitingCount: reviewQueue.count,
                oldestQueuedAt: computedAt,
                oldestAgeSeconds: reviewQueue.oldestAgeSeconds,
                duplicateCount: 0,
              },
            }
          : { legacyReviewQueue: reviewQueue };
      const response =
        url.searchParams.get("view") !== "stage3"
          ? error(422)
          : state.summaryStatus === 200
            ? { json: { data: { ...sections, ...dispatch }, meta } }
            : error(state.summaryStatus);
      state.onSummary?.();
      await state.summaryGate;
      return route.fulfill(response);
    }
    if (path === "/api/v1/me/manual-drafts")
      return route.fulfill({
        json: { data: { items: [], nextCursor: null, editingCount: 0 }, meta },
      });
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

test(
  "the reconciliation alias belongs to Dispatch when the staged summary selects it",
  browserCase(["@layout"]),
  async ({ page }) => {
    const state = await mockWorkspace(page, ["dispatcher"]);
    state.stagedDispatch = true;
    state.summary = { computedAt, reviewQueue: { count: 2, oldestAgeSeconds: 0 } };
    await page.goto("/account/review/reconciliation");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    if (phone(page)) {
      const dispatch = bottomBar(page).getByRole("link", { name: /^Dispatch/ });
      await expect(dispatch).toHaveAttribute("aria-current", "true");
      await inNavigation(page, async (nav) => {
        await expect(nav.getByRole("link", { name: "Reconciliation", exact: true })).toHaveCount(0);
      });
    } else {
      await inNavigation(page, async (nav) => {
        await expect(nav.getByRole("link", { name: /^Dispatch/ })).toHaveAttribute(
          "aria-current",
          "true",
        );
        await expect(nav.getByRole("link", { name: "Reconciliation", exact: true })).toHaveCount(0);
      });
    }
    expect(state.summaryReads).toBe(1);
  },
);
const wide = (page: Page) => (page.viewportSize()?.width ?? 0) > 1050;
const mainNavigation = (page: Page) =>
  page.getByRole("navigation", { name: /^(Main navigation|Основная навигация)$/ });
const menuButton = (page: Page) =>
  page.getByRole("button", { name: /^(Open navigation|Открыть навигацию)$/ });
const bottomBar = (page: Page) =>
  page.getByRole("navigation", { name: /^(Main sections|Основные разделы)$/ });
/** Checks bar link accessible names in order and the visible labels including More. */
async function expectBar(page: Page, names: string[], labels?: string[]) {
  const links = bottomBar(page).getByRole("link");
  await expect(links).toHaveCount(names.length);
  for (const [index, name] of names.entries())
    await expect(links.nth(index)).toHaveAccessibleName(name);
  await expect(moreButton(page)).toBeVisible();
  if (labels) await expect(bottomBar(page).getByRole("listitem")).toHaveText(labels);
}
/**
 * Runs checks against the sidebar on desktop, the navigation dialog on tablet or the More sheet
 * on phones (which lists only the sections that are not in the bottom bar).
 */
async function inNavigation(page: Page, check: (navigation: Locator) => Promise<void>) {
  await expect(accountEntry(page)).toBeVisible();
  if (phone(page)) {
    await openMoreSheet(page);
    await check(mainNavigation(page));
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    return;
  }
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
const reporterBar = ["Overview", "My trips", "New report", "Events"];
const reviewerBar = ["Overview", "My trips", "Review", "Events"];
const phoneCompany = ["Drivers", "Qualifications"];

for (const role of ["driver", "dispatcher", "deputy_director", "director"] as const) {
  test(
    `workspace attention names and destinations for ${role}`,
    browserCase(["@layout"]),
    async ({ page }, info) => {
      const state = await mockWorkspace(page, [role]);
      const canReview = role !== "driver";
      const canManage = role === "director" || role === "deputy_director";
      state.summary = {
        computedAt,
        tripsNeedingFixes: { count: 125, items: [] },
        ...(role === "driver" ? { unansweredUpcomingEvents: { count: 4, items: [] } } : {}),
        ...(canReview ? { reviewQueue: { count: 2, oldestAgeSeconds: 0 } } : {}),
        ...(canManage ? { newApplicationsCount: 3 } : {}),
      };
      await page.goto("/account/dashboard");
      await expect(
        page.getByRole("region", { name: "Needs attention", exact: true }),
      ).toContainText("Trips returned for fixes (125)");
      expect(state.summaryReads).toBe(1);
      const onPhone = phone(page);
      for (const locale of ["en", "ru"] as const) {
        if (locale === "ru") await switchLanguage(page, locale);
        const russian = locale === "ru";
        const tripName = russian
          ? "Мои рейсы (на исправление: 125)"
          : "My trips (125 returned for fixes)";
        const eventName = russian ? "События" : "Events";
        const eventCountName = russian
          ? "События (ждут вашего ответа: 4)"
          : "Events (4 awaiting your response)";
        const reviewName = onPhone
          ? russian
            ? "Проверка"
            : "Review"
          : russian
            ? "Диспетчерская"
            : "Dispatch";
        const appsName = russian
          ? "Заявки (на рассмотрении: 3)"
          : "Applications (3 awaiting review)";
        const main = async (nav: Locator) => {
          const trips = nav.getByRole("link", { name: tripName, exact: true });
          await expect(trips).toHaveAttribute("href", "/account/trips");
          await expect(trips.getByText("99+", { exact: true })).toBeVisible();
          const events = nav.getByRole("link", {
            name: role === "driver" ? eventCountName : eventName,
            exact: true,
          });
          await expect(events).toHaveAttribute("href", "/account/events");
          const review = nav.getByRole("link", {
            name: `${reviewName} ${russian ? "(ждут решения: 2)" : "(2 awaiting decision)"}`,
            exact: true,
          });
          if (canReview) await expect(review).toHaveAttribute("href", "/account/review");
          else await expect(review).toHaveCount(0);
          if (info.project.name !== "mobile-chromium") {
            await trips.focus();
            await expect(trips).toBeFocused();
          }
        };
        if (onPhone) {
          await main(bottomBar(page));
          if (role === "director") await capture(page, info, `attention-bottom-${locale}`);
        }
        await inNavigation(page, async (nav) => {
          if (!onPhone) await main(nav);
          const apps = nav.getByRole("link", { name: appsName, exact: true });
          if (canManage) await expect(apps).toHaveAttribute("href", "/account/admin/applications");
          else await expect(apps).toHaveCount(0);
          if (role === "director") await capture(page, info, `attention-navigation-${locale}`);
        });
        if (wide(page) && role === "director") {
          await page.getByRole("button", { name: /^(Collapse sidebar|Свернуть меню)$/ }).click();
          await main(mainNavigation(page));
          await capture(page, info, `attention-collapsed-${locale}`);
          await page.getByRole("button", { name: /^(Expand sidebar|Развернуть меню)$/ }).click();
        }
      }
      expect(state.summaryReads).toBe(1);
    },
  );
}

test(
  "visible focus coalesces reads and keeps navigation geometry for zero and omitted counts",
  browserCase(["@layout"]),
  async ({ page }) => {
    const state = await mockWorkspace(page, ["driver"]);
    state.summary = { computedAt, tripsNeedingFixes: { count: 125, items: [] } };
    await page.goto("/account/dashboard");
    const check = async (nav: Locator) => {
      const link = nav.locator('a[href="/account/trips"]');
      await expect(link).toHaveAccessibleName("My trips (125 returned for fixes)");
      const before = await link.boundingBox();
      const icon = link.locator(".nav-icon");
      const beforeIcon = await icon.boundingBox();
      state.summary = { computedAt, tripsNeedingFixes: { count: 0, items: [] } };
      let release = () => {};
      state.summaryGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      try {
        await page.evaluate(() => {
          window.dispatchEvent(new Event("focus"));
          window.dispatchEvent(new Event("focus"));
          document.dispatchEvent(new Event("visibilitychange"));
        });
        await expect.poll(() => state.summaryReads).toBe(2);
        await expect(link).toHaveAccessibleName("My trips (125 returned for fixes)");
      } finally {
        release();
        state.summaryGate = undefined;
      }
      await expect(link).toHaveAccessibleName("My trips");
      await expect(link.locator(".nav-attention-badge")).toHaveCount(0);
      expect(await link.boundingBox()).toEqual(before);
      expect(await icon.boundingBox()).toEqual(beforeIcon);
      state.summary = { computedAt };
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect.poll(() => state.summaryReads).toBe(3);
      await expect(link).toHaveAccessibleName("My trips");
    };
    if (phone(page)) await check(bottomBar(page));
    else await inNavigation(page, check);
  },
);

test(
  "workspace attention waits for company access and drops obsolete authority snapshots",
  browserCase(["@functional"]),
  async ({ page }) => {
    const state = await mockWorkspace(page, ["driver"]);
    await page.goto("/status");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(state.summaryReads).toBe(0);
    state.me = 401;
    await page.goto("/account/dashboard");
    await expect(
      page.getByRole("heading", {
        name: /^(Sign in to open your account|Войдите, чтобы открыть аккаунт)$/,
      }),
    ).toBeVisible();
    expect(state.summaryReads).toBe(0);
    state.me = 200;
    state.self.data.capabilities = [];
    await page.reload();
    await expect(page.getByRole("heading", { name: "Company Overview" })).toBeVisible();
    expect(state.summaryReads).toBe(0);
    state.self.data.capabilities = capabilities(["driver"]);
    state.summary = { computedAt, tripsNeedingFixes: { count: 125, items: [] } };
    let release = () => {};
    state.summaryGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect.poll(() => state.summaryReads).toBe(1);
      state.summaryGate = undefined;
      state.self.data.capabilities = capabilities(["director"]);
      state.self.data.member.roles = ["director"];
      state.self.data.identityEpoch += 1;
      state.summary = { computedAt, newApplicationsCount: 2 };
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect.poll(() => state.summaryReads).toBe(2);
      await expect(
        mainNavigation(page).getByRole("link", { name: "Applications (2 awaiting review)" }),
      ).toBeVisible();
    } finally {
      release();
      state.summaryGate = undefined;
    }
    await expect(
      mainNavigation(page).getByRole("link", { name: "My trips", exact: true }),
    ).toBeVisible();
    state.summaryStatus = 403;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(
      mainNavigation(page).getByRole("link", { name: "Applications", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Could not load your actions.", { exact: true })).toBeVisible();
    state.summaryStatus = 200;
    await page
      .getByRole("region", { name: "Needs attention" })
      .getByRole("button", { name: "Retry", exact: true })
      .click();
    await expect(
      mainNavigation(page).getByRole("link", { name: "Applications (2 awaiting review)" }),
    ).toBeVisible();
    state.summaryStatus = 401;
    state.onSummary = () => {
      state.me = 401;
    };
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByRole("heading", { name: /Sign in/ })).toBeVisible();
    await expect(page.locator(".nav-attention-badge")).toHaveCount(0);
  },
);

for (const { roles, groups, phoneGroups, bar, report } of [
  {
    roles: ["trainee"],
    groups: { "My work": ["Overview", "My trips", "Drafts"], Company: company },
    phoneGroups: { "My work": ["Drafts"], Company: phoneCompany },
    bar: reporterBar,
    report: true,
  },
  {
    roles: ["dispatcher"],
    groups: { "My work": ["Overview", "My trips"], Company: company, Review: review },
    phoneGroups: { Company: phoneCompany, Review: ["Duplicate reconciliation"] },
    bar: reviewerBar,
    report: false,
  },
  {
    roles: ["driver", "dispatcher"],
    groups: { "My work": ["Overview", "My trips", "Drafts"], Company: company, Review: review },
    phoneGroups: { "My work": ["Drafts"], Company: phoneCompany, Review: review },
    bar: reporterBar,
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
    phoneGroups: {
      Company: phoneCompany,
      Review: ["Duplicate reconciliation"],
      Management: management,
    },
    bar: reviewerBar,
    report: false,
  },
] as {
  roles: Role[];
  groups: Record<string, string[]>;
  phoneGroups: Record<string, string[]>;
  bar: string[];
  report: boolean;
}[])
  test(
    `${roles.join("+")} sees only its navigation groups and personal pages stay in the user menu`,
    browserCase(["@layout"]),
    async ({ page }, info) => {
      await mockWorkspace(page, roles);
      await page.goto("/account/dashboard");
      const onPhone = phone(page);
      // Phones show the main sections in the bottom bar before the More sheet opens.
      if (onPhone) await expectBar(page, bar);
      await inNavigation(page, async (navigation) => {
        const shown = onPhone ? phoneGroups : groups;
        for (const name of ["My work", "Company", "Review", "Management"]) {
          const list = navigation.getByRole("list", { name, exact: true });
          if (shown[name]) await expect(list.getByRole("link")).toHaveText(shown[name]);
          else await expect(list).toHaveCount(0);
        }
        await expect(
          navigation.getByRole("link", {
            name: /^(Account|Account and security|Connections|Steam, TruckersMP and telemetry|Notifications|Home)$/,
          }),
        ).toHaveCount(0);
        if (onPhone)
          await expect(
            page.getByRole("dialog").getByRole("link", { name: "New report", exact: true }),
          ).toHaveCount(0);
        else
          await expect(
            page.getByRole("link", { name: "New report", exact: true }).filter({ visible: true }),
          ).toHaveCount(report ? 1 : 0);
      });
      if (onPhone)
        await expect(
          bottomBar(page).getByRole("link", { name: "New report", exact: true }),
        ).toHaveCount(report ? 1 : 0);
      if (roles.includes("deputy_director")) {
        await switchLanguage(page, "ru");
        if (onPhone) await expectBar(page, ["Обзор", "Мои рейсы", "Проверка", "События"]);
        await inNavigation(page, async (navigation) => {
          if (!onPhone)
            await expect(
              navigation.getByRole("list", { name: "Моя работа", exact: true }).getByRole("link"),
            ).toHaveText(["Обзор", "Мои рейсы"]);
          await expect(
            navigation.getByRole("list", { name: "Управление", exact: true }).getByRole("link"),
          ).toHaveText(["Заявки", "Участники и роли", "Каталоги игр", "Настройки компании"]);
        });
        await capture(page, info, `navigation-${roles.join("-")}-ru`);
      }
    },
  );

test(
  "breadcrumb, document title and current markers follow the route in RU and EN",
  browserCase(["@layout"]),
  async ({ page }) => {
    await mockWorkspace(page, ["driver", "deputy_director"]);
    const crumb = page.getByRole("navigation", { name: /^(Breadcrumb|Навигационная цепочка)$/ });
    const marked = async (target: Locator, value: string | null) => {
      if (value) await expect(target).toHaveAttribute("aria-current", value);
      else await expect(target).not.toHaveAttribute("aria-current", /.+/);
    };
    // Phones mark bar sections in the bar and the remaining sections in the More sheet.
    const current = async (link: string, value: string | null) =>
      phone(page) && link === "My trips"
        ? marked(bottomBar(page).getByRole("link", { name: link, exact: true }), value)
        : inNavigation(page, (navigation) =>
            marked(navigation.getByRole("link", { name: link, exact: true }), value),
          );
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
    await expect(page).toHaveURL(/\/account\/security$/);
    await expect(crumb.getByRole("listitem")).toHaveText(["Account", "Security"]);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Security");
    await switchLanguage(page, "ru");
    await expect(crumb.getByRole("listitem")).toHaveText(["Аккаунт", "Безопасность"]);
    await expect(page).toHaveTitle("Безопасность · Yukon Union");
  },
);

test(
  "user menu is keyboard operable, routes to main and switches language without losing input",
  browserCase(["@layout", "@viewport-non-mobile"]),
  async ({ page }) => {
    await mockWorkspace(page);
    await page.goto("/account/trips");
    const trigger = userMenuTrigger(page);
    await expect(trigger).toBeVisible();
    // Desktop keeps it in the sidebar footer; tablet and phone move it into the topbar.
    await expect(
      page.getByRole("banner").getByRole("button", { name: /Account menu$/ }),
    ).toHaveCount(wide(page) ? 0 : 1);
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
    await expect(page).toHaveURL(/\/account\/security$/);
    await expect(page.getByRole("main")).toBeFocused();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Security");
    await page
      .getByRole("main")
      .getByRole("navigation", { name: "Account sections", exact: true })
      .getByRole("link", { name: "Preferences", exact: true })
      .click();
    await page.getByLabel("Display timezone", { exact: true }).fill("Europe/Warsaw");
    const opened = await openUserMenu(page);
    await opened.getByRole("menuitemradio", { name: "Русский", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "ru");
    await expect(trigger).toBeFocused();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Предпочтения");
    await expect(page.getByLabel("Часовой пояс отображения", { exact: true })).toHaveValue(
      "Europe/Warsaw",
    );
  },
);

test(
  "language select stays only where no authenticated user menu exists",
  browserCase(["@layout"]),
  async ({ page }) => {
    const state = await mockWorkspace(page);
    const select = page.getByRole("banner").getByRole("combobox", { name: /^(Language|Язык)$/ });
    await page.goto("/account/trips");
    await expect(accountEntry(page)).toBeVisible();
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
    // Anonymous phones get no bottom bar and keep the navigation dialog.
    await expect(bottomBar(page)).toHaveCount(0);
    if (!wide(page)) await expect(menuButton(page)).toBeVisible();
  },
);

test("pages no longer repeat shell navigation", browserCase(["@layout"]), async ({ page }) => {
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
  await expect(main.getByRole("tab", { name: "Drafts (0)", exact: true })).toBeVisible();
  await expect(main.getByRole("link", { name: "New report", exact: true })).toBeVisible();
  await expect(
    main.getByRole("link", {
      name: /^(Dispatch|Review workspace|Reconciliation|Duplicate reconciliation)$/,
    }),
  ).toHaveCount(0);
});

test(
  "desktop sidebar collapses to a persistent icon rail with accessible labels",
  browserCase(["@layout", "@viewport-desktop"]),
  async ({ page }, info) => {
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
  },
);

test(
  "sign-in lands on Overview unless returning to a protected deep link",
  browserCase(["@functional", "@smoke-navigation"]),
  async ({ page }) => {
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
  },
);

test(
  "dashboard defaults to Russian and switching language in the user menu persists across sign-out and sign-in",
  browserCase(["@functional"]),
  async ({ page }) => {
    const state = await mockWorkspace(page, ["trainee"], "ru");
    await page.goto("/account/dashboard");
    await expect(page.locator("html")).toHaveAttribute("lang", "ru");

    await switchLanguage(page, "en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");

    state.logout = 200;
    state.me = 401;
    await signOutFromMenu(page);
    await expect(page.getByRole("heading", { name: "Sign in to open your account" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");

    await page.getByRole("main").getByRole("link", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");

    state.me = 200;
    await page.getByLabel("Email", { exact: true }).fill("member@example.invalid");
    await page.getByLabel("Password", { exact: true }).fill("NONFUNCTIONAL_FIXTURE");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    await expect(page).toHaveURL(/\/account\/dashboard$/);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  },
);

test(
  "skip link, route focus and navigation dialog restoration still hold",
  browserCase(["@layout"]),
  async ({ page }) => {
    await mockWorkspace(page);
    await page.goto("/account/trips");
    await expect(accountEntry(page)).toBeVisible();
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
    // Tablets use the navigation dialog; phones the More sheet, which holds Drivers but not Events.
    const onPhone = phone(page);
    const menu = onPhone ? moreButton(page) : menuButton(page);
    const dialog = page.getByRole("dialog", { name: onPhone ? "More" : "Navigation", exact: true });
    const destination = onPhone ? "Drivers" : "Events";
    for (const step of ["route", "current", "escape"] as const) {
      await menu.click();
      await expect(dialog).toBeVisible();
      if (step === "escape") await page.keyboard.press("Escape");
      else await dialog.getByRole("link", { name: destination, exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(menu).toBeFocused();
    }
    await expect(page).toHaveURL(onPhone ? /\/account\/drivers$/ : /\/account\/events$/);
  },
);

test(
  "navigation rows use the compact scale with visible hover and readable contrast",
  browserCase(["@layout"]),
  async ({ page }) => {
    await mockWorkspace(page);
    await page.goto("/account/trips");
    const coarse = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
    if (phone(page)) {
      // Bar items: current, idle and the accent New report tile.
      const bar = bottomBar(page);
      const report = bar.getByRole("link", { name: "New report", exact: true });
      for (const target of [
        bar.getByRole("link", { name: "My trips", exact: true }),
        bar.getByRole("link", { name: "Events", exact: true }),
        report,
      ]) {
        expect((await target.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(40);
        expect((await target.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(40);
        expect(await contrast(target)).toBeGreaterThanOrEqual(4.5);
      }
      expect(await contrast(report.locator(".bottom-nav-icon"))).toBeGreaterThanOrEqual(3);
    }
    await inNavigation(page, async (navigation) => {
      // Events sits in the phone bar, so the sheet measures Drivers as its idle row.
      const idle = navigation.getByRole("link", {
        name: phone(page) ? "Drivers" : "Events",
        exact: true,
      });
      const active = navigation.getByRole("link", { name: "My trips", exact: true });
      const title = navigation.getByText("Company", { exact: true });
      const height = (await idle.boundingBox())?.height ?? 0;
      if (coarse) expect(height).toBeGreaterThanOrEqual(40);
      else {
        expect(height).toBeGreaterThanOrEqual(29.5);
        expect(height).toBeLessThan(44);
      }
      for (const target of phone(page) ? [idle, title] : [idle, active, title])
        expect(await contrast(target)).toBeGreaterThanOrEqual(4.5);
      if (wide(page)) {
        await idle.hover();
        await expect(idle).toHaveCSS("background-color", "rgb(24, 34, 56)");
        expect(await contrast(idle)).toBeGreaterThanOrEqual(4.5);
      }
    });
  },
);

test(
  "sign-out from the user menu ends the session or keeps private content hidden until rechecked",
  browserCase(["@functional"]),
  async ({ page }) => {
    const state = await mockWorkspace(page);
    state.logout = 503;
    state.summary = { computedAt, tripsNeedingFixes: { count: 2, items: [] } };
    await page.goto("/account");
    await expect(
      page.getByRole("main").getByText("Fictional Yukon Member", { exact: true }),
    ).toBeVisible();
    await expect(
      mainNavigation(page).getByRole("link", {
        name: "My trips (2 returned for fixes)",
        exact: true,
      }),
    ).toBeVisible();
    await signOutFromMenu(page);
    await expect(page.getByRole("main").getByRole("status")).toContainText(
      "Sign-out could not be confirmed",
    );
    await expect(accountEntry(page)).toHaveCount(0);
    await expect(userMenuTrigger(page)).toHaveCount(0);
    // The phone bar is hidden like the user menu while signing out.
    await expect(bottomBar(page)).toHaveCount(0);
    await expect(page.getByText("Fictional Yukon Member", { exact: true })).toHaveCount(0);
    await expect(page.locator(".account-address")).toHaveCount(0);
    await expect(page.locator(".nav-attention-badge")).toHaveCount(0);
    // With the user menu hidden, the banner select keeps the language switchable.
    await expect(
      page.getByRole("banner").getByRole("combobox", { name: "Language", exact: true }),
    ).toBeVisible();
    await switchLanguage(page, "ru");
    await expect(
      page.getByRole("button", { name: "Проверить сессию и вернуться", exact: true }),
    ).toBeVisible();
    await switchLanguage(page, "en");
    await page.getByRole("button", { name: "Check session before returning", exact: true }).click();
    await expect(accountEntry(page)).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Security");
    await expect(
      mainNavigation(page).getByRole("link", {
        name: "My trips (2 returned for fixes)",
        exact: true,
      }),
    ).toBeVisible();
    state.logout = 200;
    await signOutFromMenu(page);
    await expect(
      page.getByRole("heading", { name: "Sign in to open your account", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("main")).toBeFocused();
    await expect(accountEntry(page)).toHaveCount(0);
    await expect(bottomBar(page)).toHaveCount(0);
    await expect(page.locator(".nav-attention-badge")).toHaveCount(0);
  },
);

const fictionalId = "41000000-0000-4000-8000-0000000000e1";
const viewportMeta = (page: Page) =>
  page.evaluate(
    () => document.querySelector('meta[name="viewport"]')?.getAttribute("content") ?? "",
  );
const rect = (locator: Locator) =>
  locator.evaluate((element) => {
    const { top, bottom, left, right, height } = element.getBoundingClientRect();
    return { top, bottom, left, right, height };
  });

test(
  "phone bottom bar reaches main sections in one tap and keeps content clear",
  browserCase(["@layout", "@viewport-mobile"]),
  async ({ page }, info) => {
    await mockWorkspace(page);
    await page.goto("/account/trips");
    const bar = bottomBar(page);
    await expectBar(page, reporterBar, ["Overview", "Trips", "Report", "Events", "More"]);
    const links = bar.getByRole("link");
    await expect(bar.getByRole("link", { name: "My trips", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    for (const name of ["Overview", "New report", "Events"])
      await expect(bar.getByRole("link", { name, exact: true })).not.toHaveAttribute(
        "aria-current",
        /.+/,
      );
    await expect(moreButton(page)).not.toHaveAttribute("aria-current", /.+/);
    // The compact topbar has no account trigger or navigation dialog button on phones.
    await expect(menuButton(page)).toHaveCount(0);
    await expect(userMenuTrigger(page)).toHaveCount(0);
    const banner = page.getByRole("banner");
    const wordmark = banner.getByRole("link", { name: "Yukon Union", exact: true });
    await expect(wordmark).toBeVisible();
    await expect(
      banner.getByRole("navigation", { name: "Breadcrumb" }).locator('[aria-current="page"]'),
    ).toHaveText("My trips");
    await expect(banner.getByRole("button", { name: /Open notifications/ })).toBeVisible();
    await expect(banner.locator(".event-nearest")).toBeVisible();
    const height = await page.evaluate(() => innerHeight);
    expect(Math.abs((await rect(bar)).bottom - height)).toBeLessThanOrEqual(1);
    for (const control of [...(await links.all()), moreButton(page), wordmark]) {
      const box = await control.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(40);
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(40);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(await viewportMeta(page)).toContain("viewport-fit=cover");
    await capture(page, info, "mobile-bar-en");

    // Content and focused controls stay above the fixed bar.
    const footer = page.getByRole("contentinfo");
    const clear = async () => {
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      expect((await rect(footer)).bottom).toBeLessThanOrEqual((await rect(bar)).top + 0.5);
      await page.evaluate(() => window.scrollTo(0, 0));
      const license = footer.getByRole("link");
      await license.focus();
      await expect(license).toBeFocused();
      expect((await rect(license)).bottom).toBeLessThanOrEqual((await rect(bar)).top + 0.5);
    };
    await clear();

    await bar.getByRole("link", { name: "Events", exact: true }).click();
    await expect(page).toHaveURL(/\/account\/events$/);
    await expect(page.getByRole("main")).toBeFocused();
    await expect(page).toHaveTitle("Events · Yukon Union");
    await expect(bar.getByRole("link", { name: "Events", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await page.goto(`/account/events/${fictionalId}`);
    await expect(bar.getByRole("link", { name: "Events", exact: true })).toHaveAttribute(
      "aria-current",
      "true",
    );
    await page.goto("/account/reports/new");
    await expect(bar.getByRole("link", { name: "New report", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await page.goto("/account/drivers");
    await expect(moreButton(page)).toBeVisible();
    await expect(bar.locator("[aria-current]")).toHaveCount(0);
    const sheet = await openMoreSheet(page);
    await expect(sheet.getByRole("link", { name: "Drivers", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);

    // Safe-area insets (home indicator) lift the bar contents and the page clearance.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { bottom: 34 } });
    await expect
      .poll(() =>
        bar.evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingBottom)),
      )
      .toBeGreaterThanOrEqual(38);
    expect(Math.abs((await rect(bar)).bottom - height)).toBeLessThanOrEqual(1);
    expect((await rect(bar)).height).toBeGreaterThanOrEqual(56 + 34 - 1);
    await clear();

    await switchLanguage(page, "ru");
    await expectBar(
      page,
      ["Обзор", "Мои рейсы", "Новый отчёт", "События"],
      ["Обзор", "Рейсы", "Отчёт", "События", "Ещё"],
    );
    await expect(moreButton(page)).toHaveAccessibleName("Ещё");
    const clipped = await bar
      .locator(".bottom-nav-label")
      .evaluateAll((labels) =>
        labels.filter((label) => label.scrollWidth > label.clientWidth).map((l) => l.textContent),
      );
    expect(clipped).toEqual([]);
    await capture(page, info, "mobile-bar-ru");

    // Leaving the workspace restores the original viewport declaration.
    const ru = await openMoreSheet(page);
    await ru.getByRole("link", { name: "Публичный сайт", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(bar).toHaveCount(0);
    expect(await viewportMeta(page)).not.toContain("viewport-fit");
  },
);

for (const { roles, path, names, sheet } of [
  {
    roles: ["dispatcher"],
    path: "/account/review",
    names: reviewerBar,
    sheet: { Review: ["Duplicate reconciliation"], Company: phoneCompany },
  },
  {
    roles: [],
    path: "/account/trips",
    names: ["Overview", "My trips", "Events"],
    sheet: { Company: phoneCompany },
  },
] as { roles: Role[]; path: string; names: string[]; sheet: Record<string, string[]> }[])
  test(
    `phone bottom bar for ${roles.join("+") || "a role-less member"} replaces New report`,
    browserCase(["@layout", "@viewport-mobile"]),
    async ({ page }, info) => {
      await mockWorkspace(page, roles);
      await page.goto(path);
      const bar = bottomBar(page);
      await expectBar(page, names);
      await expect(bar.getByRole("link", { name: "New report", exact: true })).toHaveCount(0);
      if (roles.includes("dispatcher")) {
        const review = bar.getByRole("link", { name: "Review", exact: true });
        await expect(review).toHaveAttribute("aria-current", "page");
        await expect(review).toHaveText("Review");
        await page.goto(`/account/review/${fictionalId}`);
        await expect(review).toHaveAttribute("aria-current", "true");
        await page.goto("/account/review/reconciliation");
        await expect(bar.locator("[aria-current]")).toHaveCount(0);
      }
      const dialog = await openMoreSheet(page);
      const navigation = mainNavigation(page);
      for (const [name, links] of Object.entries(sheet))
        await expect(
          navigation.getByRole("list", { name, exact: true }).getByRole("link"),
        ).toHaveText(links);
      await expect(navigation.getByRole("list", { name: "My work", exact: true })).toHaveCount(0);
      await expect(dialog.getByRole("link", { name: "New report", exact: true })).toHaveCount(0);
      if (roles.includes("dispatcher"))
        await expect(
          navigation.getByRole("link", { name: "Duplicate reconciliation", exact: true }),
        ).toHaveAttribute("aria-current", "page");
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
    },
  );

test(
  "deputy director phone bar shows Review and the sheet keeps Management in Russian",
  browserCase(["@layout", "@viewport-mobile"]),
  async ({ page }, info) => {
    await mockWorkspace(page, ["deputy_director"]);
    await page.goto("/account/dashboard");
    await switchLanguage(page, "ru");
    await expectBar(
      page,
      ["Обзор", "Мои рейсы", "Проверка", "События"],
      ["Обзор", "Рейсы", "Проверка", "События", "Ещё"],
    );
    await expect(bottomBar(page).getByRole("link", { name: "Обзор", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await openMoreSheet(page);
    await expect(
      mainNavigation(page).getByRole("list", { name: "Управление", exact: true }).getByRole("link"),
    ).toHaveText(["Заявки", "Участники и роли", "Каталоги игр", "Настройки компании"]);
    await page.keyboard.press("Escape");
    await capture(page, info, "mobile-bar-deputy-ru");
  },
);

test(
  "More sheet contains focus, closes with Escape and restores focus after routing in EN and RU",
  browserCase(["@layout", "@viewport-mobile"]),
  async ({ page }, info) => {
    await mockWorkspace(page);
    await page.goto("/account/trips");
    const more = moreButton(page);
    await more.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "More", exact: true });
    await expect(dialog).toBeVisible();
    const inside = () => dialog.evaluate((element) => element.contains(document.activeElement));
    expect(await inside()).toBe(true);
    const navigation = dialog.getByRole("navigation", { name: "Main navigation", exact: true });
    await expect(
      navigation.getByRole("list", { name: "My work", exact: true }).getByRole("link"),
    ).toHaveText(["Drafts"]);
    await expect(
      navigation.getByRole("list", { name: "Company", exact: true }).getByRole("link"),
    ).toHaveText(["Drivers", "Qualifications"]);
    for (const name of ["Overview", "My trips", "Events", "New report"])
      await expect(dialog.getByRole("link", { name, exact: true })).toHaveCount(0);
    const account = dialog.getByRole("list", { name: "Account", exact: true });
    await expect(account.getByRole("link")).toHaveText([
      "My driver profile",
      "Account and security",
      "Steam, TruckersMP and telemetry",
    ]);
    await expect(account.getByRole("link", { name: "My driver profile" })).toHaveAttribute(
      "href",
      `/account/drivers/${fixtureId}`,
    );
    // Account items sit outside the sections navigation landmark.
    await expect(navigation.getByRole("link", { name: "Account and security" })).toHaveCount(0);
    const language = dialog.getByRole("group", { name: "Language", exact: true });
    await expect(language.getByRole("button")).toHaveText(["Русский", "English"]);
    await expect(language.getByRole("button", { name: "English" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(language.getByRole("button", { name: "Русский" })).toHaveAttribute("lang", "ru");
    await expect(dialog.getByRole("link", { name: "Public site", exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
    await expect(dialog.getByText("Fictional Yukon Member", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeVisible();

    // Focus containment in both directions.
    const focusable = await dialog.locator("a[href], button").count();
    await page.keyboard.press("Shift+Tab");
    expect(await inside()).toBe(true);
    for (let step = 0; step < focusable + 2; step += 1) {
      await page.keyboard.press("Tab");
      expect(await inside()).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(more).toBeFocused();

    // Routing from the sheet returns focus to More, including the current route.
    for (let round = 0; round < 2; round += 1) {
      await more.click();
      await dialog.getByRole("link", { name: "Drivers", exact: true }).click();
      await expect(page).toHaveURL(/\/account\/drivers$/);
      await expect(dialog).toHaveCount(0);
      await expect(more).toBeFocused();
    }
    await more.click();
    await dialog.getByRole("link", { name: "Account and security", exact: true }).click();
    await expect(page).toHaveURL(/\/account\/security$/);
    await expect(dialog).toHaveCount(0);
    await expect(more).toBeFocused();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Security");

    // Switching language keeps the sheet open, focus on the choice and unsaved input.
    await page
      .getByRole("main")
      .getByRole("navigation", { name: "Account sections", exact: true })
      .getByRole("link", { name: "Preferences", exact: true })
      .click();
    await page.getByLabel("Display timezone", { exact: true }).fill("Europe/Warsaw");
    await more.click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Русский", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "ru");
    const ru = page.getByRole("dialog", { name: "Ещё", exact: true });
    await expect(ru).toBeVisible();
    const russian = ru
      .getByRole("group", { name: "Язык", exact: true })
      .getByRole("button", { name: "Русский", exact: true });
    await expect(russian).toHaveAttribute("aria-pressed", "true");
    await expect(russian).toBeFocused();
    await expect(
      ru.getByRole("list", { name: "Компания", exact: true }).getByRole("link"),
    ).toHaveText(["Водители", "Квалификации"]);
    await expect(
      ru.getByRole("list", { name: "Аккаунт", exact: true }).getByRole("link"),
    ).toHaveText([
      "Мой профиль водителя",
      "Аккаунт и безопасность",
      "Steam, TruckersMP и телеметрия",
    ]);
    const box = await rect(ru);
    const viewport = page.viewportSize();
    expect(box.top).toBeGreaterThanOrEqual(0);
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual((viewport?.width ?? 0) + 0.5);
    expect(box.bottom).toBeLessThanOrEqual((viewport?.height ?? 0) + 0.5);
    const idle = ru.getByRole("link", { name: "Водители", exact: true });
    for (const row of [
      idle,
      ru.getByRole("link", { name: "Аккаунт и безопасность", exact: true }),
      ru.getByRole("button", { name: "Выйти", exact: true }),
      russian,
    ])
      expect((await row.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(40);
    for (const target of [idle, ru.getByText("Компания", { exact: true })])
      expect(await contrast(target)).toBeGreaterThanOrEqual(4.5);
    await capture(page, info, "more-sheet-ru");
    await page.keyboard.press("Escape");
    await expect(ru).toHaveCount(0);
    await expect(moreButton(page)).toHaveAccessibleName("Ещё");
    await expect(moreButton(page)).toBeFocused();
    await expect(page.getByLabel("Часовой пояс отображения", { exact: true })).toHaveValue(
      "Europe/Warsaw",
    );
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Предпочтения");
  },
);

test(
  "tablet and desktop keep the dialog or sidebar without a bottom bar",
  browserCase(["@layout", "@viewport-non-mobile"]),
  async ({ page }, info) => {
    await mockWorkspace(page);
    await page.goto("/account/trips");
    await expect(userMenuTrigger(page)).toBeVisible();
    await expect(bottomBar(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^(More|Ещё)$/ })).toHaveCount(0);
    if (!wide(page)) {
      await expect(menuButton(page)).toBeVisible();
      await expect(
        page.getByRole("banner").getByRole("button", { name: /Account menu$/ }),
      ).toBeVisible();
    }
  },
);
