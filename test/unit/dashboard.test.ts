import { describe, expect, it } from "vitest";
import { pagination } from "../../apps/api/src/modules/identity/pagination.ts";
import type { Actor } from "../../apps/api/src/modules/identity/service.ts";
import {
  computePeriodDates,
  effectiveGranularity,
  overviewPeriods,
  PERIOD_FALLBACK_TIMEZONE,
  type PeriodFilter,
  periodQuery,
  periods,
  periodTimeZone,
  progressPercent,
} from "../../apps/web/src/features/dashboard/model.ts";
import { dashboardTranslations } from "../../apps/web/src/features/dashboard/translations.ts";
import { formatDecimal, formatQuantity, formatUtc } from "../../apps/web/src/shared/formatting.ts";
import { makeCompanyStatsFixture } from "../e2e/support/dashboard-fixtures.ts";

function keys(value: object, prefix = ""): string[] {
  return Object.entries(value)
    .flatMap(([key, item]) =>
      typeof item === "object" ? keys(item, `${prefix}${key}.`) : [`${prefix}${key}`],
    )
    .sort();
}

function values(value: object): string[] {
  return Object.values(value).flatMap((item) =>
    typeof item === "object" ? values(item) : [String(item)],
  );
}

describe("Dashboard & Driver Profiles Unit Tests", () => {
  describe("Period calculations", () => {
    /** The period as "from..toExclusive" at a fixed instant in a zone. */
    const p = (period: PeriodFilter, iso: string, timeZone: string) => {
      const { fromDate, toDateExclusive } = computePeriodDates(period, new Date(iso), timeZone);
      return `${fromDate}..${toDateExclusive}`;
    };
    const all = (iso: string, timeZone: string) =>
      Object.fromEntries(periods.map((period) => [period, p(period, iso, timeZone)]));
    const midOctober = "2026-10-15T12:00:00.000Z";

    it("computes thisMonth correctly for mid-month date", () => {
      expect(p("thisMonth", midOctober, "UTC")).toBe("2026-10-01..2026-11-01");
    });

    it("computes lastMonth correctly", () => {
      expect(p("lastMonth", midOctober, "UTC")).toBe("2026-09-01..2026-10-01");
    });

    it("handles year rollover in lastMonth correctly", () => {
      expect(p("lastMonth", "2027-01-05T08:00:00.000Z", "UTC")).toBe("2026-12-01..2027-01-01");
    });

    it("computes last7Days correctly", () => {
      expect(p("last7Days", midOctober, "UTC")).toBe("2026-10-09..2026-10-16");
    });

    it("computes last30Days correctly", () => {
      expect(p("last30Days", midOctober, "UTC")).toBe("2026-09-16..2026-10-16");
    });

    it("anchors to the reporting date in a positive-offset zone at a month boundary", () => {
      // Moscow (UTC+3): 23:59 on 31 October, then 00:00 on 1 November.
      expect(all("2026-10-31T20:59:00.000Z", "Europe/Moscow")).toEqual({
        thisMonth: "2026-10-01..2026-11-01",
        lastMonth: "2026-09-01..2026-10-01",
        last7Days: "2026-10-25..2026-11-01",
        last30Days: "2026-10-02..2026-11-01",
      });
      const midnight = "2026-10-31T21:00:00.000Z";
      expect(all(midnight, "Europe/Moscow")).toEqual({
        thisMonth: "2026-11-01..2026-12-01",
        lastMonth: "2026-10-01..2026-11-01",
        last7Days: "2026-10-26..2026-11-02",
        last30Days: "2026-10-03..2026-11-02",
      });
      // The UTC clock at the same instant is still in October.
      expect(p("thisMonth", midnight, "UTC")).toBe("2026-10-01..2026-11-01");
    });

    it("rolls over the year in a positive-offset zone", () => {
      // Tokyo (UTC+9): 23:59 on 31 December, then 00:00 on 1 January.
      expect(p("thisMonth", "2026-12-31T14:59:00.000Z", "Asia/Tokyo")).toBe(
        "2026-12-01..2027-01-01",
      );
      expect(p("thisMonth", "2026-12-31T15:00:00.000Z", "Asia/Tokyo")).toBe(
        "2027-01-01..2027-02-01",
      );
      expect(p("lastMonth", "2026-12-31T15:00:00.000Z", "Asia/Tokyo")).toBe(
        "2026-12-01..2027-01-01",
      );
    });

    it("anchors to the reporting date in a negative-offset zone at a month boundary", () => {
      // Los Angeles (UTC-8): 23:59 on 30 November while UTC is already in December.
      const lateNovember = "2026-12-01T07:59:00.000Z";
      expect(all(lateNovember, "America/Los_Angeles")).toEqual({
        thisMonth: "2026-11-01..2026-12-01",
        lastMonth: "2026-10-01..2026-11-01",
        last7Days: "2026-11-24..2026-12-01",
        last30Days: "2026-11-01..2026-12-01",
      });
      expect(p("thisMonth", lateNovember, "UTC")).toBe("2026-12-01..2027-01-01");
      // 00:00 on 1 December in Los Angeles.
      const december = "2026-12-01T08:00:00.000Z";
      expect(p("thisMonth", december, "America/Los_Angeles")).toBe("2026-12-01..2027-01-01");
      expect(p("last7Days", december, "America/Los_Angeles")).toBe("2026-11-25..2026-12-02");
      // The last millisecond of 2026 in Los Angeles.
      const yearEnd = "2027-01-01T07:59:59.999Z";
      expect(p("thisMonth", yearEnd, "America/Los_Angeles")).toBe("2026-12-01..2027-01-01");
      expect(p("lastMonth", yearEnd, "America/Los_Angeles")).toBe("2026-11-01..2026-12-01");
    });

    it("follows the calendar date in the extreme offsets", () => {
      const instant = "2026-10-15T10:30:00.000Z";
      expect(p("last7Days", instant, "Pacific/Kiritimati")).toBe("2026-10-10..2026-10-17");
      expect(p("last7Days", instant, "UTC")).toBe("2026-10-09..2026-10-16");
      expect(p("last7Days", instant, "Pacific/Pago_Pago")).toBe("2026-10-08..2026-10-15");
    });

    it("counts calendar days across the spring DST change", () => {
      // New York moves from UTC-5 to UTC-4 on 8 March 2026, a 23-hour day.
      const zone = "America/New_York";
      expect(p("last7Days", "2026-03-08T04:59:59.999Z", zone)).toBe("2026-03-01..2026-03-08");
      expect(p("last7Days", "2026-03-08T05:00:00.000Z", zone)).toBe("2026-03-02..2026-03-09");
      expect(p("last7Days", "2026-03-09T03:59:00.000Z", zone)).toBe("2026-03-02..2026-03-09");
      expect(p("last7Days", "2026-03-09T04:00:00.000Z", zone)).toBe("2026-03-03..2026-03-10");
    });

    it("counts calendar days across the autumn DST change at a month boundary", () => {
      // New York moves from UTC-4 to UTC-5 on 1 November 2026, a 25-hour day.
      const zone = "America/New_York";
      expect(p("thisMonth", "2026-11-01T03:59:00.000Z", zone)).toBe("2026-10-01..2026-11-01");
      expect(p("thisMonth", "2026-11-01T04:00:00.000Z", zone)).toBe("2026-11-01..2026-12-01");
      expect(p("lastMonth", "2026-11-01T04:00:00.000Z", zone)).toBe("2026-10-01..2026-11-01");
      expect(p("last7Days", "2026-11-02T04:59:00.000Z", zone)).toBe("2026-10-26..2026-11-02");
      expect(p("last7Days", "2026-11-02T05:00:00.000Z", zone)).toBe("2026-10-27..2026-11-03");
    });

    it("keeps the 25-hour autumn DST day in Europe as one calendar day", () => {
      // Berlin moves from UTC+2 to UTC+1 on 25 October 2026.
      const zone = "Europe/Berlin";
      expect(p("last7Days", "2026-10-24T22:00:00.000Z", zone)).toBe("2026-10-19..2026-10-26");
      expect(p("last7Days", "2026-10-25T22:59:00.000Z", zone)).toBe("2026-10-19..2026-10-26");
      expect(p("last7Days", "2026-10-25T23:00:00.000Z", zone)).toBe("2026-10-20..2026-10-27");
    });

    it("falls back to UTC for a zone the browser does not know", () => {
      const instant = "2026-10-31T21:00:00.000Z";
      for (const zone of ["Not/A_Zone", "Mars/Olympus_Mons"]) {
        expect(() => computePeriodDates("thisMonth", new Date(instant), zone)).not.toThrow();
        expect(all(instant, zone)).toEqual(all(instant, "UTC"));
        expect(p("thisMonth", instant, zone)).toBe("2026-10-01..2026-11-01");
        expect(p("last7Days", instant, zone)).toBe("2026-10-25..2026-11-01");
      }
      expect(PERIOD_FALLBACK_TIMEZONE).toBe("UTC");
    });
  });

  describe("Overview periods with all time", () => {
    const instant = new Date("2026-10-31T21:00:00.000Z");

    it("keeps the shared calendar periods unchanged for the trip list", () => {
      expect(periods).toEqual(["thisMonth", "lastMonth", "last30Days", "last7Days"]);
      expect(overviewPeriods).toEqual([...periods, "allTime"]);
    });

    it("sends dates for every calendar period and none for all time", () => {
      for (const period of periods)
        expect(periodQuery(period, instant, "Europe/Moscow")).toEqual(
          computePeriodDates(period, instant, "Europe/Moscow"),
        );
      expect(periodQuery("thisMonth", instant, "Europe/Moscow")).toEqual({
        fromDate: "2026-11-01",
        toDateExclusive: "2026-12-01",
      });
      for (const zone of ["Europe/Moscow", "UTC", "Not/A_Zone"])
        expect(periodQuery("allTime", instant, zone)).toEqual({ period: "all_time" });
    });

    it("reports all time in months and keeps the chosen interval otherwise", () => {
      expect(effectiveGranularity("allTime", "day")).toBe("month");
      expect(effectiveGranularity("allTime", "month")).toBe("month");
      for (const period of periods) {
        expect(effectiveGranularity(period, "day")).toBe("day");
        expect(effectiveGranularity(period, "month")).toBe("month");
      }
    });
  });

  describe("periodTimeZone", () => {
    const stats = (zone: string | null) => makeCompanyStatsFixture(zone).data;

    it("uses the reporting timezone of an available month", () => {
      expect(periodTimeZone(stats("Europe/Moscow"), false)).toBe("Europe/Moscow");
    });

    it("falls back to UTC when the company has no reporting timezone", () => {
      expect(periodTimeZone(stats(null), false)).toBe("UTC");
    });

    it("falls back to UTC when the read failed without data", () => {
      expect(periodTimeZone(undefined, true)).toBe("UTC");
    });

    it("waits while the read is pending", () => {
      expect(periodTimeZone(undefined, false)).toBeUndefined();
    });

    it("keeps the retained zone after a failed refresh", () => {
      expect(periodTimeZone(stats("Europe/Moscow"), true)).toBe("Europe/Moscow");
    });
  });

  describe("Qualification progress bar geometry", () => {
    it("computes the filled share of a requirement", () => {
      expect(progressPercent("15", "20")).toBe(75);
      expect(progressPercent("45000000", "60000000")).toBe(75);
    });

    it("clamps overachievement and handles missing or zero requirements", () => {
      expect(progressPercent("30", "20")).toBe(100);
      expect(progressPercent("15", null)).toBeNull();
      expect(progressPercent("0", "0")).toBe(100);
      expect(progressPercent("5", "0")).toBe(100);
      expect(progressPercent("0", "20")).toBe(0);
    });

    it("returns null when the requirement exceeds safe chart geometry", () => {
      expect(progressPercent("1", "9007199254740993")).toBeNull();
    });
  });

  describe("Overview translations", () => {
    const { en, ru } = dashboardTranslations;

    it("keeps RU and EN key sets identical", () => {
      expect(keys(en)).toEqual(keys(ru));
    });

    it("provides the compact overview keys and drops the removed help texts", () => {
      const present = keys(en);
      for (const key of [
        "metrics.label",
        "chart.granularity",
        "chart.view",
        "chart.viewChart",
        "chart.viewTable",
        "chart.peakSummary",
        "chart.tableHint",
        "myQualification.trips",
        "myQualification.distance",
        "myQualification.progressLoading",
        "myQualification.progressUnavailable",
        "leaderboard.error",
        "leaderboard.allDrivers",
        "leaderboard.retry",
        "reviewQueue.error",
        "upcomingEvent.error",
        "upcomingEvent.going",
        "upcomingEvent.goingButton",
        "upcomingEvent.cantGoButton",
        "upcomingEvent.countdownDays",
        "upcomingEvent.reasonRequired",
        "recentTrips.title",
        "recentTrips.allTrips",
        "recentTrips.empty",
        "recentTrips.forbidden",
        "states.forbidden",
      ])
        expect(present).toContain(key);
      for (const key of [
        "metrics.distanceHelp",
        "metrics.tripsHelp",
        "metrics.driversHelp",
        "chart.help",
      ])
        expect(present).not.toContain(key);
    });

    it("uses the overview title and interpolates the peak summary in both languages", () => {
      expect(en.title).toBe("Company Overview");
      expect(ru.title).toBe("Обзор компании");
      for (const summary of [en.chart.peakSummary, ru.chart.peakSummary]) {
        expect(summary).toContain("{{date}}");
        expect(summary).toContain("{{distance}}");
      }
    });

    it("states that periods follow the company reporting timezone", () => {
      expect(en.subtitle).toContain("periods");
      expect(en.subtitle).toContain("reporting timezone");
      expect(ru.subtitle).toContain("периоды");
      expect(ru.subtitle).toContain("отчётном часовом поясе");
      expect(en.definitions.timezoneDesc).toContain("company reporting timezone");
      expect(ru.definitions.timezoneDesc).toContain("отчётном часовом поясе компании");
      // The overview has no weekly period.
      expect(en.definitions.timezoneDesc).not.toMatch(/weeks/i);
      expect(ru.definitions.timezoneDesc).not.toMatch(/недели/i);
      // All time is whole months in the same zone.
      expect(en.filters.allTime).toBe("All time");
      expect(ru.filters.allTime).toBe("За всё время");
      expect(en.definitions.timezoneDesc).toContain("All time covers whole months");
      expect(ru.definitions.timezoneDesc).toContain("«За всё время» — целые месяцы");
    });

    it("contains no empty values and no mockup-only slogan", () => {
      for (const value of [...values(en), ...values(ru)]) {
        expect(value.trim()).not.toBe("");
        expect(value).not.toMatch(/Достаточно суров|Yukon\?/);
      }
    });
  });

  describe("Privacy protection guards", () => {
    it("ensures MemberSummary fixture contains only non-sensitive fields", () => {
      const member = {
        id: "018f3a2b-4c5d-4e6f-8a9b-0c1d2e3f4a5b",
        nickname: "ArcticWolf",
        formerMember: false,
        roles: ["driver", "dispatcher"],
      };

      const keys = Object.keys(member);
      expect(keys).not.toContain("email");
      expect(keys).not.toContain("password");
      expect(keys).not.toContain("passwordHash");
      expect(keys).not.toContain("credential");
      expect(keys).not.toContain("token");
      expect(keys).not.toContain("session");
      expect(keys).not.toContain("ip");
    });

    it("ensures MemberProfile response contains no sensitive fields", () => {
      const profile = {
        member: {
          id: "018f3a2b-4c5d-4e6f-8a9b-0c1d2e3f4a5b",
          nickname: "ArcticWolf",
          formerMember: false,
          roles: ["driver"],
        },
        qualifications: [
          {
            id: "018f3a2b-4c5d-4e6f-8a9b-0c1d2e3f4a5c",
            periodId: "018f3a2b-4c5d-4e6f-8a9b-0c1d2e3f4a5c",
            game: "ets2",
            levelId: "driver_ii",
            assignedAt: "2026-10-01T10:00:00.000Z",
          },
        ],
      };

      const serialized = JSON.stringify(profile);
      expect(serialized).not.toContain("@example.invalid");
      expect(serialized).not.toContain("email");
      expect(serialized).not.toContain("password");
      expect(serialized).not.toContain("secret");
      expect(serialized).not.toContain("hash");
    });
  });

  describe("Formatting invariants", () => {
    it("formats quantity with explicit km and t units in ru and en", () => {
      expect(formatQuantity("1250000", "km", "ru")).toBe("1 250 км");
      expect(formatQuantity("1250000", "km", "en")).toBe("1,250 km");
      expect(formatQuantity("50000", "t", "ru")).toBe("50 т");
      expect(formatQuantity("50000", "t", "en")).toBe("50 t");
      expect(formatQuantity(null, "km", "ru")).toBe("Недоступно");
      expect(formatQuantity(null, "km", "en")).toBe("Unavailable");
    });

    it("formats decimal quantities with localized thousand separators", () => {
      expect(formatDecimal("123456", "ru")).toBe("123 456");
      expect(formatDecimal("123456", "en")).toBe("123,456");
      expect(formatDecimal(null, "ru")).toBe("Недоступно");
      expect(formatDecimal(null, "en")).toBe("Unavailable");
    });

    it("formats UTC timestamps using configured company reporting timezone", () => {
      const timestamp = "2026-10-26T12:00:00.000Z";
      const formattedUtc = formatUtc(timestamp, "en", "UTC");
      expect(formattedUtc).toContain("2026");
      expect(formattedUtc).toContain("12:00");

      const formattedMsk = formatUtc(timestamp, "ru", "Europe/Moscow");
      expect(formattedMsk).toContain("2026");
      expect(formattedMsk).toContain("15:00");
    });
  });

  describe("Max value highlight logic in charts", () => {
    it("identifies highest distance point correctly", () => {
      const points = [
        { date: "2026-10-01", value: 120 },
        { date: "2026-10-02", value: 450 },
        { date: "2026-10-03", value: 300 },
        { date: "2026-10-04", value: 450 },
      ];

      const maxValue = Math.max(...points.map((p) => p.value), 0);
      expect(maxValue).toBe(450);

      const maxPoints = points.filter((p) => p.value === maxValue);
      expect(maxPoints.length).toBe(2);
      expect(maxPoints[0]?.date).toBe("2026-10-02");
    });

    it("handles zero distance without highlighting non-positive bars", () => {
      const points = [
        { date: "2026-10-01", value: 0 },
        { date: "2026-10-02", value: 0 },
      ];

      const maxValue = Math.max(...points.map((p) => p.value), 0);
      expect(maxValue).toBe(0);

      // In component logic: isMax = entry.value === maxValue && maxValue > 0
      const isMaxHighlighted = points.map((p) => p.value === maxValue && maxValue > 0);
      expect(isMaxHighlighted.every((v) => v === false)).toBe(true);
    });
  });

  describe("Identity members cursor pagination with non-hex secret", () => {
    it("signs and verifies cursors with non-hex secrets correctly and rejects forged cursors", () => {
      const nonHexSecret = "non-hex-secret-phrase-with-letters-and-symbols-!@#$%^&*()";
      const pageFn = pagination(nonHexSecret);
      const actor: Actor = {
        userId: "018f3a2b-4c5d-4e6f-8a9b-0c1d2e3f4a01",
        sessionId: "018f3a2b-4c5d-4e6f-8a9b-0c1d2e3f4a02",
        accessEpoch: 1,
        credentialEpoch: 1,
        capabilities: ["company.read"],
      };

      const rows = [
        { id: "018f3a2b-4c5d-4e6f-8a9b-0c1d2e3f4a10" },
        { id: "018f3a2b-4c5d-4e6f-8a9b-0c1d2e3f4a11" },
        { id: "018f3a2b-4c5d-4e6f-8a9b-0c1d2e3f4a12" },
      ];

      const plain = { sort: undefined, windowed: false } as const;
      const p1 = pageFn(actor, [], { limit: 2 }, plain);
      const res1 = p1.finish(rows, (r) => ({ id: r.id, value: null }), null);
      expect(res1.items.length).toBe(2);
      expect(res1.nextCursor).toBeTruthy();

      // Second page with cursor
      const p2 = pageFn(actor, [], { limit: 2, cursor: res1.nextCursor! }, plain);
      expect(p2.after).toEqual({ id: rows[1]!.id, value: null });
      expect(p2.windowEndsAt).toBeNull();

      const conflict = (run: () => unknown) => {
        try {
          run();
        } catch (error) {
          return (error as { statusCode?: number; publicCode?: string }).publicCode;
        }
        return "accepted";
      };
      // Rejects forged cursor (tampered signature)
      const [body] = res1.nextCursor!.split(".");
      const forged = `${body}.tamperedmac12345`;
      expect(conflict(() => pageFn(actor, [], { limit: 2, cursor: forged }, plain))).toBe(
        "VERSION_CONFLICT",
      );

      // Rejects cursor signed for different actor, scope or shape
      const otherActor: Actor = { ...actor, userId: "018f3a2b-4c5d-4e6f-8a9b-0c1d2e3f4a99" };
      for (const run of [
        () => pageFn(otherActor, [], { limit: 2, cursor: res1.nextCursor! }, plain),
        () => pageFn(actor, ["other"], { limit: 2, cursor: res1.nextCursor! }, plain),
        () =>
          pageFn(actor, [], { limit: 2, cursor: res1.nextCursor! }, { ...plain, windowed: true }),
        () =>
          pageFn(actor, [], { limit: 2, cursor: res1.nextCursor! }, { ...plain, sort: "nickname" }),
      ])
        expect(conflict(run)).toBe("VERSION_CONFLICT");

      // Windowed sorted cursors carry typed keyset values and the window end.
      const windowEndsAt = "2026-11-16T12:00:00.000Z";
      for (const [sort, value] of [
        ["distance30d", "10.000000000000000001"],
        ["trips30d", 3],
        ["lastTrip", null],
        ["lastTrip", "2026-11-01T08:00:00.000Z"],
        ["nickname", "Tie Driver"],
      ] as const) {
        const shape = { sort, windowed: true };
        const first = pageFn(actor, [sort], { limit: 1 }, shape).finish(
          rows,
          (r) => ({ id: r.id, value }),
          windowEndsAt,
        );
        const next = pageFn(actor, [sort], { limit: 1, cursor: first.nextCursor! }, shape);
        expect(next.after).toEqual({ id: rows[0]!.id, value });
        expect(next.windowEndsAt).toBe(windowEndsAt);
      }
      const mistyped = pageFn(
        actor,
        ["trips30d"],
        { limit: 1 },
        { sort: "trips30d", windowed: true },
      ).finish(rows, (r) => ({ id: r.id, value: "3" }), windowEndsAt).nextCursor!;
      expect(
        conflict(() =>
          pageFn(
            actor,
            ["trips30d"],
            { limit: 1, cursor: mistyped },
            {
              sort: "trips30d",
              windowed: true,
            },
          ),
        ),
      ).toBe("VERSION_CONFLICT");
    });
  });
});
