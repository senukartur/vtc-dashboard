import type { TxContext } from "@vtc/db";

export type Provider = "ets2telemetry" | "manual";
export type Game = "ets2" | "ats";
export type Outcome = "open" | "delivered" | "cancelled" | "none";
export type Recording = "complete" | "partial" | "unknown";
export type Fact<T> =
  | { status: "known"; value: T; sourceRecordId: string; sourceField: string }
  | { status: "unknown"; reasonCode: string; sourceRecordId: string };
export type PinnedEntity = { entityId: string; catalogRevisionId: string; factRevisionId: string };
export type ReportedTime = {
  utc: string | null;
  basis: "event" | "checkpoint" | "last-known" | "receipt" | "unknown";
  verifiedActual: boolean;
};
export interface NormalizedTripEvidence {
  sourceRecordId: string;
  factRevisionId: string;
  provider: Provider;
  ownerUserId: string;
  game: Game;
  outcome: Outcome;
  recording: Recording;
  catalogRevisionId: string | null;
  start: ReportedTime;
  end: ReportedTime;
  origin: Fact<PinnedEntity>;
  destination: Fact<PinnedEntity>;
  cargo: Fact<PinnedEntity>;
  cargoMassKg: Fact<string>;
  actualDistanceM: Fact<string>;
  measuredSegmentM: Fact<string>;
  plannedDistanceM: Fact<string>;
  deliveredDistanceM: Fact<string>;
  fuelUsedL: Fact<string>;
  cargoDamageFraction: Fact<string>;
  money: unknown;
  provenance: unknown;
  wholeTripDistanceSupported: boolean;
  trailers: { complete: boolean; items: readonly Fact<PinnedEntity>[] };
  adrCategory: Fact<PinnedEntity>;
  ruleContextComplete: boolean;
  reasonCodes: readonly string[];
}
export interface SourceIdentity {
  provider: Provider;
  game: Game;
  sessionKey: string;
  tripKey: string;
  eventKey: string;
  revision: number;
  deliveryMode: "live" | "backfill" | "manual";
}
export interface CatalogPort {
  publishedInTransaction(tx: TxContext, game: Game, gameBuild: string): Promise<string | null>;
  resolveInTransaction(
    tx: TxContext,
    input: {
      revisionId: string;
      game: Game;
      kind: "city" | "cargo" | "trailer_type";
      mapNamespace: string | null;
      provider: string;
      sourceId: string | null;
      locale: "en" | "ru" | null;
      label: string | null;
      regionId: string | null;
    },
  ): Promise<
    | { status: "resolved"; entityId: string; factRevisionId: string }
    | { status: "unknown"; reasonCode: string }
    | { status: "ambiguous"; candidateIds: string[] }
  >;
  pinnedInTransaction(
    tx: TxContext,
    revisionId: string,
    entityId: string,
  ): Promise<{
    id: string;
    entityId: string;
    game: Game;
    kind: string;
    adrCategoryId: string | null;
  } | null>;
}
export interface AdapterContext {
  tx: TxContext;
  ownerUserId: string;
  sourceRecordId: string;
  factRevisionId: string;
  catalogs?: CatalogPort;
}
// Future providers implement this same boundary after their own reviewed contract/registration.
export interface TripSourceAdapter {
  readonly provider: Provider;
  readonly version: 1 | 2;
  versionFor?(payload: unknown): 1 | 2;
  identity(payload: unknown): SourceIdentity;
  normalize(payload: unknown, context: AdapterContext): Promise<NormalizedTripEvidence>;
}
