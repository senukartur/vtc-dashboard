import { readFileSync } from "node:fs";
import type { components } from "@vtc/contracts";
import { describe, expect, test, vi } from "vitest";
import { publicContent } from "../../apps/web/src/features/landing/content.ts";
import {
  formatCountdown,
  nextChangeDelay,
  nextConvoy,
  tickerHalf,
  tickerRoutes,
} from "../../apps/web/src/features/landing/model.ts";
import { readCompanyStats, statsView } from "../../apps/web/src/features/landing/stats.ts";
import { qualificationTranslations } from "../../apps/web/src/features/qualifications/translations.ts";

type EventPublic = components["schemas"]["EventPublic"];
const examples = JSON.parse(
  readFileSync(new URL("../../docs/contracts/dashboard/examples.json", import.meta.url), "utf8"),
) as { cases: { id: string; status: number; response: unknown }[] };
const example = (id: string) => {
  const found = examples.cases.find((entry) => entry.id === id);
  if (!found) throw new Error(`MISSING_EXAMPLE_${id}`);
  return structuredClone(found.response) as {
    data: components["schemas"]["CompanyStatsPublic"];
    meta: { requestId: string };
  };
};
const label = (text: string) => ({
  entityId: "51000000-0000-4000-8000-000000000001",
  label: text,
  requestedLocale: "en" as const,
  renderedLocale: "en" as const,
  englishFallback: false,
  retired: false,
});
const convoy = (index: number, overrides: Partial<EventPublic> = {}): EventPublic => ({
  id: `41000000-0000-4000-8000-00000000000${index}`,
  version: 1,
  title: `Fictional convoy ${index}`,
  description: "Synthetic convoy",
  game: "ets2",
  startsAt: "2026-11-02T18:30:00.000Z",
  endsAt: null,
  status: "scheduled",
  origin: null,
  destination: null,
  server: "Fictional server",
  organizer: "Fictional organizer",
  meetingLocation: "Fictional depot",
  route: `Fictional route ${index}`,
  meetingAt: "2026-11-02T18:00:00.000Z",
  ...overrides,
});

function keyShape(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(keyShape);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, keyShape((value as Record<string, unknown>)[key])]),
    );
  return typeof value;
}

describe("U1 landing content", () => {
  test("RU/EN share the same keys, keep the live slogan and trace the ladder to qualifications", () => {
    expect(keyShape(publicContent.ru)).toEqual(keyShape(publicContent.en));
    expect(publicContent.ru.heading).toBe("Своя компания. Общая дорога.");
    expect(publicContent.en.heading).toBe("Your company. Our road.");
    expect(publicContent.ru.eyebrow).toBe("Виртуальная транспортная компания · ETS2 / ATS");
    expect(publicContent.en.eyebrow).toBe("Virtual trucking company · ETS2 / ATS");
    expect(publicContent.ru.apply).toBe("Подать заявку");
    expect(publicContent.en.apply).toBe("Apply to join");
    expect(publicContent.ru.requirementsTitle).toBe("Начните со знакомства");
    expect(publicContent.en.requirementsTitle).toBe("Start with an introduction");
    expect(/Достаточно суров|Yukon\?|Юкон\?/.test(JSON.stringify(publicContent))).toBe(false);
    for (const locale of ["ru", "en"] as const) {
      const q = qualificationTranslations[locale],
        c = publicContent[locale];
      expect(c.ladder.map((level) => level.name)).toEqual([
        q.trainee,
        q.driver_iii,
        q.driver_ii,
        q.driver_i,
      ]);
      expect(c.ladder.filter((level) => level.text).map((level) => level.name)).toEqual([
        q.trainee,
      ]);
      expect(c.joinSteps).toHaveLength(3);
      expect(c.joinSteps[1]?.text).toContain(locale === "ru" ? "семь" : "seven");
      for (const removed of [
        "requirementsText",
        "review",
        "eventsTitle",
        "eventsText",
        "loginTitle",
        "loginText",
      ])
        expect(removed in c).toBe(false);
    }
  });
});

describe("U2 next convoy", () => {
  const now = Date.parse("2026-10-30T12:00:00.000Z");
  test("skips cancelled, completed and started events and picks the earliest scheduled one", () => {
    const items = [
      convoy(1, { status: "cancelled", startsAt: "2026-10-31T10:00:00.000Z" }),
      convoy(2, { status: "completed", startsAt: "2026-10-31T11:00:00.000Z" }),
      convoy(3, { startsAt: "2026-10-30T11:59:59.000Z" }),
      convoy(4, { startsAt: "2026-10-30T12:00:00.000Z" }),
      convoy(5, { startsAt: "2026-11-03T10:00:00.000Z" }),
      convoy(6, { startsAt: "2026-11-02T10:00:00.000Z" }),
    ];
    expect(nextConvoy(items, now)?.id).toBe(convoy(6).id);
    expect(nextConvoy(items.slice(0, 4), now)).toBeUndefined();
    expect(nextConvoy([], now)).toBeUndefined();
  });
});

describe("U3 countdown", () => {
  test("rounds up to minutes and omits empty leading units", () => {
    const remaining = (((3 * 24 + 6) * 60 + 29) * 60 + 59.5) * 1000;
    expect(formatCountdown(remaining, "ru")).toBe("3 д 06 ч 30 мин");
    expect(formatCountdown(remaining, "en")).toBe("3 d 06 h 30 min");
    expect(formatCountdown(59 * 60000, "ru")).toBe("59 мин");
    expect(formatCountdown(59 * 60000, "en")).toBe("59 min");
    expect(formatCountdown(30000, "ru")).toBe("1 мин");
    expect(formatCountdown(30000, "en")).toBe("1 min");
    expect(formatCountdown((2 * 60 + 5) * 60000, "en")).toBe("2 h 05 min");
    expect(formatCountdown(24 * 60 * 60000, "en")).toBe("1 d 00 h 00 min");
    expect(formatCountdown(0, "en")).toBeNull();
    expect(formatCountdown(-1, "ru")).toBeNull();
  });
  test("the next change happens when the remaining time crosses a whole minute", () => {
    expect(nextChangeDelay(90000)).toBe(30000);
    expect(nextChangeDelay(60000)).toBe(60000);
    expect(nextChangeDelay(120001)).toBe(1);
  });
});

describe("U4 ticker routes", () => {
  test("uses scheduled events only, prefers catalog labels and fills two halves of eight", () => {
    const routes = tickerRoutes([
      convoy(1, { origin: label("Origin"), destination: label("Destination") }),
      convoy(2, { game: "ats", origin: label("Only origin") }),
      convoy(3, { status: "cancelled" }),
      convoy(4, { status: "completed" }),
    ]);
    expect(routes).toHaveLength(tickerHalf * 2);
    expect(routes.filter((route) => !route.copy)).toHaveLength(8);
    expect(routes.filter((route) => route.copy)).toHaveLength(8);
    expect(routes.slice(8).map((route) => route.label)).toEqual(
      routes.slice(0, 8).map((route) => route.label),
    );
    expect(new Set(routes.map((route) => route.key)).size).toBe(16);
    expect(new Set(routes.map((route) => route.label))).toEqual(
      new Set(["Origin → Destination", "Fictional route 2"]),
    );
    expect(routes.map((route) => route.game).slice(0, 2)).toEqual(["ets2", "ats"]);
    expect(tickerRoutes([convoy(3, { status: "cancelled" })])).toEqual([]);
    expect(tickerRoutes([])).toEqual([]);
  });
});

describe("U5 public company stats", () => {
  const stub = (response: () => Promise<Response>) => {
    const fetch = vi.fn((_url: string, _init: RequestInit) => response());
    vi.stubGlobal("fetch", fetch);
    return fetch;
  };
  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...headers },
    });

  test("reads anonymously and presents exact values for both locales", async () => {
    const fetch = stub(async () => json(example("getPublicCompanyStats:success")));
    const signal = new AbortController().signal;
    const stats = await readCompanyStats(signal);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("/api/v1/public/company-stats");
    expect(init?.method ?? "GET").toBe("GET");
    expect(init?.credentials).toBe("omit");
    expect(init?.headers).toEqual({ Accept: "application/json" });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.body).toBeUndefined();
    const ru = statsView(stats, "ru"),
      en = statsView(stats, "en");
    expect(ru.tiles.map((tile) => tile.value)).toEqual(["12", "3", "412,5005 км", "ETS2 · ATS"]);
    expect(en.tiles.map((tile) => tile.value)).toEqual(["12", "3", "412.5005 km", "ETS2 · ATS"]);
    expect(en.tiles.map((tile) => tile.label)).toEqual([
      "Active members",
      "Accepted trips",
      "Distance on accepted trips",
      "Games on accepted trips",
    ]);
    expect(ru.caption).toMatch(/октябрь 2026/);
    expect(ru.caption).toContain("UTC");
    expect(en.caption).toMatch(/October 2026/);
    expect(en.caption).toBe("Current month: October 2026 · reporting timezone: UTC");
  });

  test("an unavailable month shows only active members and never zeros", async () => {
    stub(async () => json(example("getPublicCompanyStats:unavailable")));
    const view = statsView(await readCompanyStats(new AbortController().signal), "en");
    expect(view).toEqual({
      caption: null,
      tiles: [{ key: "members", label: "Active members", value: "3" }],
    });
  });

  test("an available zero month is shown as zero without a games tile", async () => {
    const body = example("getPublicCompanyStats:success");
    if (body.data.currentMonth.status !== "available") throw new Error("FIXTURE");
    body.data.currentMonth = {
      ...body.data.currentMonth,
      acceptedTrips: 0,
      actualDistanceM: "0",
      games: [],
    };
    stub(async () => json(body));
    const view = statsView(await readCompanyStats(new AbortController().signal), "en");
    expect(view.tiles.map((tile) => [tile.key, tile.value])).toEqual([
      ["members", "12"],
      ["trips", "0"],
      ["distance", "0 km"],
    ]);
  });

  test("errors, malformed bodies and network failures reject without server text", async () => {
    const extra = example("getPublicCompanyStats:success") as unknown as {
      data: Record<string, unknown>;
    };
    extra.data.privateSentinel = "PRIVATE_SENTINEL";
    const badDistance = example("getPublicCompanyStats:success");
    if (badDistance.data.currentMonth.status === "available")
      badDistance.data.currentMonth.actualDistanceM = "01.50";
    const error = (status: number) =>
      json(
        { error: { code: "PRIVATE_SENTINEL", messageKey: "PRIVATE_SENTINEL", retryable: false } },
        status,
        status === 429 ? { "Retry-After": "30" } : {},
      );
    for (const response of [
      async () => error(404),
      async () => error(409),
      async () => error(429),
      async () => error(503),
      async () => json(extra),
      async () => json(badDistance),
      async () =>
        new Response("{PRIVATE_SENTINEL", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      async () => Promise.reject(new TypeError("PRIVATE_SENTINEL network")),
    ]) {
      stub(response);
      const failure = await readCompanyStats(new AbortController().signal).catch(
        (caught: unknown) => caught,
      );
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toBe("PUBLIC_COMPANY_STATS_UNAVAILABLE");
      expect(String((failure as Error).message)).not.toContain("PRIVATE_SENTINEL");
    }
  });
});
