import { inertNotifications } from "./notifications.ts";
import { switchLanguage } from "./locale.ts";
import type { Locator, Page } from "@playwright/test";
import { expect } from "./fixtures.ts";
import type { components } from "@vtc/contracts";
import { accountFixture } from "../../../apps/web/src/features/account/fixtures.ts";

type S = components["schemas"];
export type CatalogListName = "dlcs" | "regions" | "cities" | "cargoes" | "trailers";
export type CatalogGame = S["CatalogItem"]["game"];
export const entityId = "63000000-0000-4000-8000-000000000020",
  regionId = "64000000-0000-4000-8000-000000000020",
  cargoRowId = "63000000-0000-4000-8000-000000000021",
  trailerRowId = "63000000-0000-4000-8000-000000000022",
  dlcId = "65000000-0000-4000-8000-000000000020";
export const envelope = (data: unknown) => ({
  data,
  meta: { requestId: "synthetic-catalog-request" },
});
export const list = (items: unknown[], nextCursor: string | null = null) =>
  envelope({ items, nextCursor });
/** Catalog list routes also return `total` for the pager. */
export const catalogList = (
  items: unknown[],
  nextCursor: string | null = null,
  total = items.length,
) => envelope({ items, nextCursor, total });
export async function catalogLanguage(page: Page, locale: "ru" | "en" = "en") {
  await switchLanguage(page, locale);
}
/**
 * Chooses a row in a catalog autocomplete through its search, since real specs share a database
 * that can exceed one page. Waits until the detail read has confirmed the choice.
 */
export async function chooseCatalogRow(
  scope: Page | Locator,
  label: string,
  rowName: string,
  search = rowName,
) {
  const field = scope.getByRole("combobox", { name: label, exact: true });
  await field.fill(search);
  await scope
    .getByRole("listbox", { name: label, exact: true })
    .getByRole("option", { name: new RegExp(`^${escapeRegExp(rowName)}(\\s|$)`) })
    .click();
  await expect(field).toHaveValue(rowName);
  await expect(field).toHaveAttribute("aria-expanded", "false");
  await expect(field).not.toHaveAttribute("aria-busy", "true");
}
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A list row with its display label, in the shape the read routes return. */
export function catalogItem(
  id: string,
  label: string,
  locale: "ru" | "en" = "en",
  overrides: Partial<S["CatalogItem"]> = {},
): S["CatalogItem"] {
  return {
    id,
    game: "ets2",
    code: label.toLowerCase().replaceAll(" ", "_"),
    nameEn: label,
    nameRu: null,
    hidden: false,
    display: {
      entityId: id,
      label,
      requestedLocale: locale,
      renderedLocale: "en",
      englishFallback: locale === "ru",
      hidden: false,
    },
    dlcId: null,
    dlc: null,
    ...overrides,
  };
}
export const defaultRows = (locale: "ru" | "en"): Record<CatalogListName, S["CatalogItem"][]> => ({
  dlcs: [catalogItem(dlcId, "Fictional base pack", locale, { steamAppId: 1 })],
  regions: [catalogItem(regionId, "Fictional region", locale)],
  cities: [catalogItem(entityId, "Fictional city", locale, { regionId })],
  cargoes: [catalogItem(cargoRowId, "Fictional cargo", locale)],
  trailers: [catalogItem(trailerRowId, "Fictional trailer", locale)],
});
const summaryOf = (rows: S["CatalogItem"][]) => ({
  visible: rows.filter((r) => !r.hidden).length,
  hidden: rows.filter((r) => r.hidden).length,
});
/** Optional overrides; omitting them keeps the original synthetic responses unchanged. */
export type CatalogMockOptions = {
  /** Replaces the session capabilities after the staff adjustment. */
  capabilities?: string[];
  /** Pathname suffix (after /api/v1) answered with this HTTP status instead. */
  failures?: Record<string, number>;
  /** Read routes wait for this promise. */
  gate?: Promise<void>;
  /** Rows per list and game; other lists keep the defaults for that game. */
  rows?: Partial<Record<CatalogGame, Partial<Record<CatalogListName, S["CatalogItem"][]>>>>;
  /** Answers for writes; each receives the request and returns a status with a JSON body. */
  writes?: (request: {
    method: string;
    path: string;
    body: unknown;
    headers: Record<string, string>;
  }) => { status: number; json: unknown } | null;
};
export async function mockCatalogs(page: Page, staff = true, options: CatalogMockOptions = {}) {
  const requests: URL[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/v1/")) requests.push(url);
  });
  await page.route("**/api/v1/**", async (route) => {
    const notification = inertNotifications(route);
    if (notification) return notification;
    const url = new URL(route.request().url()),
      path = url.pathname;
    const json = (data: unknown) => route.fulfill({ json: data });
    const failure = Object.entries(options.failures ?? {}).find(([suffix]) =>
      path.endsWith(suffix),
    );
    if (failure)
      return route.fulfill({ status: failure[1], json: { error: { code: "PRIVATE_SENTINEL" } } });
    if (path === "/api/v1/me") {
      const self = accountFixture();
      if (staff) {
        self.data.member.roles = ["deputy_director"];
        self.data.capabilities.push("qualifications.manage");
      }
      if (options.capabilities)
        self.data.capabilities = options.capabilities as typeof self.data.capabilities;
      return json(self);
    }
    if (path === "/api/v1/auth/csrf") return json(envelope({ token: "NONFUNCTIONAL_FIXTURE" }));
    const locale = url.searchParams.get("locale") === "ru" ? "ru" : "en";
    if (path.startsWith("/api/v1/admin/catalogs/")) {
      if (route.request().method() === "GET") return route.fallback();
      const response = options.writes?.({
        method: route.request().method(),
        path: path.slice("/api/v1".length),
        body: route.request().postDataBuffer(),
        headers: route.request().headers(),
      });
      if (response) return route.fulfill({ status: response.status, json: response.json });
      return route.fulfill({ status: 503, json: { error: { code: "PRIVATE_SENTINEL" } } });
    }
    if (path === "/api/v1/catalogs/summary") {
      if (options.gate) await options.gate;
      const game = url.searchParams.get("game") === "ats" ? "ats" : "ets2",
        rows = { ...defaultRows(locale), ...options.rows?.[game] };
      return json(
        envelope({
          game,
          lists: Object.fromEntries(
            (Object.keys(rows) as CatalogListName[]).map((name) => [name, summaryOf(rows[name])]),
          ),
        }),
      );
    }
    const match =
      /^\/api\/v1\/catalogs\/(dlcs|regions|cities|cargoes|trailers)(?:\/([^/]+))?$/.exec(path);
    if (match) {
      if (options.gate) await options.gate;
      const name = match[1] as CatalogListName,
        game = url.searchParams.get("game") === "ats" ? "ats" : "ets2",
        rows = options.rows?.[game]?.[name] ?? (game === "ets2" ? defaultRows(locale)[name] : []);
      if (match[2]) {
        const allRows = [
          ...(options.rows?.ets2?.[name] ?? defaultRows(locale)[name]),
          ...(options.rows?.ats?.[name] ?? []),
        ];
        const found = allRows.find((r) => r.id === match[2]);
        if (!found)
          return route.fulfill({ status: 404, json: { error: { code: "PRIVATE_SENTINEL" } } });
        return json(
          envelope({
            ...found,
            display: {
              ...found.display,
              requestedLocale: locale,
              englishFallback: locale === "ru",
            },
          }),
        );
      }
      const search = url.searchParams.get("search")?.toLowerCase(),
        includeHidden = url.searchParams.get("includeHidden") === "true";
      const visible = rows.filter(
        (r) =>
          (includeHidden || !r.hidden) &&
          (!search ||
            r.code.toLowerCase().includes(search) ||
            r.display.label.toLowerCase().includes(search)),
      );
      return json(catalogList(visible));
    }
    return route.fulfill({ status: 503, json: { error: { code: "PRIVATE_SENTINEL" } } });
  });
  return { requests };
}
