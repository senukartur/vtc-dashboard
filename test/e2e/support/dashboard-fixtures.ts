// Synthetic overview fixtures: recent company trips and nearest convoy blocks (VTC-055) and the
// public company stats that carry the reporting timezone for the period anchors (VTC-056).
// Pure data without Playwright imports, so unit tests parse every fixture with the runtime schemas.
import type { components } from "@vtc/contracts";

type S = components["schemas"];

const meta = { requestId: "synthetic-dashboard-request" };

/** The first event starts 3 d 4 h 30 min after this fixed test time. */
export const overviewNow = "2099-11-02T13:30:00.000Z";
export const upcomingEventId = "70000000-0000-4000-8000-000000000001";
export const nextEventId = "70000000-0000-4000-8000-000000000002";

export type FixtureLocale = "en" | "ru";

/** Fictional catalog places with fixed IDs; a null Russian name renders the English fallback. */
const places = {
  berlin: { id: "60000000-0000-4000-8000-000000000101", en: "Berlin", ru: "Берлин" },
  warszawa: { id: "60000000-0000-4000-8000-000000000102", en: "Warszawa", ru: "Варшава" },
  seattle: { id: "60000000-0000-4000-8000-000000000103", en: "Seattle", ru: "Сиэтл" },
  portland: { id: "60000000-0000-4000-8000-000000000104", en: "Portland", ru: "Портленд" },
  praha: { id: "60000000-0000-4000-8000-000000000105", en: "Praha", ru: "Прага" },
  wien: { id: "60000000-0000-4000-8000-000000000106", en: "Wien", ru: null },
  phoenix: { id: "60000000-0000-4000-8000-000000000107", en: "Phoenix", ru: "Финикс" },
  petersburg: {
    id: "60000000-0000-4000-8000-000000000108",
    en: "Saint Petersburg",
    ru: "Санкт-Петербург",
  },
  novgorod: {
    id: "60000000-0000-4000-8000-000000000109",
    en: "Nizhny Novgorod",
    ru: "Нижний Новгород",
  },
} as const satisfies Record<string, { id: string; en: string; ru: string | null }>;

/** The label as the API renders it for `locale`: requested locale, rendered locale and fallback. */
function place(name: keyof typeof places, locale: FixtureLocale): S["CatalogLabel"] {
  const entry: { id: string; en: string; ru: string | null } = places[name];
  const russian = locale === "ru" ? entry.ru : null;
  return {
    entityId: entry.id,
    label: russian ?? entry.en,
    requestedLocale: locale,
    renderedLocale: russian === null ? "en" : "ru",
    englishFallback: locale === "ru" && russian === null,
    retired: false,
  };
}

function trip(
  index: number,
  values: {
    game: S["TripSummary"]["game"];
    origin: S["CatalogLabel"] | null;
    destination: S["CatalogLabel"] | null;
    driver: string;
    actualDistanceM: string | null;
    reportingAt: string | null;
  },
): S["TripSummary"] {
  return {
    view: "summary",
    id: `05500000-0000-4000-8000-00000000000${index}`,
    version: 1,
    owner: {
      id: `41000000-0000-4000-8000-00000000055${index}`,
      nickname: values.driver,
      formerMember: false,
      roles: ["driver"],
    },
    game: values.game,
    outcome: "delivered",
    decision: "accepted",
    origin: values.origin,
    destination: values.destination,
    cargo: null,
    actualDistanceM: values.actualDistanceM,
    reportingAt: values.reportingAt,
    sourceKinds: [values.game === "ets2" ? "ets2telemetry" : "manual"],
    recording: "complete",
    reportingBasis: values.game === "ets2" ? "actual_completion" : "manual_confirmation",
  };
}

/**
 * Five accepted company trips as rendered for `locale`: a null distance (`Unavailable`), an
 * English-fallback label in Russian, an unknown origin, a missing counted time and long Russian
 * place names. IDs, drivers and values do not depend on the locale.
 */
export function recentTrips(locale: FixtureLocale = "en"): S["TripSummary"][] {
  return [
    trip(1, {
      game: "ets2",
      origin: place("berlin", locale),
      destination: place("warszawa", locale),
      driver: "AlphaDriver",
      actualDistanceM: "580000",
      reportingAt: "2099-11-01T14:30:00.000Z",
    }),
    trip(2, {
      game: "ats",
      origin: place("seattle", locale),
      destination: place("portland", locale),
      driver: "BetaHauler",
      actualDistanceM: null,
      reportingAt: "2099-11-01T09:15:00.000Z",
    }),
    trip(3, {
      game: "ets2",
      origin: place("praha", locale),
      destination: place("wien", locale),
      driver: "NightConvoyCaptain",
      actualDistanceM: "334000",
      reportingAt: "2099-10-31T20:05:00.000Z",
    }),
    trip(4, {
      game: "ats",
      origin: null,
      destination: place("phoenix", locale),
      driver: "CedarWolf",
      actualDistanceM: "1103000",
      reportingAt: null,
    }),
    trip(5, {
      game: "ets2",
      origin: place("petersburg", locale),
      destination: place("novgorod", locale),
      driver: "PolarBear",
      actualDistanceM: "1250000",
      reportingAt: "2099-10-30T07:45:00.000Z",
    }),
  ];
}
/** The English rendering, for tests that only need IDs, drivers and values. */
export const recentTripItems = recentTrips("en");

export function makeRecentTripsFixture(items: S["TripSummary"][] = recentTripItems) {
  return {
    data: { items, nextCursor: items.length >= 5 ? "NONFUNCTIONAL_CURSOR" : null },
    meta,
  } satisfies S["EnvelopeListTripSummary"];
}

export const upcomingEvent: S["EventPublic"] = {
  id: upcomingEventId,
  version: 1,
  title: "Autumn Yukon Convoy 2026",
  description: "Annual Autumn European Convoy for Yukon Union drivers",
  game: "ets2",
  startsAt: "2099-11-05T18:00:00.000Z",
  endsAt: "2099-11-05T21:00:00.000Z",
  status: "scheduled",
  origin: null,
  destination: null,
  server: "Simulation 1",
  organizer: "Yukon Staff",
  meetingLocation: "Berlin Quarry",
  route: "Berlin -> Hamburg -> Amsterdam",
  meetingAt: "2099-11-05T17:30:00.000Z",
};

/** What the endpoint returns once the first event has started. */
export const nextUpcomingEvent: S["EventPublic"] = {
  ...upcomingEvent,
  id: nextEventId,
  title: "Winter Baltic Convoy",
  description: "Fictional winter convoy along the Baltic coast",
  startsAt: "2099-11-12T18:00:00.000Z",
  endsAt: "2099-11-12T21:00:00.000Z",
  meetingAt: "2099-11-12T17:30:00.000Z",
  route: "Gdańsk -> Riga -> Tallinn",
};

export function makeOptionalEventFixture(event: S["EventPublic"] | null = upcomingEvent) {
  return { data: event, meta } satisfies S["EnvelopeOptionalEvent"];
}

export function makeRsvpFixture(
  response: S["Rsvp"]["response"] = "unanswered",
  version = 1,
  declineReason: string | null = null,
) {
  return { data: { response, version, declineReason }, meta } satisfies S["EnvelopeRsvp"];
}

export function makeResponseCountsFixture(participating = 8, declined = 2) {
  return {
    data: { participating, declined },
    meta,
  } satisfies S["EnvelopeEventResponseCounts"];
}

/**
 * Public company stats; the overview reads only `currentMonth.reportingTimezone`. A null zone is
 * the unavailable month the API returns when the company has no reporting timezone.
 */
export function makeCompanyStatsFixture(
  reportingTimezone: string | null,
): S["EnvelopeCompanyStatsPublic"] {
  return {
    data: {
      activeMembers: 3,
      computedAt: "2026-10-26T12:00:00.000Z",
      currentMonth:
        reportingTimezone === null
          ? { status: "unavailable", reason: "company_reporting_timezone" }
          : {
              status: "available",
              month: "2026-10",
              fromDate: "2026-10-01",
              toDateExclusive: "2026-11-01",
              reportingTimezone,
              acceptedTrips: 42,
              actualDistanceM: "125430000",
              games: ["ets2", "ats"],
            },
    },
    meta,
  };
}
