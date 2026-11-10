import type { Locator, Page } from "@playwright/test";
import type { components } from "@vtc/contracts";
import { accountFixture } from "../../../apps/web/src/features/account/fixtures.ts";
import { rgbaLogo } from "../../fixtures/catalogs/logos.ts";
import { expect } from "./fixtures.ts";
import { switchLanguage } from "./locale.ts";
import { inertNotifications } from "./notifications.ts";

type S = components["schemas"];
export type CatalogListName = "dlcs" | "regions" | "cities" | "companies" | "cargoes" | "trailers";
export type CatalogDepotRow = S["CatalogDepot"];
export type CatalogGame = S["CatalogItem"]["game"];
export const entityId = "63000000-0000-4000-8000-000000000020",
  regionId = "64000000-0000-4000-8000-000000000020",
  cargoRowId = "63000000-0000-4000-8000-000000000021",
  trailerRowId = "63000000-0000-4000-8000-000000000022",
  dlcId = "65000000-0000-4000-8000-000000000020",
  companyRowId = "66000000-0000-4000-8000-000000000020",
  depotRowId = "67000000-0000-4000-8000-000000000020";
/** A fictional logo, drawn at test time; the mock serves these bytes for every logo request. */
export const mockLogo = rgbaLogo(3);
export const logoRef = (seed = 3) => ({
  version: `${seed.toString(16).padStart(2, "0")}${"0123456789abcdef".slice(0, 14)}`,
  byteLength: rgbaLogo(seed).length,
});
/** A depot row in the shape the depot route returns. */
export function depotRow(
  id: string,
  company: { id: string; name: string; logo?: S["CatalogLogo"] | null },
  city: { id: string; name: string },
  overrides: Partial<CatalogDepotRow> = {},
  locale: "ru" | "en" = "en",
): CatalogDepotRow {
  const label = (entityId: string, text: string) => ({
    entityId,
    label: text,
    requestedLocale: locale,
    renderedLocale: "en" as const,
    englishFallback: locale === "ru",
    hidden: false,
  });
  return {
    id,
    game: "ets2",
    hidden: false,
    dlcId: null,
    dlc: null,
    company: {
      id: company.id,
      code: company.name.toLowerCase().replaceAll(" ", "_"),
      label: label(company.id, company.name),
      logo: company.logo ?? null,
    },
    city: {
      id: city.id,
      code: city.name.toLowerCase().replaceAll(" ", "_"),
      label: label(city.id, city.name),
    },
    ...overrides,
  };
}
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
  companies: [],
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
  /** Depots per game. */
  depots?: Partial<Record<CatalogGame, CatalogDepotRow[]>>;
  /** Company ids whose logo image answers with an error, so the placeholder shows. */
  brokenLogos?: string[];
  /** The first tries of every logo answer 503 like the API's busy database pool. */
  busyLogoTries?: number;
  /** Holds each logo answer this long, so overlapping requests can be counted. */
  logoDelayMs?: number;
  /** Answers for writes; each receives the request and returns a status with a JSON body. */
  writes?: (request: {
    method: string;
    path: string;
    /** The query string including its leading "?", or an empty string. */
    search: string;
    body: unknown;
    headers: Record<string, string>;
  }) => { status: number; json: unknown } | null;
};
export async function mockCatalogs(page: Page, staff = true, options: CatalogMockOptions = {}) {
  const requests: URL[] = [];
  const logos = { inFlight: 0, maxInFlight: 0, tries: new Map<string, number>() };
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
        search: url.search,
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
      const depots = options.depots?.[game] ?? [];
      return json(
        envelope({
          game,
          lists: {
            ...Object.fromEntries(
              (Object.keys(rows) as CatalogListName[]).map((name) => [name, summaryOf(rows[name])]),
            ),
            depots: {
              visible: depots.filter((r) => !r.hidden).length,
              hidden: depots.filter((r) => r.hidden).length,
            },
          },
        }),
      );
    }
    const logo = /^\/api\/v1\/catalogs\/companies\/([^/]+)\/logo$/.exec(path);
    if (logo) {
      const id = logo[1] as string;
      logos.inFlight += 1;
      logos.maxInFlight = Math.max(logos.maxInFlight, logos.inFlight);
      try {
        if (options.logoDelayMs) await new Promise((r) => setTimeout(r, options.logoDelayMs));
        const tries = (logos.tries.get(id) ?? 0) + 1;
        logos.tries.set(id, tries);
        if (options.brokenLogos?.includes(id))
          return await route.fulfill({
            status: 500,
            json: { error: { code: "PRIVATE_SENTINEL" } },
          });
        if (tries <= (options.busyLogoTries ?? 0))
          return await route.fulfill({
            status: 503,
            headers: { "retry-after": "0" },
            json: { error: { code: "SERVICE_UNAVAILABLE", retryable: true } },
          });
        return await route.fulfill({
          status: 200,
          contentType: "image/png",
          headers: { "cache-control": "no-store" },
          body: mockLogo,
        });
      } finally {
        logos.inFlight -= 1;
      }
    }
    if (path === "/api/v1/catalogs/depots") {
      if (options.gate) await options.gate;
      const game = url.searchParams.get("game") === "ats" ? "ats" : "ets2",
        company = url.searchParams.get("companyId"),
        city = url.searchParams.get("cityId"),
        includeHidden = url.searchParams.get("includeHidden") === "true",
        search = url.searchParams.get("search")?.toLowerCase();
      const visible = (options.depots?.[game] ?? []).filter(
        (r) =>
          (includeHidden || (!r.hidden && !r.company.label.hidden && !r.city.label.hidden)) &&
          (!company || r.company.id === company) &&
          (!city || r.city.id === city) &&
          (!search ||
            r.company.label.label.toLowerCase().includes(search) ||
            r.city.label.label.toLowerCase().includes(search)),
      );
      return json(catalogList(visible));
    }
    const match =
      /^\/api\/v1\/catalogs\/(dlcs|regions|cities|companies|cargoes|trailers)(?:\/([^/]+))?$/.exec(
        path,
      );
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
            r.display.label.toLowerCase().includes(search) ||
            r.nameNative?.toLowerCase().includes(search)),
      );
      return json(catalogList(visible));
    }
    return route.fulfill({ status: 503, json: { error: { code: "PRIVATE_SENTINEL" } } });
  });
  return { requests, logos };
}
