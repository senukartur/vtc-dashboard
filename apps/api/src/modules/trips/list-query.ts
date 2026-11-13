import { createHmac, timingSafeEqual } from "node:crypto";
import type { TxContext, UnitOfWork } from "@vtc/db";
import { applicationId } from "@vtc/db";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  isNull,
  lt,
  or,
  sourceTrips,
  sql,
  tripFacts,
  trips,
} from "@vtc/db/trips-schema";
import { exists, gte, isNotNull, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import type { Catalogs } from "../catalogs/service.js";
import { type Actor, identityError } from "../identity/service.js";
import { canonicalJson } from "../sources/contracts/canonical.js";

export const tripSources = ["ets2telemetry", "manual"] as const;
export const tripOrders = ["asc", "desc", "completion_asc", "completion_desc"] as const;
export const tripDecisions = [
  "unassessed",
  "pending_review",
  "accepted",
  "rejected",
] as const satisfies readonly (typeof trips.$inferSelect)["decision"][];
type TripScope = "company" | "mine" | "review";
export type TripSource = (typeof tripSources)[number];
type TripOrder = (typeof tripOrders)[number];
type TripDecision = (typeof tripDecisions)[number];
type Locale = "en" | "ru";

export interface ListOptions {
  scope?: TripScope;
  game?: "ets2" | "ats";
  decision?: TripDecision;
  source?: TripSource;
  hold?: boolean;
  order?: TripOrder;
  from?: string;
  toExclusive?: string;
  q?: string;
  locale?: Locale;
  ownerId?: string;
  cursor?: string;
  limit?: number;
}

type Search = { number: number } | { label: string };
type Position = { instant: string | null; id: string };
const earliestStoredInstant = "1000-01-01T00:00:00.000Z";
const maxTripNumber = 0xffff_ffff;

function validInstant(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value))
    return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function searchTerm(q: string): Search {
  const digits = /^#?(\d+)$/.exec(q)?.[1];
  if (!digits) return { label: q };
  const number = Number(digits);
  return { number: number > maxTripNumber ? 0 : number };
}

export function normalizeListOptions(options: ListOptions) {
  const {
    scope = "company",
    order = "desc",
    limit = 25,
    game,
    decision,
    source,
    hold,
    from,
    toExclusive,
    q,
    locale,
    ownerId,
    cursor,
  } = options;
  if (
    !["company", "mine", "review"].includes(scope) ||
    !tripOrders.includes(order) ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    (game !== undefined && game !== "ets2" && game !== "ats") ||
    (decision !== undefined && !tripDecisions.includes(decision)) ||
    (source !== undefined && !tripSources.includes(source)) ||
    (hold !== undefined && (scope !== "review" || typeof hold !== "boolean")) ||
    (from !== undefined && !validInstant(from)) ||
    (toExclusive !== undefined && !validInstant(toExclusive)) ||
    (from !== undefined && toExclusive !== undefined && from >= toExclusive) ||
    (q !== undefined && (typeof q !== "string" || !/\S/.test(q) || [...q].length > 128)) ||
    (locale !== undefined && locale !== "en" && locale !== "ru")
  )
    throw identityError(422);
  if (ownerId !== undefined) {
    try {
      applicationId(ownerId);
    } catch {
      throw identityError(422);
    }
  }
  const search = q === undefined ? undefined : searchTerm(q.trim());
  return {
    scope,
    order,
    limit,
    game,
    decision,
    source,
    hold,
    from,
    toExclusive,
    locale,
    ownerId,
    cursor,
    search,
  };
}

const sourceMember = alias(trips, "source_member");
export function tripSourceCondition(db: ReturnType<UnitOfWork["client"]>, source: TripSource): SQL {
  // Two correlated EXISTS probes use source_canonical and trip_group_members.
  return or(
    exists(
      db
        .select({ one: sql`1` })
        .from(sourceTrips)
        .where(and(eq(sourceTrips.canonicalTripId, trips.id), eq(sourceTrips.provider, source))),
    ),
    exists(
      db
        .select({ one: sql`1` })
        .from(sourceMember)
        .innerJoin(sourceTrips, eq(sourceTrips.canonicalTripId, sourceMember.id))
        .where(and(eq(sourceMember.aliasOf, trips.id), eq(sourceTrips.provider, source))),
    ),
  ) as SQL;
}

export function tripSearchCondition(
  unit: UnitOfWork,
  tx: TxContext,
  labelSearchCondition: Catalogs["labelSearchCondition"] | undefined,
  search: Search | undefined,
  locale: Locale,
) {
  if (!search) return undefined;
  if ("number" in search) return search.number ? eq(trips.number, search.number) : sql`false`;
  if (!labelSearchCondition) return sql`false`;
  return exists(
    unit
      .client(tx)
      .select({ one: sql`1` })
      .from(tripFacts)
      .where(
        and(
          eq(tripFacts.id, trips.currentFactId),
          labelSearchCondition(
            tx,
            {
              origin: tripFacts.originCityId,
              destination: tripFacts.destinationCityId,
              cargo: tripFacts.cargoId,
            },
            locale,
            search.label,
          ),
        ),
      ),
  );
}

interface TripListFilter {
  scope: TripScope;
  viewerId: string;
  game?: ListOptions["game"];
  decision?: TripDecision | undefined;
  source?: TripSource | undefined;
  hold?: boolean | undefined;
  order?: TripOrder | undefined;
  ownerId?: string | undefined;
  from?: string | undefined;
  toExclusive?: string | undefined;
  searchCondition?: SQL | undefined;
  after?: Position | null | undefined;
}

function completionOrder(order: TripOrder) {
  return order === "completion_asc" || order === "completion_desc";
}

/** The count and page share the authorized filters; the EXPLAIN guard uses the page predicate. */
export function tripListQuery(db: ReturnType<UnitOfWork["client"]>, filter: TripListFilter) {
  const { scope, viewerId, ownerId, order = "desc", after, from, toExclusive } = filter;
  const completion = completionOrder(order);
  const instant = completion ? trips.actualEnd : trips.createdAt;
  const ascending = order === "asc" || order === "completion_asc";
  const sort = ascending ? asc : desc;
  const compare = ascending ? gt : lt;
  const filtered = and(
    isNull(trips.aliasOf),
    scope === "company" || (ownerId && ownerId !== viewerId)
      ? eq(trips.decision, "accepted")
      : undefined,
    scope === "mine" ? eq(trips.ownerId, viewerId) : undefined,
    ownerId ? eq(trips.ownerId, ownerId) : undefined,
    filter.game ? eq(trips.game, filter.game) : undefined,
    filter.decision ? eq(trips.decision, filter.decision) : undefined,
    filter.hold === undefined ? undefined : eq(trips.reviewHold, filter.hold),
    filter.source ? tripSourceCondition(db, filter.source) : undefined,
    from === undefined
      ? undefined
      : from < earliestStoredInstant
        ? isNotNull(trips.reportingAt)
        : gte(trips.reportingAt, from),
    toExclusive === undefined
      ? undefined
      : toExclusive <= earliestStoredInstant
        ? sql`false`
        : lt(trips.reportingAt, toExclusive),
    filter.searchCondition,
  );
  let keyset: SQL | undefined;
  if (after) {
    const nextId = compare(trips.id, after.id);
    keyset =
      after.instant === null
        ? and(isNull(instant), nextId)
        : or(
            compare(instant, after.instant),
            and(eq(instant, after.instant), nextId),
            completion ? isNull(instant) : undefined,
          );
  }
  return {
    filtered,
    where: keyset ? and(filtered, keyset) : filtered,
    orderBy: [
      // MySQL sorts NULL first in ascending order. Descending already puts it last.
      ...(completion && ascending ? [asc(isNull(instant))] : []),
      sort(instant),
      sort(trips.id),
    ],
  };
}

export function tripListCursor(
  key: string,
  actor: Actor,
  options: ReturnType<typeof normalizeListOptions>,
  locale: Locale,
) {
  const sign = (body: string) =>
    createHmac("sha256", Buffer.from(key, "hex")).update("trips/cursor/v2\0").update(body).digest();
  const binding = [
    actor.userId,
    actor.sessionId,
    actor.accessEpoch,
    options.scope,
    options.order,
    options.game ?? null,
    options.decision ?? null,
    options.source ?? null,
    options.hold ?? null,
    options.from ?? null,
    options.toExclusive ?? null,
    options.search ?? null,
    locale,
    options.ownerId ?? null,
  ];
  return {
    read(): Position | null {
      if (options.cursor === undefined) return null;
      try {
        if (options.cursor.length > 2048) throw new Error();
        const [body = "", mac = "", extra] = options.cursor.split(".");
        if (!/^[A-Za-z0-9_-]+$/.test(body) || !/^[A-Za-z0-9_-]{43}$/.test(mac)) throw new Error();
        const encoded = Buffer.from(body, "base64url");
        const actual = Buffer.from(mac, "base64url");
        if (
          extra !== undefined ||
          actual.toString("base64url") !== mac ||
          encoded.toString("base64url") !== body ||
          actual.length !== 32 ||
          !timingSafeEqual(actual, sign(body))
        )
          throw new Error();
        const parsed = JSON.parse(encoded.toString()) as { binding: unknown; position: Position };
        if (canonicalJson(parsed.binding) !== canonicalJson(binding)) throw new Error();
        const { instant, id } = parsed.position;
        applicationId(id);
        if (!(validInstant(instant) || (instant === null && completionOrder(options.order))))
          throw new Error();
        return { instant, id };
      } catch {
        throw identityError(409, "VERSION_CONFLICT");
      }
    },
    write(row: Pick<typeof trips.$inferSelect, "createdAt" | "actualEnd" | "id">) {
      const position: Position = {
        instant: completionOrder(options.order) ? row.actualEnd : row.createdAt,
        id: row.id,
      };
      const body = Buffer.from(JSON.stringify({ binding, position })).toString("base64url");
      return `${body}.${sign(body).toString("base64url")}`;
    },
  };
}
