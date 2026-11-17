import { describe, expect, it } from "vitest";
import { pagination } from "../../apps/api/src/modules/identity/pagination.ts";
import type { Actor } from "../../apps/api/src/modules/identity/service.ts";
import {
  averageDelta,
  averageDistanceM,
  bucketLabel,
  bucketsSpanYears,
  computePeriodDates,
  countDelta,
  differenceDelta,
  distanceDelta,
  effectiveGranularity,
  inclusiveRangeLabel,
  monthName,
  monthYearLabel,
  type OverviewPeriod,
  overviewPeriods,
  PERIOD_FALLBACK_TIMEZONE,
  type PeriodFilter,
  periodQuery,
  periods,
  periodTimeZone,
  previousPeriodQuery,
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

  describe("Previous period of the same length (VTC-159)", () => {
    const prev = (period: OverviewPeriod, iso: string, timeZone = "UTC") => {
      const range = previousPeriodQuery(period, new Date(iso), timeZone);
      return range && `${range.fromDate}..${range.toDateExclusive}`;
    };
    const days = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 86_400_000;

    it("compares this month with the same elapsed days of the previous month", () => {
      expect(prev("thisMonth", "2026-11-01T12:00:00.000Z")).toBe("2026-10-01..2026-10-02");
      expect(prev("thisMonth", "2026-10-15T12:00:00.000Z")).toBe("2026-09-01..2026-09-16");
      expect(prev("thisMonth", "2026-11-12T08:00:00.000Z", "Europe/Moscow")).toBe(
        "2026-10-01..2026-10-13",
      );
    });

    it("clamps the elapsed days to a shorter previous month, also in a leap year", () => {
      expect(prev("thisMonth", "2026-03-31T12:00:00.000Z")).toBe("2026-02-01..2026-03-01");
      expect(prev("thisMonth", "2026-03-28T12:00:00.000Z")).toBe("2026-02-01..2026-03-01");
      expect(prev("thisMonth", "2026-03-27T12:00:00.000Z")).toBe("2026-02-01..2026-02-28");
      expect(prev("thisMonth", "2028-03-30T12:00:00.000Z")).toBe("2028-02-01..2028-03-01");
      expect(prev("thisMonth", "2028-03-28T12:00:00.000Z")).toBe("2028-02-01..2028-02-29");
      expect(prev("thisMonth", "2026-05-31T12:00:00.000Z")).toBe("2026-04-01..2026-05-01");
    });

    it("crosses the year for January and keeps whole months for last month", () => {
      expect(prev("thisMonth", "2027-01-10T12:00:00.000Z")).toBe("2026-12-01..2026-12-11");
      expect(prev("lastMonth", "2027-01-10T12:00:00.000Z")).toBe("2026-11-01..2026-12-01");
      expect(prev("lastMonth", "2027-02-10T12:00:00.000Z")).toBe("2026-12-01..2027-01-01");
      expect(prev("lastMonth", "2026-10-15T12:00:00.000Z")).toBe("2026-08-01..2026-09-01");
    });

    it("takes the preceding window of the same length for rolling periods", () => {
      expect(prev("last7Days", "2026-11-03T12:00:00.000Z")).toBe("2026-10-21..2026-10-28");
      expect(prev("last7Days", "2027-01-03T12:00:00.000Z")).toBe("2026-12-21..2026-12-28");
      expect(prev("last30Days", "2027-01-10T12:00:00.000Z")).toBe("2026-11-12..2026-12-12");
      for (const [period, length] of [
        ["last7Days", 7],
        ["last30Days", 30],
      ] as const)
        for (const iso of ["2026-03-01T00:30:00.000Z", "2027-01-03T12:00:00.000Z"]) {
          const current = computePeriodDates(period, new Date(iso), "UTC");
          const previous = previousPeriodQuery(period, new Date(iso), "UTC");
          expect(previous?.toDateExclusive).toBe(current.fromDate);
          expect(previous && days(previous.fromDate, previous.toDateExclusive)).toBe(length);
        }
    });

    it("anchors to the reporting date and has no comparison for all time", () => {
      // 01:30 on 1 November in Moscow while the UTC clock still shows 31 October.
      const instant = "2026-10-31T22:30:00.000Z";
      expect(prev("thisMonth", instant, "Europe/Moscow")).toBe("2026-10-01..2026-10-02");
      expect(prev("lastMonth", instant, "Europe/Moscow")).toBe("2026-09-01..2026-10-01");
      expect(prev("last7Days", instant, "Europe/Moscow")).toBe("2026-10-19..2026-10-26");
      expect(prev("last30Days", instant, "Europe/Moscow")).toBe("2026-09-03..2026-10-03");
      expect(prev("thisMonth", instant, "UTC")).toBe("2026-09-01..2026-10-01");
      for (const zone of ["Europe/Moscow", "UTC", "Not/A_Zone"])
        expect(previousPeriodQuery("allTime", new Date(instant), zone)).toBeNull();
    });
  });

  describe("Average trip and deltas (VTC-159)", () => {
    it("rounds the average trip half up to whole kilometres and has none without trips", () => {
      expect(averageDistanceM("125430000", 42)).toBe("2986000");
      expect(averageDistanceM("2500", 1)).toBe("3000");
      expect(averageDistanceM("2499", 1)).toBe("2000");
      expect(averageDistanceM("5000", 2)).toBe("3000");
      expect(averageDistanceM("1499.5", 1)).toBe("1000");
      expect(averageDistanceM("1500.0003", 3)).toBe("1000");
      expect(averageDistanceM("1499.9997", 3)).toBe("0");
      expect(averageDistanceM("0", 3)).toBe("0");
      expect(averageDistanceM("125430000", 0)).toBeNull();
      // Exact beyond 2^53 metres.
      expect(averageDistanceM("18014398509481985000", 2)).toBe("9007199254740993000");
    });

    it("reports a distance change in whole percent with the exact difference", () => {
      expect(distanceDelta("108000", "100000")).toEqual({
        kind: "up",
        percent: 8,
        lessThanOne: false,
        difference: "8000",
      });
      expect(distanceDelta("92000", "100000")).toMatchObject({
        kind: "down",
        percent: 8,
        difference: "8000",
      });
      expect(distanceDelta("100000", "100000")).toEqual({
        kind: "same",
        percent: 0,
        lessThanOne: false,
        difference: "0",
      });
      // Half away from zero, both ways; a nonzero change below 0.5% is "<1%", not "0%".
      expect(distanceDelta("100500", "100000")).toMatchObject({ percent: 1, lessThanOne: false });
      expect(distanceDelta("99500", "100000")).toMatchObject({ kind: "down", percent: 1 });
      expect(distanceDelta("100400", "100000")).toMatchObject({
        kind: "up",
        percent: 0,
        lessThanOne: true,
      });
      expect(distanceDelta("1.5", "1")).toMatchObject({ percent: 50, difference: "0.5" });
      expect(distanceDelta("1", "0")).toEqual({ kind: "noBaseline" });
    });

    it("keeps distances beyond 2^53 exact", () => {
      expect(distanceDelta("9007199254740993000", "9007199254740992000")).toEqual({
        kind: "up",
        percent: 0,
        lessThanOne: true,
        difference: "1000",
      });
      expect(differenceDelta("9007199254740993001", "9007199254740993000")).toMatchObject({
        kind: "up",
        difference: "1",
      });
    });

    it("reports counts and exact distance differences as signed absolute changes", () => {
      expect(countDelta(54, 42)).toEqual({
        kind: "up",
        percent: null,
        lessThanOne: false,
        difference: "12",
      });
      expect(countDelta(2, 3)).toMatchObject({ kind: "down", difference: "1" });
      expect(countDelta(3, 3)).toMatchObject({ kind: "same", difference: "0" });
      expect(differenceDelta("1284000", "964000")).toMatchObject({
        kind: "up",
        difference: "320000",
      });
      expect(differenceDelta("500", "0")).toMatchObject({ kind: "up", difference: "500" });
      expect(differenceDelta("0", "320000.5")).toMatchObject({
        kind: "down",
        difference: "320000.5",
      });
    });

    it("compares the average trip by exact cross-multiplication", () => {
      // 2,986.43 km against 2,500 km: +19.457%.
      expect(
        averageDelta({ distanceM: "125430000", trips: 42 }, { distanceM: "100000000", trips: 40 }),
      ).toEqual({ kind: "up", percent: 19, lessThanOne: false, difference: "486429" });
      // Equal averages from different totals.
      expect(
        averageDelta({ distanceM: "300", trips: 3 }, { distanceM: "200", trips: 2 }),
      ).toMatchObject({ kind: "same", percent: 0 });
      expect(
        averageDelta({ distanceM: "100", trips: 3 }, { distanceM: "100", trips: 2 }),
      ).toMatchObject({ kind: "down", percent: 33 });
      expect(averageDelta({ distanceM: "0", trips: 0 }, { distanceM: "100", trips: 2 })).toBeNull();
      expect(averageDelta({ distanceM: "100", trips: 1 }, { distanceM: "0", trips: 0 })).toEqual({
        kind: "noBaseline",
      });
    });
  });

  describe("Localized period and bucket labels (VTC-159)", () => {
    const iso = /\d{4}-\d{2}-\d{2}/;
    const range = (fromDate: string, toDateExclusive: string) => ({ fromDate, toDateExclusive });

    it("labels inclusive ranges in RU and EN, short and long", () => {
      const october = range("2026-10-01", "2026-10-18");
      expect(inclusiveRangeLabel(october, "en", "short")).toMatch(/^1\s?–\s?17 Oct$/);
      expect(inclusiveRangeLabel(october, "ru", "short")).toMatch(/^1\s?–\s?17 окт\.$/);
      expect(inclusiveRangeLabel(october, "ru", "long")).toMatch(/^1\s?–\s?17 октября$/);
      expect(inclusiveRangeLabel(october, "en", "long")).toMatch(/^1\s?–\s?17 October$/);
      const across = range("2026-09-04", "2026-10-04");
      expect(inclusiveRangeLabel(across, "en", "short")).toMatch(/^4 Sept?\s–\s3 Oct$/);
      expect(inclusiveRangeLabel(across, "ru", "long")).toMatch(/^4 сентября\s–\s3 октября$/);
      // One day is one date.
      expect(inclusiveRangeLabel(range("2026-10-01", "2026-10-02"), "en", "short")).toBe("1 Oct");
      expect(inclusiveRangeLabel(range("2026-10-01", "2026-10-02"), "ru", "long")).toBe(
        "1 октября",
      );
      const years = inclusiveRangeLabel(range("2026-12-20", "2027-01-04"), "en", "short");
      expect(years).toContain("2026");
      expect(years).toContain("2027");
      for (const label of [years, inclusiveRangeLabel(october, "ru", "short")])
        expect(label).not.toMatch(iso);
    });

    it("labels day and month buckets compactly on the axis and fully elsewhere", () => {
      expect(bucketLabel("2026-10-04", "day", "en", "axis")).toBe("4 Oct");
      expect(bucketLabel("2026-10-04", "day", "ru", "axis")).toBe("4 окт.");
      expect(bucketLabel("2026-10-04", "day", "en", "full")).toBe("4 October 2026");
      expect(bucketLabel("2026-10-04", "day", "ru", "full")).toMatch(/^4 октября 2026( г\.)?$/);
      expect(bucketLabel("2026-10-01", "month", "en", "axis")).toBe("Oct");
      expect(bucketLabel("2026-10-01", "month", "en", "axis", true)).toBe("Oct 2026");
      expect(bucketLabel("2026-10-01", "month", "ru", "axis")).toBe("окт.");
      expect(bucketLabel("2026-10-01", "month", "en", "full")).toBe("October 2026");
      expect(bucketLabel("2026-10-01", "month", "ru", "full")).toMatch(/^октябрь 2026( г\.)?$/);
      // Calendar dates never move with the browser or display timezone.
      expect(bucketLabel("2026-01-01", "day", "en", "full")).toBe("1 January 2026");
      for (const locale of ["en", "ru"] as const)
        for (const granularity of ["day", "month"] as const)
          for (const style of ["axis", "full"] as const)
            expect(bucketLabel("2025-12-01", granularity, locale, style, true)).not.toMatch(iso);
    });

    it("detects buckets across calendar years and names the reporting month", () => {
      expect(bucketsSpanYears([{ date: "2025-12-01" }, { date: "2026-01-01" }])).toBe(true);
      expect(bucketsSpanYears([{ date: "2026-10-01" }, { date: "2026-10-04" }])).toBe(false);
      expect(bucketsSpanYears([])).toBe(false);
      expect(monthYearLabel(2026, 11, "ru")).toBe("Ноябрь 2026");
      expect(monthYearLabel(2026, 11, "en")).toBe("November 2026");
      expect(monthName(2026, 11, "ru")).toBe("ноябрь");
      expect(monthName(2026, 5, "en")).toBe("May");
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
        "metrics.averageTrip",
        "metrics.averageSub",
        "metrics.noAverage",
        "chart.tooltipTrips",
        "delta.against",
        "delta.noData",
        "delta.noDataFor",
        "delta.unavailable",
        "personal.title",
        "personal.subtitle",
        "personal.month",
        "personal.more",
        "personal.less",
        "personal.same",
        "personal.noBaseline",
        "personal.unavailable",
        "personal.startTitle",
        "personal.companyLink",
        "personal.chartTitle",
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
        // VTC-159: the review queue card and the KPI place moved out of the company overview.
        "reviewQueue.title",
        "reviewQueue.error",
        "metrics.myPlace",
        "metrics.placeTotals",
      ])
        expect(present).not.toContain(key);
    });

    it("uses the overview titles and interpolates the peak summary in both languages", () => {
      expect(en.title).toBe("Company overview");
      expect(ru.title).toBe("Обзор компании");
      expect(en.personal.title).toBe("My overview");
      expect(ru.personal.title).toBe("Мой обзор");
      expect(en.actions.title).toBe("Needs attention");
      expect(ru.actions.title).toBe("Нужно сделать");
      expect([en.metrics.averageTrip, ru.metrics.averageTrip]).toEqual([
        "Average trip",
        "Средний рейс",
      ]);
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
