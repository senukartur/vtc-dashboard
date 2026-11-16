import type { components } from "@vtc/contracts";
import type { TransactionClient } from "@vtc/db";
import { sourceMessages, tripFacts, trips } from "@vtc/db/trips-schema";
import { and, eq, isNotNull, type SQL, sql } from "drizzle-orm";
import { identityError } from "../identity/service.js";
import { addDistances, decimal, subtractDistances } from "./distance.js";

type S = components["schemas"];
export type Breakdown = S["AnalyticsStage4Breakdown"];
export type BreakdownTotals = S["AnalyticsStage4Totals"];
type CatalogLabel = S["CatalogLabel"];
type Game = "ets2" | "ats";

const sources = ["ets2telemetry", "manual"] as const;

export type BreakdownDimension = "route" | "cargo" | "source";
export type RankedDimension = Exclude<BreakdownDimension, "source">;

/** Wire query of getCompanyAnalyticsBreakdown; the period fields follow periodQuery(). */
export interface BreakdownQuery {
  dimension: BreakdownDimension;
  game?: Game | undefined;
  fromDate?: string | undefined;
  toDateExclusive?: string | undefined;
  period?: "range" | "all_time" | undefined;
  locale?: "en" | "ru" | undefined;
  limit?: number | undefined;
}

export type BreakdownOptions =
  | { dimension: RankedDimension; limit: number }
  | { dimension: "source"; limit?: undefined };

export const defaultBreakdownLimit = 5;
export const maxBreakdownLimit = 10;

/** Dimension and top-N limit, validated before any database work (422). */
export function breakdownOptions(
  query: Pick<BreakdownQuery, "dimension" | "limit">,
): BreakdownOptions {
  const { dimension, limit } = query;
  if (dimension === "source") {
    // The source split always has exactly two items, so a limit is a client error.
    if (limit !== undefined) throw identityError(422);
    return { dimension };
  }
  if (dimension !== "route" && dimension !== "cargo") throw identityError(422);
  const value = limit ?? defaultBreakdownLimit;
  if (!Number.isInteger(value) || value < 1 || value > maxBreakdownLimit) {
    throw identityError(422);
  }
  return { dimension, limit: value };
}

export interface AggregateRow {
  trips: number | string;
  distance: string | number | null;
}
export interface SplitRow extends AggregateRow {
  known: number | string | boolean | null;
  version: number | string | null;
}
export interface SourceRow extends AggregateRow {
  provider: (typeof sources)[number] | null;
  version: number | string | null;
}
export interface RouteRow extends AggregateRow {
  game: Game;
  originCityId: string | null;
  destinationCityId: string | null;
}
export interface CargoRow extends AggregateRow {
  game: Game;
  cargoId: string | null;
}

// Per-trip tenth truncation, as in the company totals, so every part folds back exactly.
const tripCount = sql<number | string>`count(*)`;
const distanceSum = sql<string>`coalesce(sum(truncate(${trips.actualDistanceM}, 1)), 0)`;
const versionMax = sql<
  number | string
>`max(greatest(${trips.version}, ${trips.adjudicationVersion}))`;
const knownCondition = (dimension: RankedDimension) =>
  dimension === "route"
    ? sql`(${tripFacts.originCityId} is not null and ${tripFacts.destinationCityId} is not null)`
    : sql`(${tripFacts.cargoId} is not null)`;

/**
 * Statement D: accepted trips split into resolved (known = 1) and undetermined (known = 0)
 * for the dimension. A trip without a current fact, or with a dangling pointer, is undetermined.
 * Keep in sync with the EXPLAIN mirror in test/integration/analytics.test.ts.
 */
export function readKnownSplit(
  db: TransactionClient,
  dimension: RankedDimension,
  accepted: SQL | undefined,
): Promise<SplitRow[]> {
  return db
    .select({
      known: sql<number | string>`${knownCondition(dimension)}`.as("known"),
      trips: tripCount,
      distance: distanceSum,
      version: versionMax,
    })
    .from(trips)
    .leftJoin(tripFacts, eq(tripFacts.id, trips.currentFactId))
    .where(accepted)
    .groupBy(sql`known`);
}

/**
 * Statement T: the top `limit` resolved groups, ranked by accepted trips, then distance, then
 * IDs. Directed routes keep origin and destination apart, so A to B and B to A are separate.
 * Keep in sync with the EXPLAIN mirror in test/integration/analytics.test.ts.
 */
export function readTopRoutes(
  db: TransactionClient,
  accepted: SQL | undefined,
  limit: number,
): Promise<RouteRow[]> {
  return db
    .select({
      game: trips.game,
      originCityId: tripFacts.originCityId,
      destinationCityId: tripFacts.destinationCityId,
      trips: tripCount,
      distance: distanceSum,
    })
    .from(trips)
    .innerJoin(tripFacts, eq(tripFacts.id, trips.currentFactId))
    .where(and(accepted, isNotNull(tripFacts.originCityId), isNotNull(tripFacts.destinationCityId)))
    .groupBy(trips.game, tripFacts.originCityId, tripFacts.destinationCityId)
    .orderBy(
      sql`${tripCount} desc`,
      sql`${distanceSum} desc`,
      tripFacts.originCityId,
      tripFacts.destinationCityId,
      trips.game,
    )
    .limit(limit);
}

/** Statement T for cargo. Keep in sync with the EXPLAIN mirror in test/integration/analytics.test.ts. */
export function readTopCargo(
  db: TransactionClient,
  accepted: SQL | undefined,
  limit: number,
): Promise<CargoRow[]> {
  return db
    .select({
      game: trips.game,
      cargoId: tripFacts.cargoId,
      trips: tripCount,
      distance: distanceSum,
    })
    .from(trips)
    .innerJoin(tripFacts, eq(tripFacts.id, trips.currentFactId))
    .where(and(accepted, isNotNull(tripFacts.cargoId)))
    .groupBy(trips.game, tripFacts.cargoId)
    .orderBy(sql`${tripCount} desc`, sql`${distanceSum} desc`, tripFacts.cargoId, trips.game)
    .limit(limit);
}

/**
 * Statement S: accepted trips by the provider of their effective fact. A derived fact counts
 * under its source message, so a corrected or reconciled trip counts once under that provider.
 * Keep in sync with the EXPLAIN mirror in test/integration/analytics.test.ts.
 */
export function readSources(
  db: TransactionClient,
  accepted: SQL | undefined,
): Promise<SourceRow[]> {
  return db
    .select({
      provider: sourceMessages.provider,
      trips: tripCount,
      distance: distanceSum,
      version: versionMax,
    })
    .from(trips)
    .leftJoin(tripFacts, eq(tripFacts.id, trips.currentFactId))
    .leftJoin(
      sourceMessages,
      eq(
        sourceMessages.id,
        sql`coalesce(${tripFacts.messageId}, ${tripFacts.derivedSourceMessageId})`,
      ),
    )
    .where(accepted)
    .groupBy(sourceMessages.provider);
}

const zero = (): BreakdownTotals => ({ acceptedTrips: 0, actualDistanceM: "0" });

const totalsOf = (row: AggregateRow): BreakdownTotals => ({
  acceptedTrips: Number(row.trips),
  actualDistanceM: decimal(row.distance),
});

const plus = (a: BreakdownTotals, b: BreakdownTotals): BreakdownTotals => ({
  acceptedTrips: a.acceptedTrips + b.acceptedTrips,
  actualDistanceM: addDistances(a.actualDistanceM, b.actualDistanceM),
});

const add = (sum: BreakdownTotals, row: AggregateRow) => plus(sum, totalsOf(row));

const subtract = (whole: BreakdownTotals, part: BreakdownTotals): BreakdownTotals => {
  if (part.acceptedTrips > whole.acceptedTrips) throw new Error("ANALYTICS_BREAKDOWN_INVARIANT");
  return {
    acceptedTrips: whole.acceptedTrips - part.acceptedTrips,
    actualDistanceM: subtractDistances(whole.actualDistanceM, part.actualDistanceM),
  };
};

/** The newest accepted trip version, at least 1, as in getCompanyAnalytics. */
const projectionVersion = (rows: readonly { version: number | string | null }[]) =>
  rows.reduce((max, row) => Math.max(max, Number(row.version ?? 0)), 1);

export interface FoldedTotals {
  totals: BreakdownTotals;
  undetermined: BreakdownTotals;
  remainder: BreakdownTotals;
  projectionVersion: number;
}

/**
 * Route and cargo totals from statement D and the shown items of statement T, read in one
 * snapshot: totals = resolved + undetermined, remainder = resolved - shown, all exact.
 */
export function foldTotals(
  split: readonly SplitRow[],
  shown: readonly AggregateRow[],
): FoldedTotals {
  let resolved = zero();
  let undetermined = zero();
  for (const row of split) {
    if (Number(row.known) === 1) resolved = add(resolved, row);
    else undetermined = add(undetermined, row);
  }
  const items = shown.reduce((sum, row) => add(sum, row), zero());
  return {
    totals: plus(resolved, undetermined),
    undetermined,
    remainder: subtract(resolved, items),
    projectionVersion: projectionVersion(split),
  };
}

/** The source split: always ets2telemetry then manual, including zeros; remainder is zero. */
export function foldSources(rows: readonly SourceRow[]): FoldedTotals & {
  items: S["AnalyticsStage4SourceItem"][];
} {
  let totals = zero();
  let undetermined = zero();
  const split = sources.map(() => zero());
  for (const row of rows) {
    totals = add(totals, row);
    const index = row.provider ? sources.indexOf(row.provider) : -1;
    const part = split[index];
    // A trip without a current fact or source message has no provider: undetermined.
    if (part) split[index] = add(part, row);
    else undetermined = add(undetermined, row);
  }
  return {
    totals,
    undetermined,
    remainder: zero(),
    projectionVersion: projectionVersion(rows),
    items: sources.map((source, index) => ({ source, ...(split[index] ?? zero()) })),
  };
}

const present = (id: string | null) => {
  if (id === null) throw new Error("ANALYTICS_BREAKDOWN_INVARIANT");
  return id;
};

/** City references of the shown routes (at most 2 * maxBreakdownLimit) for one label batch. */
export const routeRefs = (rows: readonly RouteRow[]) =>
  rows.flatMap((row) => [
    { kind: "city" as const, id: present(row.originCityId) },
    { kind: "city" as const, id: present(row.destinationCityId) },
  ]);

/** Cargo references of the shown cargo items for one label batch. */
export const cargoRefs = (rows: readonly CargoRow[]) =>
  rows.map((row) => ({ kind: "cargo" as const, id: present(row.cargoId) }));

const labelOf = (labels: ReadonlyMap<string, CatalogLabel>, id: string | null) => {
  const found = labels.get(present(id));
  // Trip facts reference catalog rows through foreign keys, so a missing label is a server error.
  if (!found) throw new Error("ANALYTICS_LABEL_MISSING");
  return found;
};

export function routeItems(
  rows: readonly RouteRow[],
  labels: ReadonlyMap<string, CatalogLabel>,
): S["AnalyticsStage4RouteItem"][] {
  return rows.map((row) => ({
    game: row.game,
    origin: labelOf(labels, row.originCityId),
    destination: labelOf(labels, row.destinationCityId),
    ...totalsOf(row),
  }));
}

export function cargoItems(
  rows: readonly CargoRow[],
  labels: ReadonlyMap<string, CatalogLabel>,
): S["AnalyticsStage4CargoItem"][] {
  return rows.map((row) => ({
    game: row.game,
    cargo: labelOf(labels, row.cargoId),
    ...totalsOf(row),
  }));
}
