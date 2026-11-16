import { newId, type UnitOfWork } from "@vtc/db";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../../apps/api/src/app.ts";
import { registerAnalyticsRoutes } from "../../apps/api/src/modules/analytics/http.ts";
import {
  afterIndex,
  compareDecimal,
  pagination,
} from "../../apps/api/src/modules/analytics/pagination.ts";
import {
  addDistances,
  allTimeRange,
  bucketStarts,
  type CompanyAnalyticsQuery,
  createAnalytics,
  currentReportingMonth,
  decimal,
  formatDateInTimezone,
  generateBuckets,
  parseTimezoneDate,
  periodQuery,
  publicGames,
  timezoneOrNull,
  validateAnalyticsConfig,
} from "../../apps/api/src/modules/analytics/service.ts";
import type { Actor, Identity } from "../../apps/api/src/modules/identity/service.ts";

describe("Analytics Unit Tests", () => {
  const validKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  describe("validateAnalyticsConfig", () => {
    it("validates disabled config without errors", () => {
      expect(() =>
        validateAnalyticsConfig({
          enabled: false,
          cursorKey: "",
        }),
      ).not.toThrow();
    });

    it("requires 64-hex cursorKey when analytics is enabled", () => {
      expect(() =>
        validateAnalyticsConfig({
          enabled: true,
          cursorKey: "",
        }),
      ).toThrow("INVALID_ANALYTICS_CURSOR_KEY");
      expect(() =>
        validateAnalyticsConfig({
          enabled: true,
          cursorKey: "not-hex-and-too-short",
        }),
      ).toThrow("INVALID_ANALYTICS_CURSOR_KEY");
    });

    it("validates valid IANA timezone", () => {
      expect(() =>
        validateAnalyticsConfig({
          enabled: true,
          cursorKey: validKey,
          reportingTimezone: "Europe/Moscow",
        }),
      ).not.toThrow();
    });

    it("rejects invalid IANA timezone", () => {
      expect(() =>
        validateAnalyticsConfig({
          enabled: true,
          cursorKey: validKey,
          reportingTimezone: "Invalid/Timezone",
        }),
      ).toThrow("INVALID_ANALYTICS_REPORTING_TIMEZONE");
    });
  });

  describe("parseTimezoneDate", () => {
    it("converts UTC midnight to ISO string", () => {
      const date = parseTimezoneDate("2026-10-20", "UTC");
      expect(date.toISOString()).toBe("2026-10-20T00:00:00.000Z");
    });

    it("converts Europe/Moscow (UTC+3) midnight to UTC ISO string (previous day 21:00Z)", () => {
      const date = parseTimezoneDate("2026-10-20", "Europe/Moscow");
      expect(date.toISOString()).toBe("2026-10-19T21:00:00.000Z");
    });

    it("converts America/New_York (EDT UTC-4 in October) midnight to UTC ISO string (04:00Z)", () => {
      const date = parseTimezoneDate("2026-10-20", "America/New_York");
      expect(date.toISOString()).toBe("2026-10-20T04:00:00.000Z");
    });

    it("rejects invalid format dates", () => {
      expect(() => parseTimezoneDate("2026/10/20", "UTC")).toThrow("Invalid date format");
      expect(() => parseTimezoneDate("not-a-date", "UTC")).toThrow("Invalid date format");
    });

    it("rejects impossible calendar dates", () => {
      expect(() => parseTimezoneDate("2026-02-30", "UTC")).toThrow("Invalid calendar date");
      expect(() => parseTimezoneDate("2026-13-01", "UTC")).toThrow("Invalid calendar date");
    });
  });

  describe("addDistances", () => {
    it("sums integer distance strings accurately", () => {
      expect(addDistances("100", "200")).toBe("300");
    });

    it("sums tenths decimals accurately without binary floating point drift", () => {
      // 0.1 + 0.2 in standard JS float is 0.30000000000000004
      expect(addDistances("0.1", "0.2")).toBe("0.3");
      expect(addDistances("12345.6", "789.7")).toBe("13135.3");
    });

    it("handles zero and multiple calls correctly", () => {
      expect(addDistances("0.0", "0.0")).toBe("0");
      expect(addDistances("0", "5.5")).toBe("5.5");
      expect(addDistances("10.0", "0.0")).toBe("10");
    });

    it("handles large BigInt numbers", () => {
      expect(addDistances("999999999999.9", "0.1")).toBe("1000000000000");
    });
  });

  describe("generateBuckets", () => {
    it("generates day buckets across the requested interval in the given timezone", () => {
      const buckets = generateBuckets("2026-10-01", "2026-10-04", "day");

      expect(buckets).toEqual([
        { date: "2026-10-01", acceptedTrips: 0, actualDistanceM: "0" },
        { date: "2026-10-02", acceptedTrips: 0, actualDistanceM: "0" },
        { date: "2026-10-03", acceptedTrips: 0, actualDistanceM: "0" },
      ]);
    });

    it("generates month buckets across months", () => {
      const buckets = generateBuckets("2026-01-01", "2026-04-01", "month");

      expect(buckets).toEqual([
        { date: "2026-01-01", acceptedTrips: 0, actualDistanceM: "0" },
        { date: "2026-02-01", acceptedTrips: 0, actualDistanceM: "0" },
        { date: "2026-03-01", acceptedTrips: 0, actualDistanceM: "0" },
      ]);
    });
  });

  describe("Cursor Pagination & HMAC integrity", () => {
    const page = pagination(validKey);
    const actor: Actor = {
      userId: newId(),
      sessionId: newId(),
      accessEpoch: 1,
      credentialEpoch: 1,
      capabilities: ["company.read"],
    };
    const scope = ["leaderboard", "ets2", "2026-10-01", "2026-11-01"];

    it("creates and parses a valid cursor", () => {
      const pager = page(actor, scope, { limit: 2 });
      const id1 = newId();
      const id2 = newId();
      const id3 = newId();
      const sampleRows = [
        {
          member: { id: id1 },
          actualDistanceM: "1000000",
          acceptedTrips: 10,
        },
        {
          member: { id: id2 },
          actualDistanceM: "500000",
          acceptedTrips: 5,
        },
        {
          member: { id: id3 },
          actualDistanceM: "250000",
          acceptedTrips: 2,
        },
      ];

      const result = pager.finish(sampleRows);
      expect(result.items.length).toBe(2);
      expect(result.nextCursor).toBeTruthy();

      const nextPager = page(actor, scope, {
        limit: 2,
        cursor: result.nextCursor!,
      });
      expect(nextPager.after).toEqual({
        id: id2,
        distance: "500000",
        trips: 5,
      });
    });

    it("rejects cursor with tampered payload", () => {
      const pager = page(actor, scope, { limit: 1 });
      const sampleRows = [
        {
          member: { id: newId() },
          actualDistanceM: "1000000",
          acceptedTrips: 10,
        },
        {
          member: { id: newId() },
          actualDistanceM: "500000",
          acceptedTrips: 5,
        },
      ];
      const result = pager.finish(sampleRows);
      const [body, mac] = result.nextCursor!.split(".");
      const decoded = JSON.parse(Buffer.from(body!, "base64url").toString());
      decoded.after.distance = "9999999";
      const tamperedBody = Buffer.from(JSON.stringify(decoded)).toString("base64url");
      const tamperedCursor = `${tamperedBody}.${mac}`;

      expect(() => page(actor, scope, { limit: 1, cursor: tamperedCursor })).toThrow();
    });

    it("rejects cursor with mismatched scope", () => {
      const pager = page(actor, scope, { limit: 1 });
      const result = pager.finish([
        {
          member: { id: newId() },
          actualDistanceM: "1000000",
          acceptedTrips: 10,
        },
        {
          member: { id: newId() },
          actualDistanceM: "500000",
          acceptedTrips: 5,
        },
      ]);

      expect(() =>
        page(actor, ["other-scope"], { limit: 1, cursor: result.nextCursor! }),
      ).toThrow();
    });

    it("rejects cursor with wrong secret key", () => {
      const pager = page(actor, scope, { limit: 1 });
      const result = pager.finish([
        {
          member: { id: newId() },
          actualDistanceM: "1000000",
          acceptedTrips: 10,
        },
        {
          member: { id: newId() },
          actualDistanceM: "500000",
          acceptedTrips: 5,
        },
      ]);

      const otherPage = pagination(
        "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
      );
      expect(() => otherPage(actor, scope, { limit: 1, cursor: result.nextCursor! })).toThrow();
    });

    it("rejects malformed cursor", () => {
      expect(() => page(actor, scope, { limit: 1, cursor: "not-a-valid-cursor" })).toThrow();
    });
  });

  describe("public company statistics helpers (VTC-052)", () => {
    it("selects the Moscow reporting month up to the last millisecond before local midnight", () => {
      expect(currentReportingMonth(new Date("2026-10-31T20:59:59.999Z"), "Europe/Moscow")).toEqual({
        month: "2026-10",
        fromDate: "2026-10-01",
        toDateExclusive: "2026-11-01",
        startIso: "2026-09-30T21:00:00.000Z",
        endIso: "2026-10-31T21:00:00.000Z",
      });
    });

    it("switches to the next Moscow month exactly at local midnight", () => {
      expect(currentReportingMonth(new Date("2026-10-31T21:00:00.000Z"), "Europe/Moscow")).toEqual({
        month: "2026-11",
        fromDate: "2026-11-01",
        toDateExclusive: "2026-12-01",
        startIso: "2026-10-31T21:00:00.000Z",
        endIso: "2026-11-30T21:00:00.000Z",
      });
    });

    it("rolls the year over for January", () => {
      expect(currentReportingMonth(new Date("2026-12-31T21:00:00.000Z"), "Europe/Moscow")).toEqual({
        month: "2027-01",
        fromDate: "2027-01-01",
        toDateExclusive: "2027-02-01",
        startIso: "2026-12-31T21:00:00.000Z",
        endIso: "2027-01-31T21:00:00.000Z",
      });
    });

    it("uses the actual offset at each month boundary across a DST change", () => {
      expect(
        currentReportingMonth(new Date("2026-03-15T12:00:00.000Z"), "America/New_York"),
      ).toEqual({
        month: "2026-03",
        fromDate: "2026-03-01",
        toDateExclusive: "2026-04-01",
        startIso: "2026-03-01T05:00:00.000Z",
        endIso: "2026-04-01T04:00:00.000Z",
      });
    });

    it("supports UTC", () => {
      expect(currentReportingMonth(new Date("2026-02-28T23:59:59.999Z"), "UTC")).toEqual({
        month: "2026-02",
        fromDate: "2026-02-01",
        toDateExclusive: "2026-03-01",
        startIso: "2026-02-01T00:00:00.000Z",
        endIso: "2026-03-01T00:00:00.000Z",
      });
    });

    it("prefers the stored timezone, falls back to configuration and never throws", () => {
      expect(timezoneOrNull("Europe/Moscow", "UTC")).toBe("Europe/Moscow");
      expect(timezoneOrNull(null, "UTC")).toBe("UTC");
      expect(timezoneOrNull(undefined, undefined)).toBeNull();
      expect(timezoneOrNull(null, undefined)).toBeNull();
      expect(timezoneOrNull("", undefined)).toBeNull();
      expect(timezoneOrNull("Invalid/Timezone", undefined)).toBeNull();
      // An invalid stored value is not silently replaced by the fallback.
      expect(timezoneOrNull("Invalid/Timezone", "UTC")).toBeNull();
    });

    it("canonicalizes MySQL decimal strings without float conversion", () => {
      expect(decimal("0.000000000000000000")).toBe("0");
      expect(decimal("0.0")).toBe("0");
      expect(decimal(null)).toBe("0");
      expect(decimal("505600.250000000000000000")).toBe("505600.25");
      expect(decimal("100000.5")).toBe("100000.5");
      expect(decimal("12345678901234567890.1")).toBe("12345678901234567890.1");
    });

    it("lists games with accepted trips in fixed ets2, ats order", () => {
      expect(publicGames(1, 1)).toEqual(["ets2", "ats"]);
      expect(publicGames("1", "0")).toEqual(["ets2"]);
      expect(publicGames(0, 1)).toEqual(["ats"]);
      expect(publicGames(null, null)).toEqual([]);
      expect(publicGames(0, 0)).toEqual([]);
    });
  });

  describe("public company statistics database failures (VTC-052)", () => {
    const failing = (error: unknown) => {
      const uow = { run: async () => Promise.reject(error) } as unknown as UnitOfWork;
      const identity = { rateLimit: async () => {} } as unknown as Identity;
      return { identity, service: createAnalytics(uow, identity, { cursorKey: validKey }) };
    };
    const outcome = (error: unknown) =>
      failing(error)
        .service.getPublicCompanyStats()
        .catch((e) => e);

    it("maps connection and transaction-control failures to 503", async () => {
      expect(await outcome({ code: "ECONNREFUSED" })).toMatchObject({ statusCode: 503 });
      expect(await outcome({ code: "EHOSTUNREACH" })).toMatchObject({ statusCode: 503 });
      expect(
        await outcome(new Error("WRAPPED", { cause: new Error("TRANSACTION_CONTROL_TIMEOUT") })),
      ).toMatchObject({ statusCode: 503 });
    });

    it("rethrows other database errors unchanged", async () => {
      const error = { code: "ER_PARSE_ERROR" };
      expect(await outcome(error)).toBe(error);
    });

    it("returns a retryable no-store 503 without cookies over HTTP", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { identity, service } = failing({ code: "ECONNREFUSED" });
      const app = await createApp({ checkReadiness: async () => true });
      await registerAnalyticsRoutes(app, identity, service);
      try {
        const res = await app.inject("/api/v1/public/company-stats");
        expect(res.statusCode).toBe(503);
        expect(res.headers["retry-after"]).toBe("1");
        expect(res.headers["cache-control"]).toBe("no-store");
        expect(res.headers["set-cookie"]).toBeUndefined();
        expect(res.json().error).toMatchObject({ code: "SERVICE_UNAVAILABLE", retryable: true });
      } finally {
        await app.close();
      }
    });
  });
});

describe("Stage 4 analytics periods (VTC-143)", () => {
  describe("bucketStarts", () => {
    const zones = ["Europe/Berlin", "America/New_York", "UTC", "Europe/Moscow"];
    const ranges: [string, string, "day" | "month"][] = [
      ["2026-03-01", "2026-04-05", "day"],
      ["2026-10-20", "2026-11-10", "day"],
      ["2025-01-01", "2027-01-01", "month"],
    ];
    for (const timeZone of zones)
      for (const [from, to, granularity] of ranges)
        it(`starts every ${granularity} bucket at local midnight in ${timeZone} from ${from}`, () => {
          const buckets = generateBuckets(from, to, granularity);
          const starts = bucketStarts(buckets, timeZone);
          expect(starts).toHaveLength(buckets.length);
          buckets.forEach((bucket, index) => {
            const start = starts[index] ?? Number.NaN;
            expect(formatDateInTimezone(new Date(start), timeZone, granularity)).toBe(bucket.date);
            expect(formatDateInTimezone(new Date(start - 1), timeZone, granularity)).not.toBe(
              bucket.date,
            );
            if (index > 0) expect(start).toBeGreaterThan(starts[index - 1] ?? Number.NaN);
          });
        });

    it("uses the actual offset on both sides of a DST change", () => {
      const iso = (starts: number[]) => starts.map((ms) => new Date(ms).toISOString());
      expect(
        iso(bucketStarts([{ date: "2026-03-29" }, { date: "2026-03-30" }], "Europe/Berlin")),
      ).toEqual(["2026-03-28T23:00:00.000Z", "2026-03-29T22:00:00.000Z"]);
      expect(
        iso(bucketStarts([{ date: "2026-11-01" }, { date: "2026-11-02" }], "America/New_York")),
      ).toEqual(["2026-11-01T04:00:00.000Z", "2026-11-02T05:00:00.000Z"]);
    });
  });

  describe("allTimeRange", () => {
    const now = new Date("2026-11-16T09:00:00.000Z");

    it("covers only the current month without accepted trips", () => {
      expect(allTimeRange(null, now, "Europe/Berlin")).toEqual({
        fromDate: "2026-11-01",
        toDateExclusive: "2026-12-01",
      });
    });

    it("starts at the local month of the earliest trip", () => {
      // 2023-12-31 23:30 UTC is already 2024-01-01 in Berlin.
      expect(allTimeRange("2023-12-31T23:30:00.000Z", now, "Europe/Berlin")).toEqual({
        fromDate: "2024-01-01",
        toDateExclusive: "2026-12-01",
      });
      expect(allTimeRange("2023-12-31T23:30:00.000Z", now, "UTC").fromDate).toBe("2023-12-01");
    });

    it("clamps a future earliest trip to the current month", () => {
      expect(allTimeRange("2027-03-01T00:00:00.000Z", now, "Europe/Berlin")).toEqual({
        fromDate: "2026-11-01",
        toDateExclusive: "2026-12-01",
      });
    });

    it("rolls over to the next month exactly at local midnight", () => {
      expect(allTimeRange(null, new Date("2026-11-30T22:59:59.999Z"), "Europe/Berlin")).toEqual({
        fromDate: "2026-11-01",
        toDateExclusive: "2026-12-01",
      });
      expect(allTimeRange(null, new Date("2026-11-30T23:00:00.000Z"), "Europe/Berlin")).toEqual({
        fromDate: "2026-12-01",
        toDateExclusive: "2027-01-01",
      });
    });
  });

  describe("periodQuery", () => {
    const rejected: [string, CompanyAnalyticsQuery, boolean][] = [
      ["no dates", {}, true],
      ["only fromDate", { fromDate: "2026-10-01" }, true],
      ["only toDateExclusive", { toDateExclusive: "2026-10-01" }, false],
      ["explicit range without dates", { period: "range" }, false],
      ["all_time with fromDate", { period: "all_time", fromDate: "2026-10-01" }, true],
      [
        "all_time with toDateExclusive",
        { period: "all_time", toDateExclusive: "2026-11-01" },
        false,
      ],
      ["company all_time by day", { period: "all_time", granularity: "day" }, true],
      ["an unknown period", { period: "lifetime" as "range" }, true],
      ["a reversed range", { fromDate: "2026-11-01", toDateExclusive: "2026-10-01" }, true],
      ["a range over 732 days", { fromDate: "2024-01-01", toDateExclusive: "2026-12-01" }, false],
    ];
    for (const [name, query, company] of rejected)
      it(`rejects ${name} with 422`, () => {
        expect(() => periodQuery(query, { company })).toThrow(
          expect.objectContaining({ statusCode: 422 }),
        );
      });

    it("defaults to range by day and all_time by month", () => {
      expect(
        periodQuery({ fromDate: "2026-10-01", toDateExclusive: "2026-11-01" }, { company: true }),
      ).toEqual({
        period: "range",
        game: undefined,
        granularity: "day",
        fromDate: "2026-10-01",
        toDateExclusive: "2026-11-01",
      });
      expect(periodQuery({ period: "all_time", game: "ats" }, { company: true })).toEqual({
        period: "all_time",
        game: "ats",
        granularity: "month",
      });
      expect(
        periodQuery({ period: "all_time", granularity: "month" }, { company: true }).granularity,
      ).toBe("month");
    });

    it("lets the leaderboard ignore granularity for all_time", () => {
      expect(periodQuery({ period: "all_time", granularity: "day" }, { company: false })).toEqual({
        period: "all_time",
        game: undefined,
        granularity: "month",
      });
    });
  });

  describe("leaderboard keyset", () => {
    it("compares decimal strings exactly at any scale", () => {
      expect(compareDecimal("10", "9.99")).toBe(1);
      expect(compareDecimal("0.1", "0.10")).toBe(0);
      expect(compareDecimal("350000", "350000.88")).toBe(-1);
      expect(compareDecimal("-1", "0")).toBe(-1);
      expect(compareDecimal("12345678901234567890.1", "12345678901234567890.09")).toBe(1);
      expect(compareDecimal("0.000000000000000001", "0")).toBe(1);
      expect(() => compareDecimal("1e5", "0")).toThrow("INVALID_DECIMAL");
    });

    const ids = Array.from({ length: 5 }, () => newId()).sort();
    const rows = [
      { id: ids[0] ?? "", distance: "100.5", trips: 2 },
      { id: ids[1] ?? "", distance: "100.5", trips: 2 },
      { id: ids[2] ?? "", distance: "100.5", trips: 1 },
      // A member whose trips have no distance ranks with zero distance.
      { id: ids[3] ?? "", distance: "0", trips: 1 },
      { id: ids[4] ?? "", distance: "0", trips: 1 },
    ];
    const row = (index: number) => {
      const found = rows[index];
      if (!found) throw new Error("MISSING_ROW");
      return found;
    };

    it("continues after the cursor row, breaking ties by member ID", () => {
      expect(rows.map((_, index) => afterIndex(rows, row(index)))).toEqual([1, 2, 3, 4, 5]);
    });

    it("does not restart or repeat when the cursor row is gone or has moved", () => {
      const withoutSecond = rows.filter((item) => item.id !== ids[1]);
      expect(afterIndex(withoutSecond, row(1))).toBe(1);
      expect(withoutSecond[1]?.id).toBe(ids[2]);
      expect(afterIndex(rows, { id: newId(), distance: "1000", trips: 9 })).toBe(0);
      expect(afterIndex(rows, { id: ids[0] ?? "", distance: "50", trips: 9 })).toBe(3);
      expect(afterIndex([], row(0))).toBe(0);
    });
  });
});
