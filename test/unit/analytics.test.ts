import { newId } from "@vtc/db";
import { describe, expect, it } from "vitest";
import { pagination } from "../../apps/api/src/modules/analytics/pagination.ts";
import {
  addDistances,
  generateBuckets,
  parseTimezoneDate,
  validateAnalyticsConfig,
} from "../../apps/api/src/modules/analytics/service.ts";
import type { Actor } from "../../apps/api/src/modules/identity/service.ts";

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
});
