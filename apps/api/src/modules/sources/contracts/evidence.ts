import type { TxContext } from "@vtc/db";

export type Provider = "ets2telemetry" | "manual";
export type Game = "ets2" | "ats";
export type Outcome = "open" | "delivered" | "cancelled" | "none";
export type Recording = "complete" | "partial" | "unknown";
export type Fact<T> =
  | { status: "known"; value: T; sourceRecordId: string; sourceField: string }
  | { status: "unknown"; reasonCode: string; sourceRecordId: string };
export type TripEntity = { entityId: string };
export type AdrClass = "1" | "2" | "3" | "4" | "6" | "8";
export type ReportedTime = {
  utc: string | null;
  basis: "event" | "checkpoint" | "last-known" | "receipt" | "unknown" | "staff-resolution";
  verifiedActual: boolean;
};
export type RecordedTelemetry = {
  jobType: "quick-job" | "freight-market" | "cargo-market" | "world-of-trucks" | "unknown";
  gameMode: "single-player" | "truckersmp" | "haulmp" | "unknown";
  hardModeResult: "qualified" | "not-qualified" | "unknown";
};
/** Origin or destination company: the depot recognized in the trip city and the raw provider code. */
export type CompanyFact = { depotId: string | null; code: string | null };
export interface NormalizedTripEvidence {
  sourceRecordId: string;
  factRevisionId: string;
  provider: Provider;
  ownerUserId: string;
  game: Game;
  outcome: Outcome;
  recording: Recording;
  start: ReportedTime;
  end: ReportedTime;
  origin: Fact<TripEntity>;
  destination: Fact<TripEntity>;
  cargo: Fact<TripEntity>;
  cargoMassKg: Fact<string>;
  actualDistanceM: Fact<string>;
  measuredSegmentM: Fact<string>;
  plannedDistanceM: Fact<string>;
  deliveredDistanceM: Fact<string>;
  fuelUsedL: Fact<string>;
  cargoDamageFraction: Fact<string>;
  money: unknown;
  provenance: unknown;
  recordedTelemetry?: RecordedTelemetry;
  wholeTripDistanceSupported: boolean;
  trailers: { complete: boolean; items: readonly Fact<TripEntity>[] };
  adrCategory: Fact<AdrClass>;
  ruleContextComplete: boolean;
  reasonCodes: readonly string[];
  // Display context only: quality, conflict, acceptance and reconciliation rules never read it.
  companies?: { origin: CompanyFact; destination: CompanyFact };
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
  /** Exact lookup by (game, code); hidden rows are still recognized. */
  resolveInTransaction(
    tx: TxContext,
    input: { game: Game; kind: "city" | "cargo" | "trailer"; code: string },
  ): Promise<
    | { status: "resolved"; id: string; adrClass: AdrClass | null }
    | { status: "unknown"; reasonCode: string }
  >;
  selectionsInTransaction(
    tx: TxContext,
    selections: readonly { kind: "city" | "cargo" | "trailer"; id: string }[],
  ): Promise<
    Map<
      string,
      {
        id: string;
        game: Game;
        kind: "city" | "cargo" | "trailer";
        hidden: boolean;
        adrClass: AdrClass | null;
      }
    >
  >;
  /** A depot of the company in the city; hidden rows are still recognized. Pass one of the keys. */
  depotInTransaction?(
    tx: TxContext,
    input: { game: Game; cityId: string; companyCode?: string; companyId?: string },
  ): Promise<{ id: string; companyCode: string } | null>;
}
export interface AdapterContext {
  tx: TxContext;
  ownerUserId: string;
  sourceRecordId: string;
  factRevisionId: string;
  catalogs?: CatalogPort;
  // Trusted coordinator selection of a manual revision; never read from the source payload.
  manualCompanies?: { originCompanyId: string | null; destinationCompanyId: string | null };
}
// Future providers implement this same boundary after their own reviewed contract/registration.
export interface TripSourceAdapter {
  readonly provider: Provider;
  readonly version: 1 | 2;
  identity(payload: unknown): SourceIdentity;
  normalize(payload: unknown, context: AdapterContext): Promise<NormalizedTripEvidence>;
}
