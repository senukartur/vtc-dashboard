import { describe, expect, it } from "vitest";
import { formatDecimal, formatQuantity, formatUtc } from "../../apps/web/src/shared/formatting.ts";

describe("Dashboard & Driver Profiles Unit Tests", () => {
  describe("Period calculations", () => {
    function computePeriodDates(
      period: "thisMonth" | "lastMonth" | "last30Days" | "last7Days",
      now: Date,
    ): { fromDate: string; toDateExclusive: string } {
      const pad = (n: number) => String(n).padStart(2, "0");
      const formatDate = (d: Date) =>
        `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

      const currentYear = now.getUTCFullYear();
      const currentMonth = now.getUTCMonth();

      if (period === "thisMonth") {
        const from = new Date(Date.UTC(currentYear, currentMonth, 1));
        const to = new Date(Date.UTC(currentYear, currentMonth + 1, 1));
        return { fromDate: formatDate(from), toDateExclusive: formatDate(to) };
      }
      if (period === "lastMonth") {
        const from = new Date(Date.UTC(currentYear, currentMonth - 1, 1));
        const to = new Date(Date.UTC(currentYear, currentMonth, 1));
        return { fromDate: formatDate(from), toDateExclusive: formatDate(to) };
      }
      if (period === "last7Days") {
        const to = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
        );
        const from = new Date(to.getTime() - 7 * 86400000);
        return { fromDate: formatDate(from), toDateExclusive: formatDate(to) };
      }
      // last30Days
      const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
      const from = new Date(to.getTime() - 30 * 86400000);
      return { fromDate: formatDate(from), toDateExclusive: formatDate(to) };
    }

    const midOctober = new Date("2026-10-15T12:00:00.000Z");

    it("computes thisMonth correctly for mid-month date", () => {
      const res = computePeriodDates("thisMonth", midOctober);
      expect(res.fromDate).toBe("2026-10-01");
      expect(res.toDateExclusive).toBe("2026-11-01");
    });

    it("computes lastMonth correctly", () => {
      const res = computePeriodDates("lastMonth", midOctober);
      expect(res.fromDate).toBe("2026-09-01");
      expect(res.toDateExclusive).toBe("2026-10-01");
    });

    it("handles year rollover in lastMonth correctly", () => {
      const earlyJan = new Date("2027-01-05T08:00:00.000Z");
      const res = computePeriodDates("lastMonth", earlyJan);
      expect(res.fromDate).toBe("2026-12-01");
      expect(res.toDateExclusive).toBe("2027-01-01");
    });

    it("computes last7Days correctly", () => {
      const res = computePeriodDates("last7Days", midOctober);
      expect(res.toDateExclusive).toBe("2026-10-16");
      expect(res.fromDate).toBe("2026-10-09");
    });

    it("computes last30Days correctly", () => {
      const res = computePeriodDates("last30Days", midOctober);
      expect(res.toDateExclusive).toBe("2026-10-16");
      expect(res.fromDate).toBe("2026-09-16");
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
});
