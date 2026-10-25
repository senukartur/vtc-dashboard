import type { components } from "@vtc/contracts";
import { applicationId, type TxContext, type UnitOfWork } from "@vtc/db";
import { company, membership } from "@vtc/db/identity-schema";
import { trips } from "@vtc/db/trips-schema";
import { and, eq, gte, isNull, lt, or, sql } from "drizzle-orm";
import { type Actor, type Identity, identityError } from "../identity/service.js";
import { pagination } from "./pagination.js";

type Analytics = components["schemas"]["Analytics"];
type LeaderboardEntry = components["schemas"]["LeaderboardEntry"];
type ListLeaderboardEntry = components["schemas"]["ListLeaderboardEntry"];

export interface AnalyticsConfig {
  enabled?: boolean | undefined;
  cursorKey: string;
  reportingTimezone?: string | undefined;
}

export interface AnalyticsQuery {
  game?: "ets2" | "ats" | undefined;
  fromDate: string;
  toDateExclusive: string;
  granularity?: "day" | "month" | undefined;
}

export interface LeaderboardQuery extends AnalyticsQuery {
  limit?: number | undefined;
  cursor?: string | undefined;
}

export function validateAnalyticsConfig(config: AnalyticsConfig): void {
  if (config.enabled === false) {
    return;
  }
  if (typeof config.cursorKey !== "string" || !/^[0-9a-f]{64}$/.test(config.cursorKey)) {
    throw new Error("INVALID_ANALYTICS_CURSOR_KEY");
  }
  if (config.reportingTimezone !== undefined) {
    if (
      typeof config.reportingTimezone !== "string" ||
      config.reportingTimezone.length < 1 ||
      config.reportingTimezone.length > 128
    ) {
      throw new Error("INVALID_ANALYTICS_REPORTING_TIMEZONE");
    }
    try {
      Intl.DateTimeFormat(undefined, { timeZone: config.reportingTimezone });
    } catch {
      throw new Error("INVALID_ANALYTICS_REPORTING_TIMEZONE");
    }
  }
}

export function decimal(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === 0 || value === "0") return "0";
  const str = typeof value === "number" ? value.toFixed(1) : String(value);
  const clean = str.replace(/\.0+$/, "").replace(/(\.\d*?[1-9])0+$/, "$1");
  return clean === "" || clean === "-0" ? "0" : clean;
}

export function addDistances(a: string, b: string): string {
  const parseScaled = (s: string) => {
    const clean = decimal(s);
    if (clean === "0") return 0n;
    const [whole = "0", frac = ""] = clean.split(".");
    const fracPadded = `${frac}0`.slice(0, 1);
    return BigInt(whole) * 10n + BigInt(fracPadded);
  };
  const sum = parseScaled(a) + parseScaled(b);
  if (sum === 0n) return "0";
  const whole = sum / 10n;
  const frac = sum % 10n;
  return frac === 0n ? whole.toString() : `${whole}.${frac}`;
}

export function parseTimezoneDate(dateStr: string, timeZone: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) {
    throw new Error(`Invalid date format: ${dateStr}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error(`Invalid calendar date: ${dateStr}`);
  }
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    throw new Error(`Invalid calendar date: ${dateStr}`);
  }

  let utc = Date.UTC(year, month - 1, day, 0, 0, 0);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  for (let i = 0; i < 3; i++) {
    const formattedParts = formatter.formatToParts(new Date(utc));
    const pYear = Number(formattedParts.find((p) => p.type === "year")?.value);
    const pMonth = Number(formattedParts.find((p) => p.type === "month")?.value);
    const pDay = Number(formattedParts.find((p) => p.type === "day")?.value);
    const pHour = Number(formattedParts.find((p) => p.type === "hour")?.value);
    const pMinute = Number(formattedParts.find((p) => p.type === "minute")?.value);
    const pSecond = Number(formattedParts.find((p) => p.type === "second")?.value);

    const currentInTz = Date.UTC(pYear, pMonth - 1, pDay, pHour, pMinute, pSecond);
    const target = Date.UTC(year, month - 1, day, 0, 0, 0);
    const diff = target - currentInTz;
    if (diff === 0) break;
    utc += diff;
  }
  return new Date(utc);
}

export function formatDateInTimezone(
  date: Date,
  timeZone: string,
  granularity: "day" | "month",
): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const formatted = formatter.format(date); // "YYYY-MM-DD"
  if (granularity === "month") {
    return `${formatted.slice(0, 7)}-01`;
  }
  return formatted;
}

export function generateBuckets(
  fromDate: string,
  toDateExclusive: string,
  granularity: "day" | "month",
): Array<{ date: string; acceptedTrips: number; actualDistanceM: string }> {
  const buckets: Array<{ date: string; acceptedTrips: number; actualDistanceM: string }> = [];
  const startParts = fromDate.split("-").map(Number);
  const endParts = toDateExclusive.split("-").map(Number);
  const startYear = startParts[0] ?? 2026;
  const startMonth = startParts[1] ?? 1;
  const startDay = startParts[2] ?? 1;
  const endYear = endParts[0] ?? 2026;
  const endMonth = endParts[1] ?? 1;
  const endDay = endParts[2] ?? 1;

  if (granularity === "day") {
    const current = new Date(Date.UTC(startYear, startMonth - 1, startDay));
    const end = new Date(Date.UTC(endYear, endMonth - 1, endDay));
    while (current < end) {
      const y = current.getUTCFullYear();
      const m = String(current.getUTCMonth() + 1).padStart(2, "0");
      const d = String(current.getUTCDate()).padStart(2, "0");
      buckets.push({
        date: `${y}-${m}-${d}`,
        acceptedTrips: 0,
        actualDistanceM: "0",
      });
      current.setUTCDate(current.getUTCDate() + 1);
    }
  } else {
    let y = startYear;
    let m = startMonth;
    const effectiveEndMonth = endDay > 1 ? endYear * 12 + endMonth : endYear * 12 + (endMonth - 1);
    while (y * 12 + m <= effectiveEndMonth) {
      const mStr = String(m).padStart(2, "0");
      const bucketDate = `${y}-${mStr}-01`;
      if (!buckets.some((b) => b.date === bucketDate)) {
        buckets.push({
          date: bucketDate,
          acceptedTrips: 0,
          actualDistanceM: "0",
        });
      }
      m++;
      if (m > 12) {
        m = 1;
        y++;
      }
    }
  }
  return buckets;
}

export function createAnalytics(uow: UnitOfWork, identity: Identity, config: AnalyticsConfig) {
  validateAnalyticsConfig(config);
  const page = pagination(config.cursorKey);

  async function resolveTimezone(tx: TxContext): Promise<string> {
    const [cRow] = await uow.client(tx).select().from(company).limit(1);
    const tz = cRow?.reportingTimezone ?? config.reportingTimezone;
    if (!tz) throw identityError(409, "SETUP_REQUIRED");
    try {
      Intl.DateTimeFormat(undefined, { timeZone: tz });
    } catch {
      throw identityError(409, "SETUP_REQUIRED");
    }
    return tz;
  }

  function validateDateRange(query: AnalyticsQuery) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(query.fromDate) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(query.toDateExclusive)
    ) {
      throw identityError(422);
    }
    if (query.fromDate >= query.toDateExclusive) {
      throw identityError(422);
    }
    const startParts = query.fromDate.split("-").map(Number);
    const endParts = query.toDateExclusive.split("-").map(Number);
    const sy = startParts[0] ?? 2026;
    const sm = startParts[1] ?? 1;
    const sd = startParts[2] ?? 1;
    const ey = endParts[0] ?? 2026;
    const em = endParts[1] ?? 1;
    const ed = endParts[2] ?? 1;
    const sDate = Date.UTC(sy, sm - 1, sd);
    const eDate = Date.UTC(ey, em - 1, ed);
    const days = (eDate - sDate) / (1000 * 60 * 60 * 24);
    if (days > 732) {
      throw identityError(422);
    }
  }

  return {
    async getCompanyAnalytics(actor: Actor, query: AnalyticsQuery): Promise<Analytics> {
      validateDateRange(query);
      return uow.run(async (tx) => {
        await identity.authorizeInTransaction(tx, actor, "company.read");
        const timeZone = await resolveTimezone(tx);
        const startIso = parseTimezoneDate(query.fromDate, timeZone).toISOString();
        const endIso = parseTimezoneDate(query.toDateExclusive, timeZone).toISOString();
        const granularity = query.granularity ?? "day";

        const conditions = [
          isNull(trips.aliasOf),
          eq(trips.decision, "accepted"),
          gte(trips.reportingAt, startIso),
          lt(trips.reportingAt, endIso),
        ];
        if (query.game) {
          conditions.push(eq(trips.game, query.game));
        }

        const acceptedRows = await uow
          .client(tx)
          .select({
            id: trips.id,
            reportingAt: trips.reportingAt,
            actualDistanceM: trips.actualDistanceM,
            version: trips.version,
            adjudicationVersion: trips.adjudicationVersion,
          })
          .from(trips)
          .where(and(...conditions));

        const pendingConditions = [
          isNull(trips.aliasOf),
          or(
            eq(trips.assessmentPending, true),
            eq(trips.correctionPending, true),
            eq(trips.decision, "pending_review"),
          ),
          gte(trips.reportingAt, startIso),
          lt(trips.reportingAt, endIso),
        ];
        if (query.game) {
          pendingConditions.push(eq(trips.game, query.game));
        }

        const pendingRows = await uow
          .client(tx)
          .select({ id: trips.id })
          .from(trips)
          .where(and(...pendingConditions))
          .limit(1);

        const projectionPending = pendingRows.length > 0;
        let projectionVersion = 1;
        let totalDistance = "0";

        const buckets = generateBuckets(query.fromDate, query.toDateExclusive, granularity);
        const bucketMap = new Map(buckets.map((b) => [b.date, b]));

        for (const row of acceptedRows) {
          if (row.adjudicationVersion > projectionVersion) {
            projectionVersion = row.adjudicationVersion;
          }
          if (row.version > projectionVersion) {
            projectionVersion = row.version;
          }
          const rowDistance = decimal(row.actualDistanceM);
          totalDistance = addDistances(totalDistance, rowDistance);

          if (row.reportingAt) {
            const bucketKey = formatDateInTimezone(
              new Date(row.reportingAt),
              timeZone,
              granularity,
            );
            const b = bucketMap.get(bucketKey);
            if (b) {
              b.acceptedTrips += 1;
              b.actualDistanceM = addDistances(b.actualDistanceM, rowDistance);
            }
          }
        }

        return {
          acceptedTrips: acceptedRows.length,
          actualDistanceM: totalDistance,
          reportingTimezone: timeZone,
          fromDate: query.fromDate,
          toDateExclusive: query.toDateExclusive,
          granularity,
          buckets,
          computedAt: new Date().toISOString(),
          projectionVersion,
          projectionPending,
        };
      });
    },

    async getMemberAnalytics(
      actor: Actor,
      memberId: string,
      query: AnalyticsQuery,
    ): Promise<Analytics> {
      validateDateRange(query);
      const parsedMemberId = applicationId(memberId);

      return uow.run(async (tx) => {
        await identity.authorizeInTransaction(tx, actor, "company.read");
        const [memberRow] = await uow
          .client(tx)
          .select({ userId: membership.userId })
          .from(membership)
          .where(eq(membership.userId, parsedMemberId))
          .limit(1);
        if (!memberRow) throw identityError(404);

        const timeZone = await resolveTimezone(tx);
        const startIso = parseTimezoneDate(query.fromDate, timeZone).toISOString();
        const endIso = parseTimezoneDate(query.toDateExclusive, timeZone).toISOString();
        const granularity = query.granularity ?? "day";

        const conditions = [
          isNull(trips.aliasOf),
          eq(trips.ownerId, parsedMemberId),
          eq(trips.decision, "accepted"),
          gte(trips.reportingAt, startIso),
          lt(trips.reportingAt, endIso),
        ];
        if (query.game) {
          conditions.push(eq(trips.game, query.game));
        }

        const acceptedRows = await uow
          .client(tx)
          .select({
            id: trips.id,
            reportingAt: trips.reportingAt,
            actualDistanceM: trips.actualDistanceM,
            version: trips.version,
            adjudicationVersion: trips.adjudicationVersion,
          })
          .from(trips)
          .where(and(...conditions));

        const pendingConditions = [
          isNull(trips.aliasOf),
          eq(trips.ownerId, parsedMemberId),
          or(
            eq(trips.assessmentPending, true),
            eq(trips.correctionPending, true),
            eq(trips.decision, "pending_review"),
          ),
          gte(trips.reportingAt, startIso),
          lt(trips.reportingAt, endIso),
        ];
        if (query.game) {
          pendingConditions.push(eq(trips.game, query.game));
        }

        const pendingRows = await uow
          .client(tx)
          .select({ id: trips.id })
          .from(trips)
          .where(and(...pendingConditions))
          .limit(1);

        const projectionPending = pendingRows.length > 0;
        let projectionVersion = 1;
        let totalDistance = "0";

        const buckets = generateBuckets(query.fromDate, query.toDateExclusive, granularity);
        const bucketMap = new Map(buckets.map((b) => [b.date, b]));

        for (const row of acceptedRows) {
          if (row.adjudicationVersion > projectionVersion) {
            projectionVersion = row.adjudicationVersion;
          }
          if (row.version > projectionVersion) {
            projectionVersion = row.version;
          }
          const rowDistance = decimal(row.actualDistanceM);
          totalDistance = addDistances(totalDistance, rowDistance);

          if (row.reportingAt) {
            const bucketKey = formatDateInTimezone(
              new Date(row.reportingAt),
              timeZone,
              granularity,
            );
            const b = bucketMap.get(bucketKey);
            if (b) {
              b.acceptedTrips += 1;
              b.actualDistanceM = addDistances(b.actualDistanceM, rowDistance);
            }
          }
        }

        return {
          acceptedTrips: acceptedRows.length,
          actualDistanceM: totalDistance,
          reportingTimezone: timeZone,
          fromDate: query.fromDate,
          toDateExclusive: query.toDateExclusive,
          granularity,
          buckets,
          computedAt: new Date().toISOString(),
          projectionVersion,
          projectionPending,
        };
      });
    },

    async getLeaderboard(actor: Actor, query: LeaderboardQuery): Promise<ListLeaderboardEntry> {
      validateDateRange(query);
      return uow.run(async (tx) => {
        await identity.authorizeInTransaction(tx, actor, "company.read");
        const timeZone = await resolveTimezone(tx);
        const startIso = parseTimezoneDate(query.fromDate, timeZone).toISOString();
        const endIso = parseTimezoneDate(query.toDateExclusive, timeZone).toISOString();

        const conditions = [
          isNull(trips.aliasOf),
          eq(trips.decision, "accepted"),
          gte(trips.reportingAt, startIso),
          lt(trips.reportingAt, endIso),
        ];
        if (query.game) {
          conditions.push(eq(trips.game, query.game));
        }

        const grouped = await uow
          .client(tx)
          .select({
            ownerId: trips.ownerId,
            acceptedTrips: sql<number>`count(*)`,
            actualDistanceM: sql<string>`coalesce(sum(${trips.actualDistanceM}), 0)`,
          })
          .from(trips)
          .where(and(...conditions))
          .groupBy(trips.ownerId)
          .orderBy(sql`sum(${trips.actualDistanceM}) desc`, sql`count(*) desc`, trips.ownerId);

        const formattedRows: Array<{
          ownerId: string;
          acceptedTrips: number;
          actualDistanceM: string;
        }> = grouped.map(
          (row: { ownerId: string; acceptedTrips: number; actualDistanceM: string }) => ({
            ownerId: row.ownerId,
            acceptedTrips: Number(row.acceptedTrips),
            actualDistanceM: decimal(row.actualDistanceM),
          }),
        );

        const scope = [query.game ?? null, query.fromDate, query.toDateExclusive, timeZone];
        const pager = page(actor, scope, { limit: query.limit, cursor: query.cursor });

        let startingIndex = 0;
        if (pager.after) {
          const idx = formattedRows.findIndex(
            (r: { ownerId: string }) => r.ownerId === pager.after?.id,
          );
          if (idx >= 0) {
            startingIndex = idx + 1;
          }
        }

        const pageSlice = formattedRows.slice(startingIndex, startingIndex + pager.limit + 1);
        const memberIds = pageSlice.map((r: { ownerId: string }) => r.ownerId);
        const memberSummaries = await identity.memberSummariesInTransaction(tx, memberIds);

        const entries: LeaderboardEntry[] = pageSlice.map(
          (r: { ownerId: string; acceptedTrips: number; actualDistanceM: string }) => ({
            member: memberSummaries.get(r.ownerId) ?? {
              id: r.ownerId,
              nickname: "Former Member",
              formerMember: true,
              roles: [],
            },
            acceptedTrips: r.acceptedTrips,
            actualDistanceM: r.actualDistanceM,
          }),
        );

        return pager.finish(entries);
      });
    },
  };
}

export type AnalyticsService = ReturnType<typeof createAnalytics>;
