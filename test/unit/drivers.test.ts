import { describe, expect, it } from "vitest";
import { computePeriodDates } from "../../apps/web/src/features/dashboard/model.ts";
import {
  assignmentFor,
  failureView,
  initial,
  type Level,
  ladderFor,
  monthLabel,
  nextLevel,
  sourceKeys,
  tripsPath,
  twelveMonthWindow,
} from "../../apps/web/src/features/drivers/model.ts";
import { driverTranslations } from "../../apps/web/src/features/drivers/translations.ts";
import { DriversFailure, schema } from "../../apps/web/src/features/drivers/transport.ts";
import {
  alphaId,
  analyticsFixture,
  betaId,
  formerId,
  levelId,
  levelsFixture,
  profileFixture,
  progressFixture,
  selfId,
  topId,
  tripsFixture,
} from "../e2e/support/drivers-fixtures.ts";

function keys(value: object, prefix = ""): string[] {
  return Object.entries(value)
    .flatMap(([key, item]) =>
      typeof item === "object" ? keys(item, `${prefix}${key}.`) : [`${prefix}${key}`],
    )
    .sort();
}

function entries(value: object, prefix = ""): [string, string][] {
  return Object.entries(value).flatMap(([key, item]) =>
    typeof item === "object"
      ? entries(item, `${prefix}${key}.`)
      : [[`${prefix}${key}`, String(item)] as [string, string]],
  );
}

const placeholders = (text: string) => (text.match(/\{\{\w+\}\}/g) ?? []).sort();
const days = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 86_400_000;

describe("driver profile model", () => {
  describe("rolling twelve-month window in the reporting timezone", () => {
    const at = (instant: string, zone: string) => twelveMonthWindow(new Date(instant), zone);
    const span = (fromDate: string, toDateExclusive: string) => ({ fromDate, toDateExclusive });
    const october2026 = span("2025-11-01", "2026-11-01");
    const november2026 = span("2025-12-01", "2026-12-01");
    const december2026 = span("2026-01-01", "2027-01-01");
    const january2027 = span("2026-02-01", "2027-02-01");

    it("rolls into the next month at local midnight east of UTC", () => {
      expect(at("2026-10-31T20:59:00Z", "Europe/Moscow")).toEqual(october2026);
      expect(at("2026-10-31T21:00:00Z", "Europe/Moscow")).toEqual(november2026);
      // The UTC clock is still in October at the same instants.
      expect(at("2026-10-31T20:59:00Z", "UTC")).toEqual(october2026);
      expect(at("2026-10-31T21:00:00Z", "UTC")).toEqual(october2026);
    });

    it("keeps the month across a local day boundary inside it", () => {
      expect(at("2026-11-15T20:59:00Z", "Europe/Moscow")).toEqual(november2026);
      expect(at("2026-11-15T21:00:00Z", "Europe/Moscow")).toEqual(november2026);
    });

    it("rolls over the year at local midnight east of UTC", () => {
      expect(at("2026-12-31T14:59:00Z", "Asia/Tokyo")).toEqual(december2026);
      expect(at("2026-12-31T15:00:00Z", "Asia/Tokyo")).toEqual(january2027);
    });

    it("stays in the previous month and year west of UTC", () => {
      expect(at("2026-12-01T07:59:00Z", "America/Los_Angeles")).toEqual(november2026);
      expect(at("2026-12-01T07:59:00Z", "UTC")).toEqual(december2026);
      expect(at("2026-12-01T08:00:00Z", "America/Los_Angeles")).toEqual(december2026);
      expect(at("2027-01-01T07:59:59.999Z", "America/Los_Angeles")).toEqual(december2026);
      expect(at("2027-01-01T07:59:59.999Z", "UTC")).toEqual(january2027);
    });

    it("follows daylight saving changes", () => {
      // New York leaves daylight saving time on 1 November 2026 (EDT -4 to EST -5).
      expect(at("2026-11-01T03:59:00Z", "America/New_York")).toEqual(october2026);
      expect(at("2026-11-01T04:00:00Z", "America/New_York")).toEqual(november2026);
      expect(at("2026-11-01T06:30:00Z", "America/New_York")).toEqual(november2026);
      expect(at("2026-12-01T04:30:00Z", "America/New_York")).toEqual(november2026);
      // Berlin is on CET (+1) on 31 October and on CEST (+2) on 31 March.
      expect(at("2026-10-31T22:30:00Z", "Europe/Berlin")).toEqual(october2026);
      expect(at("2026-10-31T23:00:00Z", "Europe/Berlin")).toEqual(november2026);
      expect(at("2026-03-31T21:59:00Z", "Europe/Berlin")).toEqual(span("2025-04-01", "2026-04-01"));
      expect(at("2026-03-31T22:00:00Z", "Europe/Berlin")).toEqual(span("2025-05-01", "2026-05-01"));
    });

    it("handles the extreme offsets", () => {
      expect(at("2026-10-31T09:59:00Z", "Pacific/Kiritimati")).toEqual(october2026);
      expect(at("2026-10-31T10:00:00Z", "Pacific/Kiritimati")).toEqual(november2026);
      expect(at("2026-11-01T10:59:00Z", "Pacific/Pago_Pago")).toEqual(october2026);
      expect(at("2026-11-01T11:00:00Z", "Pacific/Pago_Pago")).toEqual(november2026);
    });

    it("falls back to UTC for a zone unknown to the browser", () => {
      for (const instant of ["2026-10-31T21:00:00Z", "2026-12-31T23:59:59Z"])
        expect(at(instant, "Not/A_Zone")).toEqual(at(instant, "UTC"));
    });

    it("ends with the overview's current month and starts eleven months before it", () => {
      const monthsBefore = (date: string, months: number) => {
        const [year, month] = date.split("-").map(Number) as [number, number];
        return new Date(Date.UTC(year, month - 1 - months, 1)).toISOString().slice(0, 10);
      };
      const cases: [string, string][] = [
        ["2026-10-31T20:59:00Z", "Europe/Moscow"],
        ["2026-10-31T21:00:00Z", "Europe/Moscow"],
        ["2026-12-31T15:00:00Z", "Asia/Tokyo"],
        ["2026-12-01T07:59:00Z", "America/Los_Angeles"],
        ["2027-01-01T07:59:59.999Z", "America/Los_Angeles"],
        ["2026-11-01T06:30:00Z", "America/New_York"],
        ["2026-03-31T22:00:00Z", "Europe/Berlin"],
        ["2026-10-31T10:00:00Z", "Pacific/Kiritimati"],
        ["2026-11-01T10:59:00Z", "Pacific/Pago_Pago"],
        ["2026-10-31T21:00:00Z", "UTC"],
      ];
      for (const [instant, zone] of cases) {
        const now = new Date(instant);
        const month = computePeriodDates("thisMonth", now, zone);
        const window = twelveMonthWindow(now, zone);
        expect(window.toDateExclusive).toBe(month.toDateExclusive);
        expect(window.fromDate).toBe(monthsBefore(month.fromDate, 11));
      }
    });

    it("stays within the 732-day API limit and covers twelve month starts", () => {
      for (const now of ["2024-02-29T10:00:00Z", "2026-07-01T00:00:00Z", "2028-03-31T23:00:00Z"]) {
        const window = twelveMonthWindow(new Date(now), "UTC");
        expect(days(window.fromDate, window.toDateExclusive)).toBeLessThanOrEqual(732);
        expect(window.fromDate.endsWith("-01")).toBe(true);
        const response = analyticsFixture(new URLSearchParams(window));
        expect(response.data.buckets).toHaveLength(12);
        expect(response.data.buckets.at(-1)?.date.slice(0, 7)).toBe(now.slice(0, 7));
      }
    });
  });

  it("formats bucket months with the recorded Node 24 ICU output", () => {
    expect(monthLabel("2026-11-01", "en", "short")).toBe("Nov");
    expect(monthLabel("2026-11-01", "en", "long")).toBe("November 2026");
    expect(monthLabel("2025-12-01", "ru", "short")).toBe("дек.");
    expect(monthLabel("2026-05-01", "ru", "short")).toBe("май");
    expect(monthLabel("2026-11-01", "ru", "long")).toBe("ноябрь 2026 г.");
    expect(monthLabel("not-a-date", "en", "long")).toBe("not-a-date");
  });

  describe("level ladder", () => {
    const all: Level[] = [...levelsFixture("ets2").data.items, ...levelsFixture("ats").data.items];

    it("orders one game's levels by position and ignores the other game", () => {
      expect(ladderFor(all, "ets2").map((level) => level.position)).toEqual([1, 2, 3, 4]);
      expect(ladderFor(all, "ats").every((level) => level.game === "ats")).toBe(true);
    });

    it("resolves the next level, the top level and unknown levels", () => {
      const ladder = ladderFor(all, "ets2");
      const next = nextLevel(ladder, levelId("ets2", "driver_ii"));
      expect(next !== "top" && next?.id).toBe(levelId("ets2", "driver_i"));
      expect(nextLevel(ladder, levelId("ets2", "trainee"))).toMatchObject({
        id: levelId("ets2", "driver_iii"),
      });
      expect(nextLevel(ladder, levelId("ets2", "driver_i"))).toBe("top");
      expect(nextLevel(ladder, levelId("ats", "driver_ii"))).toBeNull();
      expect(nextLevel([], levelId("ets2", "trainee"))).toBeNull();
    });

    it("finds the assignment per game", () => {
      const profile = profileFixture(alphaId).data;
      expect(assignmentFor(profile, "ats")?.levelId).toBe(levelId("ats", "driver_iii"));
      expect(assignmentFor(profileFixture(formerId).data, "ets2")).toBeNull();
    });
  });

  describe("trip requests", () => {
    it("uses one completion-ordered page and restricts company history to the requested driver", () => {
      expect(tripsPath(selfId, { isSelf: true })).toBe(
        "/trips?scope=mine&decision=accepted&limit=10&order=completion_desc",
      );
      expect(tripsPath(selfId, { isSelf: true, game: "ats" })).toBe(
        "/trips?scope=mine&decision=accepted&game=ats&limit=10&order=completion_desc",
      );
      expect(tripsPath(alphaId, { isSelf: false })).toBe(
        `/trips?scope=company&ownerId=${alphaId}&limit=10&order=completion_desc`,
      );
      expect(tripsPath(alphaId, { isSelf: false, game: "ets2" })).toBe(
        `/trips?scope=company&ownerId=${alphaId}&game=ets2&limit=10&order=completion_desc`,
      );
      // Labels follow the interface language, not the saved account language.
      expect(tripsPath(alphaId, { isSelf: false, locale: "ru" })).toBe(
        `/trips?scope=company&ownerId=${alphaId}&limit=10&order=completion_desc&locale=ru`,
      );
    });

    it("names the sources and falls back to unknown", () => {
      expect(sourceKeys(["ets2telemetry", "manual"])).toEqual(["ets2telemetry", "manual"]);
      expect(sourceKeys(["manual", "manual"])).toEqual(["manual"]);
      expect(sourceKeys([])).toEqual(["unknown"]);
    });
  });

  it("maps failures to page states", () => {
    for (const status of [400, 404, 422])
      expect(failureView(new DriversFailure("unavailable", status))).toBe("notFound");
    expect(failureView(new DriversFailure("forbidden", 403))).toBe("forbidden");
    expect(failureView(new DriversFailure("conflict", 409))).toBe("setup");
    expect(failureView(new DriversFailure("unavailable", 503))).toBe("error");
    // Timeouts and unparseable responses carry no status.
    expect(failureView(new DriversFailure("unavailable"))).toBe("error");
    expect(failureView(new DriversFailure("uncertain", 500))).toBe("error");
    expect(failureView(new Error("network"))).toBe("error");
  });

  it("takes the first user-perceived character of the nickname", () => {
    expect(initial("ёжик")).toBe("Ё");
    expect(initial("  alpha")).toBe("A");
    expect(initial("👩‍🚀Pilot")).toBe("👩‍🚀");
    expect(initial("   ")).toBe("?");
  });
});

describe("driver profile translations", () => {
  const { en, ru } = driverTranslations;

  it("keeps identical RU and EN keys and placeholders without plurals", () => {
    expect(keys(en)).toEqual(keys(ru));
    const russian = new Map(entries(ru));
    for (const [key, value] of entries(en)) {
      expect(placeholders(value), key).toEqual(placeholders(russian.get(key) ?? ""));
      expect(value).not.toContain("{{count}}");
    }
  });

  it("contains no empty values and no mockup-only slogan", () => {
    for (const [, value] of [...entries(en), ...entries(ru)]) {
      expect(value.trim()).not.toBe("");
      expect(value).not.toMatch(/Достаточно суров|Yukon\?/);
    }
  });

  it("drops the replaced profile keys", () => {
    const present = keys(en);
    for (const key of [
      "privacyNotice",
      "statsTitle",
      "totalDistance",
      "chartTitle",
      "tripsTitle",
      "tripsHelp",
      "viewTrip",
      "detailsCol",
      "dateCol",
      "gameCol",
      "unitKm",
      "level",
      "progress",
      "memberSince",
      "status",
      "eligible",
    ])
      expect(present).not.toContain(`profile.${key}`);
    expect(present).toContain("states.forbidden");
    expect(present).toContain("qualification.eligible");
  });
});

describe("driver profile fixtures match the browser contract", () => {
  const parses = (name: Parameters<typeof schema>[0], value: unknown) =>
    schema(name).safeParse(value).success;

  it("parses every builder with its envelope schema", () => {
    for (const id of [selfId, alphaId, betaId, formerId, topId])
      expect(parses("EnvelopeMemberProfile", profileFixture(id))).toBe(true);
    for (const game of ["ets2", "ats"] as const)
      expect(parses("EnvelopeListQualificationLevel", levelsFixture(game))).toBe(true);
    for (const search of ["", "game=ats", "game=ets2"])
      expect(parses("EnvelopeAnalytics", analyticsFixture(new URLSearchParams(search)))).toBe(true);
    expect(
      parses("EnvelopeAnalytics", analyticsFixture(new URLSearchParams(), { empty: true })),
    ).toBe(true);
    for (const search of ["scope=company", "scope=mine", "scope=company&game=ats"])
      for (const bulk of [false, true])
        expect(
          parses(
            "EnvelopeListTripSummary",
            tripsFixture(new URLSearchParams(search), { nextCursor: true, bulk }),
          ),
        ).toBe(true);
  });

  it("serves public progress, which the private progress schema rejects", () => {
    for (const [id, game] of [
      [alphaId, "ets2"],
      [alphaId, "ats"],
      [selfId, "ets2"],
      [topId, "ets2"],
    ] as const) {
      const fixture = progressFixture(id, game);
      expect(parses("EnvelopeProgressPublic", fixture)).toBe(true);
      expect(parses("EnvelopeProgress", fixture)).toBe(false);
    }
    expect(progressFixture(formerId, "ets2")).toBeNull();
  });

  it("keeps fixtures free of private account data", () => {
    const serialized = JSON.stringify([
      profileFixture(alphaId),
      tripsFixture(new URLSearchParams("scope=company")),
      progressFixture(alphaId, "ets2"),
    ]);
    for (const secret of ["@example.invalid", "email", "password", "token", "evidence"])
      expect(serialized).not.toContain(secret);
  });
});
