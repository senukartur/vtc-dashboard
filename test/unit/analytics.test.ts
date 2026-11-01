import { newId, type UnitOfWork } from "@vtc/db";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../../apps/api/src/app.ts";
import { registerAnalyticsRoutes } from "../../apps/api/src/modules/analytics/http.ts";
import { pagination } from "../../apps/api/src/modules/analytics/pagination.ts";
import {
  addDistances,
  createAnalytics,
  currentReportingMonth,
  decimal,
  generateBuckets,
  parseTimezoneDate,
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
