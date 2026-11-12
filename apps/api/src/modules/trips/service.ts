import type { components } from "@vtc/contracts";
import {
  applicationId,
  newId,
  type TxContext,
  type UnitOfWork,
  utcDateTime,
  utcIso,
} from "@vtc/db";
import {
  and,
  eq,
  inArray,
  isNull,
  sourceMessages,
  sourcePayloads,
  sourceTrips,
  sql,
  tripFacts,
  tripHistory,
  trips,
} from "@vtc/db/trips-schema";
import { causes, retryTransaction, unknownCommit } from "../../platform/jobs/queue.js";
import { createOutbox, type TripEvent } from "../../platform/outbox/events.js";
import type { Catalogs } from "../catalogs/service.js";
import type { Events } from "../events/service.js";
import { type Actor, type Identity, identityError } from "../identity/service.js";
import { selectQuality } from "../reconciliation/quality.js";
import { canonicalJson, contentHash, decimal, sourceKey } from "../sources/contracts/canonical.js";
import type {
  NormalizedTripEvidence,
  Provider,
  TripSourceAdapter,
} from "../sources/contracts/evidence.js";
import { manualAdapter } from "../sources/contracts/manual.js";
import { telemetryAdapter } from "../sources/contracts/telemetry.js";
import { createTripAdjudication } from "./adjudication.js";
import { createContributionRegister } from "./contributions.js";
import { createFactRepository, effectiveGameMode } from "./facts.js";
import { createTripGroups } from "./groups.js";
import {
  type ListOptions,
  normalizeListOptions,
  tripListCursor,
  tripListQuery,
  tripSearchCondition,
} from "./list-query.js";
import { createTripReconciliation } from "./reconciliation.js";

export { type ListOptions, type TripSource, tripListQuery, tripSources } from "./list-query.js";

type S = components["schemas"];
type Trip = typeof trips.$inferSelect;
type ManualRevisionSummary = { number: number; submittedAt: string; eventId?: string | null };
type ManualProjection = {
  manualRevision: S["ManualRevisionRead"] | null;
  evidence: S["Evidence"][];
  eventId?: string | null;
};
type SummaryRead = {
  manual: ReadonlyMap<string, ManualRevisionSummary>;
  privateViewer?: Actor;
};

export interface TripsConfig {
  cursorKey: string;
}
export function validateTripsConfig(config: TripsConfig) {
  if (!/^[0-9a-f]{64}$/.test(config.cursorKey)) throw new Error("INVALID_TRIPS_CONFIG");
}
export interface TripsPorts {
  prepare?: (tx: TxContext, ownerId: string, game: "ets2" | "ats") => Promise<void>;
  decisionProjection?: (tx: TxContext, id: string, actor: Actor) => Promise<S["TripPrivate"]>;
  correctionRequested?: (
    tx: TxContext,
    tripId: string,
    requestId: string,
    actor: Actor,
    reason: string,
  ) => Promise<void>;
  sourceStored?: (tx: TxContext, tripId: string, sourceRecordId: string) => Promise<void>;
  identity: Pick<
    Identity,
    "authorizeInTransaction" | "accessState" | "memberSummariesInTransaction"
  >;
  catalogs?: Pick<
    Catalogs,
    "resolveInTransaction" | "selectionsInTransaction" | "labelsInTransaction"
  > &
    Partial<Pick<Catalogs, "labelSearchCondition">>;
  eventTitles?: Events["tripTitlesInTransaction"];
  eventAssociations?: (tx: TxContext, tripIds: string[]) => Promise<Map<string, string>>;
  // VTC-025 supplies a caller-transaction check of immutable validated evidence references.
  manualEvidence?: (
    tx: TxContext,
    ownerId: string,
    payload: unknown,
    tripId: string,
  ) => Promise<void>;
  manualProjection?: (tx: TxContext, tripIds: string[]) => Promise<Map<string, ManualProjection>>;
  // Current manual revision metadata per canonical root, without evidence reads.
  manualRevisions?: (
    tx: TxContext,
    tripIds: string[],
  ) => Promise<Map<string, ManualRevisionSummary>>;
  events?: Pick<ReturnType<typeof createOutbox>, "append">;
}
export interface SourceContext {
  ownerUserId: string;
  connection: { state: "unknown" | "bound" | "disconnected"; referenceId: string | null };
  // Explicit trusted coordinator selection; never copied from source payloads or inferred.
  canonical?: { tripId: string; expectedVersion: number };
}
function tripCount(value: number | string) {
  const count = typeof value === "number" || /^(0|[1-9]\d*)$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(count) || count < 0) throw new Error("TRIP_COUNT_RANGE");
  return count;
}

function lifetimeTotals(
  accepted: number | string,
  distance: string | null,
): S["LifetimeTripTotals"] {
  if (
    distance !== null &&
    (typeof distance !== "string" || !/^(0|[1-9]\d*)(\.\d+)?$/.test(distance))
  )
    throw new Error("TRIP_DISTANCE_SUM_INVALID");
  const actualDistanceM = distance?.includes(".")
    ? distance.replace(/0+$/, "").replace(/\.$/, "")
    : (distance ?? "0");
  return { acceptedTrips: tripCount(accepted), actualDistanceM };
}

function differing(previous: NormalizedTripEvidence, next: NormalizedTripEvidence): string[] {
  const reasons: string[] = [];
  if (previous.outcome !== "open" && previous.outcome !== next.outcome)
    reasons.push(next.outcome === "open" ? "attempted_reopen" : "terminal_outcome_conflict");
  for (const field of [
    "origin",
    "destination",
    "cargo",
    "cargoMassKg",
    "plannedDistanceM",
    "adrCategory",
  ] as const) {
    const a = previous[field],
      b = next[field];
    if (a.status === "known" && b.status === "unknown") reasons.push(`${field}_became_unknown`);
    if (a.status === "known" && b.status === "known") {
      const left = typeof a.value === "object" ? a.value.entityId : a.value;
      const right = typeof b.value === "object" ? b.value.entityId : b.value;
      if (left !== right) reasons.push(`${field}_conflict`);
    }
  }
  if (previous.outcome !== "open") {
    for (const field of ["actualDistanceM", "deliveredDistanceM"] as const) {
      const a = previous[field],
        b = next[field];
      if (a.status === "known" && b.status === "unknown") reasons.push(`${field}_became_unknown`);
      if (a.status === "known" && b.status === "known" && a.value !== b.value)
        reasons.push(`${field}_conflict`);
    }
  }
  for (const field of ["start", "end"] as const) {
    if (!previous[field].verifiedActual) continue;
    if (!next[field].verifiedActual) reasons.push(`${field}_time_became_unverified`);
    else if (previous[field].utc !== next[field].utc) reasons.push(`${field}_time_conflict`);
  }
  const trailerIds = (f: NormalizedTripEvidence) =>
    f.trailers.items.map((item) => (item.status === "known" ? item.value.entityId : null));
  if (
    previous.trailers.complete &&
    previous.trailers.items.every((f) => f.status === "known") &&
    (!next.trailers.complete ||
      canonicalJson(trailerIds(previous)) !== canonicalJson(trailerIds(next)))
  )
    reasons.push("trailer_context_conflict");
  return reasons;
}
export function createTrips(
  unit: UnitOfWork,
  config: TripsConfig,
  ports: TripsPorts,
  now = () => new Date(),
) {
  validateTripsConfig(config);
  const c = (tx: TxContext) => unit.client(tx),
    at = () => now().toISOString();
  const outbox = ports.events ?? createOutbox(unit);
  const factsRepository = createFactRepository(unit),
    groups = createTripGroups(unit);
  const adapters = new Map<Provider, TripSourceAdapter>([
    ["ets2telemetry", telemetryAdapter],
    ["manual", manualAdapter],
  ]);
  const run = async <T>(fn: (tx: TxContext) => Promise<T>): Promise<T> => {
    try {
      return await retryTransaction(unit, fn);
    } catch (error) {
      if (
        unknownCommit(error) ||
        (error !== null &&
          typeof error === "object" &&
          "statusCode" in error &&
          typeof error.statusCode === "number")
      )
        throw error;
      // Match identity's known availability failures after bounded transaction retries.
      if (
        causes(error).some(
          (cause) =>
            ("code" in cause &&
              [
                "ER_LOCK_WAIT_TIMEOUT",
                "ER_CON_COUNT_ERROR",
                "ER_TOO_MANY_USER_CONNECTIONS",
                "PROTOCOL_SEQUENCE_TIMEOUT",
                "ETIMEDOUT",
                "ECONNRESET",
                "ECONNREFUSED",
                "PROTOCOL_CONNECTION_LOST",
                "EPIPE",
                "EAI_AGAIN",
                "ENETUNREACH",
                "EHOSTUNREACH",
              ].includes(String(cause.code))) ||
            (cause instanceof Error &&
              [
                "No connections available.",
                "Pool is closed.",
                "TRANSACTION_CONTROL_TIMEOUT",
              ].includes(cause.message)),
        )
      )
        throw identityError(503);
      throw error;
    }
  };
  async function authority(tx: TxContext, actor: Actor, review = false) {
    return ports.identity.authorizeInTransaction(
      tx,
      actor,
      review ? "trips.review" : "company.read",
    );
  }
  async function emit(
    tx: TxContext,
    type: TripEvent["type"],
    tripId: string,
    version: number,
    fact: NormalizedTripEvidence,
  ) {
    const eventId = newId(),
      source = type === "source.snapshot_stored";
    await outbox.append(tx, {
      eventId,
      type,
      schemaVersion: 1,
      aggregate: {
        kind: source ? "source" : "trip",
        id: source ? fact.sourceRecordId : tripId,
        version: source ? 1 : version,
      },
      occurredAt: at(),
      correlationId: eventId,
      causationId: null,
      data: { tripId, sourceRecordId: fact.sourceRecordId, factRevisionId: fact.factRevisionId },
    });
  }
  async function store(
    tx: TxContext,
    provider: Provider,
    payload: unknown,
    context: SourceContext,
    previousManualRevisionId?: string,
  ) {
    context = {
      ownerUserId: context.ownerUserId,
      connection: { state: context.connection.state, referenceId: context.connection.referenceId },
      ...(context.canonical
        ? {
            canonical: {
              tripId: context.canonical.tripId,
              expectedVersion: context.canonical.expectedVersion,
            },
          }
        : {}),
    };
    applicationId(context.ownerUserId);
    if (!["unknown", "bound", "disconnected"].includes(context.connection.state))
      throw identityError(422);
    if (context.connection.referenceId !== null) applicationId(context.connection.referenceId);
    if (context.canonical) {
      applicationId(context.canonical.tripId);
      if (
        !Number.isSafeInteger(context.canonical.expectedVersion) ||
        context.canonical.expectedVersion < 1
      )
        throw identityError(422);
    }
    const adapter = adapters.get(provider);
    if (!adapter) throw identityError(422);
    const content = canonicalJson(payload),
      hash = contentHash(content);
    const immutablePayload: unknown = JSON.parse(content);
    function freeze(value: unknown): void {
      if (!value || typeof value !== "object") return;
      for (const child of Object.values(value)) freeze(child);
      Object.freeze(value);
    }
    freeze(immutablePayload);
    const key = adapter.identity(immutablePayload);
    await ports.prepare?.(tx, context.ownerUserId, key.game);
    // Eligibility precedes any receipt lookup, including exact replays.
    const access = await ports.identity.accessState(tx, context.ownerUserId);
    if (!access.active || !access.canSubmitTrips) throw identityError(403);
    const [existing] = await c(tx)
      .select()
      .from(sourceTrips)
      .where(
        and(
          eq(sourceTrips.provider, provider),
          eq(sourceTrips.game, key.game),
          eq(sourceTrips.sessionKey, sourceKey(key.sessionKey)),
          eq(sourceTrips.tripKey, sourceKey(key.tripKey)),
        ),
      )
      .for("update");
    if (existing && existing.ownerId !== context.ownerUserId) throw identityError(409);
    if (
      existing &&
      context.canonical &&
      (await groups.resolve(tx, existing.canonicalTripId, true)).id !==
        (await groups.resolve(tx, context.canonical.tripId, true)).id
    )
      throw identityError(409);
    const [event] = await c(tx)
      .select()
      .from(sourceMessages)
      .where(
        and(
          eq(sourceMessages.provider, provider),
          eq(sourceMessages.eventKey, sourceKey(key.eventKey)),
        ),
      )
      .for("share");
    if (event) {
      if (!existing || event.sourceTripId !== existing.id || !event.sha256.equals(hash))
        throw identityError(409);
      return {
        tripId: (await groups.resolve(tx, existing.canonicalTripId, true)).id,
        sourceRecordId: event.id,
        firstReceivedAt: event.receivedAt,
        duplicate: true,
      };
    }
    const originalTripId = existing?.canonicalTripId ?? context.canonical?.tripId ?? newId(),
      tripId =
        existing || context.canonical
          ? (await groups.resolve(tx, originalTripId, true)).id
          : originalTripId,
      sourceTripId = existing?.id ?? newId();
    if (context.canonical) {
      const target = await groups.resolve(tx, context.canonical.tripId, true);
      if (!target || target.ownerId !== context.ownerUserId || target.game !== key.game)
        throw identityError(409);
      if (target.version !== context.canonical.expectedVersion)
        throw identityError(409, "VERSION_CONFLICT");
    }
    if (!existing) {
      if (!context.canonical)
        await c(tx).insert(trips).values({
          id: tripId,
          ownerId: context.ownerUserId,
          game: key.game,
          version: 1,
          outcome: "open",
          recording: "unknown",
          decision: "unassessed",
          reviewReasons: [],
          createdAt: at(),
        });
      await c(tx)
        .insert(sourceTrips)
        .values({
          id: sourceTripId,
          provider,
          game: key.game,
          sessionKey: sourceKey(key.sessionKey),
          tripKey: sourceKey(key.tripKey),
          ownerId: context.ownerUserId,
          canonicalTripId: originalTripId,
          latestRevision: "0",
          connectionContext: context.connection,
          createdAt: at(),
        });
    }
    const [trip] = await c(tx).select().from(trips).where(eq(trips.id, tripId)).for("update");
    if (!trip || trip.ownerId !== context.ownerUserId || trip.game !== key.game)
      throw identityError(409);
    if (provider === "manual") {
      if (!ports.manualEvidence) throw identityError(503);
      await ports.manualEvidence(tx, context.ownerUserId, immutablePayload, originalTripId);
    }
    let supersede = false;
    if (previousManualRevisionId) {
      if (provider !== "manual" || !existing || !context.canonical || trip.decision === "accepted")
        throw identityError(409);
      const [previousMessage] = await c(tx)
        .select()
        .from(sourceMessages)
        .where(
          and(
            eq(sourceMessages.sourceTripId, existing.id),
            eq(sourceMessages.eventKey, sourceKey(applicationId(previousManualRevisionId))),
          ),
        )
        .for("share");
      if (
        !previousMessage ||
        Number(previousMessage.revision) !== Number(existing.latestRevision) ||
        key.revision !== Number(existing.latestRevision) + 1
      )
        throw identityError(409, "VERSION_CONFLICT");
      if (trip.currentFactId) {
        const [currentManual] = await c(tx)
          .select({ id: tripFacts.id })
          .from(tripFacts)
          .where(
            and(eq(tripFacts.messageId, previousMessage.id), eq(tripFacts.id, trip.currentFactId)),
          )
          .for("share");
        supersede = !!currentManual;
      }
    }
    const [revision] = await c(tx)
      .select({ id: sourceMessages.id })
      .from(sourceMessages)
      .where(
        and(
          eq(sourceMessages.sourceTripId, sourceTripId),
          eq(sourceMessages.revision, String(key.revision)),
        ),
      )
      .for("share");
    if (revision) throw identityError(409);
    const messageId = newId(),
      factId = newId(),
      firstReceivedAt = at();
    const fact = await adapter.normalize(immutablePayload, {
      tx,
      ownerUserId: context.ownerUserId,
      sourceRecordId: messageId,
      factRevisionId: factId,
      ...(ports.catalogs ? { catalogs: ports.catalogs } : {}),
    });
    const current = trip.currentFactId
      ? (await factsRepository.read(tx, [trip.currentFactId], true)).get(trip.currentFactId)
      : undefined;
    if (
      trip.currentFactId &&
      (!current || !(await groups.contains(tx, trip.id, current.tripId, true)))
    )
      throw new Error("TRIP_FACT_POINTER_INVALID");
    const previous = current?.evidence;
    const newer = !existing || key.revision > Number(existing.latestRevision);
    const [lineage] =
      ports.sourceStored &&
      previous &&
      existing &&
      provider === "ets2telemetry" &&
      previous.outcome === "open" &&
      newer
        ? await c(tx)
            .select({ id: sourceMessages.id })
            .from(sourceMessages)
            .where(
              and(
                eq(sourceMessages.id, previous.sourceRecordId),
                eq(sourceMessages.sourceTripId, existing.id),
                eq(sourceMessages.revision, existing.latestRevision),
              ),
            )
            .for("share")
        : [];
    const quality =
      previous && !supersede
        ? selectQuality(
            [previous, fact],
            fact.factRevisionId,
            lineage
              ? { fromFactId: previous.factRevisionId, toFactId: fact.factRevisionId }
              : undefined,
          )
        : null;
    const conflicts =
      previous && !supersede && (newer || fact.outcome !== "open")
        ? [
            ...differing(previous, fact),
            ...(ports.sourceStored ? (quality?.reasons ?? []) : []),
            ...(ports.sourceStored && quality?.selected?.factRevisionId !== fact.factRevisionId
              ? ["quality_cannot_replace_supported_snapshot"]
              : []),
          ]
        : [];
    if (conflicts.length)
      fact.reasonCodes = [...new Set([...fact.reasonCodes, ...conflicts])].sort();
    await c(tx)
      .insert(sourceMessages)
      .values({
        id: messageId,
        sourceTripId,
        provider,
        eventKey: sourceKey(key.eventKey),
        revision: String(key.revision),
        sha256: hash,
        receivedAt: firstReceivedAt,
        deliveryMode: key.deliveryMode,
      });
    await c(tx).insert(sourcePayloads).values({ messageId, content });
    await factsRepository.insert(tx, originalTripId, fact, adapter.version);
    await emit(tx, "source.snapshot_stored", tripId, trip.version, fact);
    if (!newer && conflicts.length === 0) {
      await c(tx).update(trips).set({ assessmentPending: true }).where(eq(trips.id, tripId));
      if (provider !== "manual") await ports.sourceStored?.(tx, tripId, messageId);
      return { tripId, sourceRecordId: messageId, firstReceivedAt, duplicate: false };
    }
    if (newer)
      await c(tx)
        .update(sourceTrips)
        .set({ latestRevision: String(key.revision) })
        .where(eq(sourceTrips.id, sourceTripId));
    const confirmed =
      trip.decision === "accepted" || (trip.decision === "rejected" && provider !== "manual");
    const blocked = confirmed || conflicts.length > 0;
    const version = previous ? trip.version + 1 : trip.version;
    const reasons = [
      ...new Set([
        ...trip.reviewReasons,
        ...fact.reasonCodes,
        ...(confirmed ? ["confirmed_facts_require_review"] : []),
      ]),
    ].sort();
    const update = blocked
      ? {}
      : {
          currentFactId: factId,
          outcome: fact.outcome,
          recording: fact.recording,
          actualStart: fact.start.verifiedActual ? fact.start.utc : null,
          actualEnd: fact.end.verifiedActual ? fact.end.utc : null,
          actualDistanceM:
            fact.actualDistanceM.status === "known" ? fact.actualDistanceM.value : null,
          reportingAt:
            fact.provider === "ets2telemetry" && fact.end.verifiedActual ? fact.end.utc : null,
        };
    await c(tx)
      .update(trips)
      .set({
        ...update,
        version,
        assessmentPending: true,
        reviewReasons: reasons,
        reviewHold: trip.reviewHold || conflicts.length > 0 || confirmed,
        correctionPending: trip.correctionPending || confirmed,
      })
      .where(eq(trips.id, tripId));
    await c(tx)
      .insert(tripHistory)
      .values({
        id: newId(),
        tripId,
        version,
        factId,
        outcome: blocked ? trip.outcome : fact.outcome,
        reasons,
        createdAt: at(),
      });
    await emit(
      tx,
      !blocked && (!previous || previous.outcome !== fact.outcome)
        ? "trip.lifecycle_changed"
        : "trip.facts_changed",
      tripId,
      version,
      fact,
    );
    if (provider !== "manual") await ports.sourceStored?.(tx, tripId, messageId);
    return {
      tripId: (await groups.resolve(tx, tripId, true)).id,
      sourceRecordId: messageId,
      firstReceivedAt,
      duplicate: false,
    };
  }
  async function summaries(
    tx: TxContext,
    rows: Trip[],
    locale: "en" | "ru",
    read?: SummaryRead,
  ): Promise<S["TripSummary"][]> {
    if (!rows.length) return [];
    const ids = rows.map((row) => row.id);
    const members = await ports.identity.memberSummariesInTransaction(
      tx,
      rows.map((row) => row.ownerId),
    );
    const facts = await factsRepository.read(
      tx,
      rows.flatMap((row) => (row.currentFactId ? [row.currentFactId] : [])),
      true,
    );
    const membership = await groups.membersOfRoots(tx, ids, "share");
    const sources = await c(tx)
      .select({ tripId: sourceTrips.canonicalTripId, provider: sourceTrips.provider })
      .from(sourceTrips)
      .where(
        inArray(
          sourceTrips.canonicalTripId,
          membership.map((row) => row.id),
        ),
      )
      .for("share");
    let labels = new Map<string, S["CatalogLabel"]>();
    if (ports.catalogs) {
      const refs: { kind: "city" | "cargo"; id: string }[] = [];
      for (const saved of facts.values()) {
        const f = saved.evidence;
        for (const [kind, value] of [
          ["city", f.origin],
          ["city", f.destination],
          ["cargo", f.cargo],
        ] as const)
          if (value.status === "known") refs.push({ kind, id: value.value.entityId });
      }
      labels = await ports.catalogs.labelsInTransaction(tx, refs, locale);
    }
    const factMembers = new Map(membership.map((row) => [row.id, row.aliasOf ?? row.id]));
    const associations = new Map<string, string>();
    const privateViewer = read?.privateViewer;
    let events: Awaited<ReturnType<Events["tripTitlesInTransaction"]>> | undefined;
    if (privateViewer && ports.eventTitles) {
      const saved = await ports.eventAssociations?.(tx, ids);
      for (const id of ids) {
        const eventId = saved?.get(id) ?? read.manual.get(id)?.eventId;
        if (eventId) associations.set(id, eventId);
      }
      if (associations.size)
        events = await ports.eventTitles(tx, [...new Set(associations.values())], privateViewer);
    }
    return rows.map((row) => {
      const owner = members.get(row.ownerId);
      if (!owner) throw new Error("TRIP_OWNER_MISSING");
      const saved = row.currentFactId ? facts.get(row.currentFactId) : undefined;
      if (row.currentFactId && (!saved || factMembers.get(saved.tripId) !== row.id))
        throw new Error("TRIP_FACT_POINTER_INVALID");
      const f = saved?.evidence;
      const eventId = associations.get(row.id);
      const event = eventId ? events?.get(eventId) : undefined;
      const label = (value: NormalizedTripEvidence["origin"] | undefined) =>
        value?.status === "known" ? (labels.get(value.value.entityId) ?? null) : null;
      return {
        view: "summary",
        id: row.id,
        version: row.version,
        owner,
        game: row.game,
        outcome: row.outcome,
        decision: row.decision,
        origin: label(f?.origin),
        destination: label(f?.destination),
        cargo: label(f?.cargo),
        actualDistanceM: row.actualDistanceM === null ? null : decimal(row.actualDistanceM),
        reportingAt: row.reportingAt,
        recording: row.recording,
        reportingBasis: !row.reportingAt
          ? "unknown"
          : f?.provider === "manual"
            ? "manual_confirmation"
            : f?.end.verifiedActual && f.end.utc === row.reportingAt
              ? "actual_completion"
              : "unknown",
        sourceKinds: [
          ...new Set(
            sources.filter((s) => factMembers.get(s.tripId) === row.id).map((s) => s.provider),
          ),
        ],
        ...(read && {
          number: row.number,
          createdAt: row.createdAt,
          submittedAt: read.manual.get(row.id)?.submittedAt ?? null,
        }),
        ...(privateViewer && {
          event: event?.game === row.game ? { id: event.id, title: event.title } : null,
          gameMode: effectiveGameMode(f),
        }),
      };
    });
  }
  async function manualMetadata(tx: TxContext, ids: string[]) {
    return (ids.length ? await ports.manualRevisions?.(tx, ids) : undefined) ?? new Map();
  }
  function projectedRevision(
    id: string,
    revision: S["ManualRevisionRead"],
    eventId = revision.fields.eventId ?? null,
  ) {
    return new Map([
      [
        id,
        {
          number: revision.number,
          submittedAt: revision.submittedAt,
          eventId,
        },
      ],
    ]);
  }
  return {
    config,
    groups,
    adjudication: createTripAdjudication(unit, ports.catalogs),
    reconciliation: createTripReconciliation(unit, now),
    prepareSourceInTransaction: async (tx: TxContext, owner: string, game: "ets2" | "ats") => {
      await ports.prepare?.(tx, owner, game);
    },
    manualStoredInTransaction: async (tx: TxContext, id: string, sourceRecordId: string) => {
      await ports.sourceStored?.(tx, id, sourceRecordId);
    },
    async correctionRequestedInTransaction(
      tx: TxContext,
      id: string,
      requestId: string,
      actor: Actor,
      reason: string,
    ) {
      await ports.correctionRequested?.(tx, id, requestId, actor, reason);
    },
    async summaryInTransaction(tx: TxContext, tripId: string, locale: "en" | "ru") {
      const row = await groups.resolve(tx, tripId, "share");
      if (!row) throw identityError(404);
      const [result] = await summaries(tx, [row], locale);
      if (!result) throw new Error("TRIP_SUMMARY_MISSING");
      return result;
    },
    async privateSummaryInTransaction(
      tx: TxContext,
      id: string,
      actor: Actor,
      projection?: Pick<ManualProjection, "manualRevision" | "eventId">,
    ) {
      const current = await authority(tx, actor);
      const row = await groups.resolve(tx, id, "share");
      if (row.ownerId !== current.userId && !current.capabilities.includes("trips.review"))
        throw identityError(404);
      const manual = projection?.manualRevision
        ? projectedRevision(row.id, projection.manualRevision, projection.eventId)
        : await manualMetadata(tx, [row.id]);
      const [result] = await summaries(tx, [row], current.locale, {
        manual,
        privateViewer: current,
      });
      if (!result) throw new Error("TRIP_SUMMARY_MISSING");
      return result;
    },
    async effectiveFactsInTransaction(tx: TxContext, id: string) {
      const row = await groups.resolve(tx, id, "share");
      const saved = row.currentFactId
        ? (await factsRepository.read(tx, [row.currentFactId], true)).get(row.currentFactId)
        : undefined;
      if (saved && !(await groups.contains(tx, row.id, saved.tripId, true)))
        throw new Error("TRIP_FACT_POINTER_INVALID");
      return saved ? factsRepository.projectEffective(tx, saved.evidence) : null;
    },
    contributions: createContributionRegister(unit),
    // Caller owns binding/token validation and the outer transaction/ACK, not the payload.
    storeInTransaction: store,
    async reserveManualInTransaction(tx: TxContext, ownerId: string, game: "ets2" | "ats") {
      await ports.prepare?.(tx, ownerId, game);
      const access = await ports.identity.accessState(tx, ownerId);
      if (!access.active || !access.canSubmitTrips) throw identityError(403);
      const id = newId();
      await c(tx).insert(trips).values({
        id,
        ownerId,
        game,
        version: 1,
        outcome: "open",
        recording: "unknown",
        decision: "unassessed",
        reviewReasons: [],
        createdAt: at(),
      });
      return id;
    },
    async manualGateInTransaction(
      tx: TxContext,
      ownerId: string,
      tripId: string,
      expectedVersion?: number,
      telemetry = false,
    ) {
      const row = await groups.resolve(tx, tripId, true);
      if (!row || row.ownerId !== ownerId) throw identityError(404);
      if (expectedVersion !== undefined && row.version !== expectedVersion)
        throw identityError(409, "VERSION_CONFLICT");
      if (telemetry) {
        const [source] = await c(tx)
          .select({ id: sourceTrips.id })
          .from(sourceTrips)
          .where(
            and(
              inArray(
                sourceTrips.canonicalTripId,
                (await groups.members(tx, [row.id], true)).map((t) => t.id),
              ),
              eq(sourceTrips.provider, "ets2telemetry"),
            ),
          )
          .for("share");
        if (!source) throw identityError(409);
      }
      return { ...row, id: tripId };
    },
    async statesInTransaction(tx: TxContext, tripIds: string[], lock: boolean | "share" = false) {
      const ids = [...new Set(tripIds)].sort(),
        rows: Trip[] = [];
      // Every batch follows the same total order before evidence is locked.
      for (let start = 0; start < ids.length; start += 100) {
        const query = c(tx)
          .select()
          .from(trips)
          .where(inArray(trips.id, ids.slice(start, start + 100)))
          .orderBy(trips.id);
        rows.push(...(await (lock ? query.for(lock === "share" ? "share" : "update") : query)));
      }
      const roots = new Map(
        (await groups.members(tx, ids, lock)).filter((t) => !t.aliasOf).map((t) => [t.id, t]),
      );
      return rows.map((row) => ({
        ...(roots.get(row.aliasOf ?? row.id) ?? row),
        id: row.id,
        aliasOf: row.aliasOf,
      }));
    },
    async manualPendingInTransaction(tx: TxContext, tripId: string, correction = false) {
      const row = await groups.resolve(tx, tripId, true);
      tripId = row.id;
      if (!row) throw identityError(404);
      if (
        (correction && row.decision !== "accepted") ||
        (!correction && row.decision === "accepted")
      )
        throw identityError(409);
      await c(tx)
        .update(trips)
        .set({
          reviewHold: true,
          ...(correction
            ? { correctionPending: true, version: row.version + 1 }
            : { decision: "pending_review" as const }),
        })
        .where(eq(trips.id, tripId));
      return correction ? row.version + 1 : row.version;
    },
    supersedeManualInTransaction(
      tx: TxContext,
      payload: unknown,
      context: SourceContext,
      previousRevisionId: string,
    ) {
      return store(tx, "manual", payload, context, applicationId(previousRevisionId));
    },
    async eventContextInTransaction(tx: TxContext, sourceRecordId: string) {
      const [row] = await c(tx)
        .select({
          receivedAt: sourceMessages.receivedAt,
          deliveryMode: sourceMessages.deliveryMode,
          factId: tripFacts.id,
          tripId: tripFacts.canonicalTripId,
        })
        .from(sourceMessages)
        .innerJoin(tripFacts, eq(tripFacts.messageId, sourceMessages.id))
        .where(eq(sourceMessages.id, applicationId(sourceRecordId)));
      if (!row) return null;
      const facts = (await factsRepository.read(tx, [row.factId])).get(row.factId)?.evidence;
      if (!facts) throw new Error("SOURCE_FACT_MISSING");
      return {
        factRevisionId: row.factId,
        provider: facts.provider,
        ownerId: facts.ownerUserId,
        game: facts.game,
        tripId: (await groups.resolve(tx, row.tripId)).id,
        receivedAt: row.receivedAt,
        deliveryMode: row.deliveryMode,
        start: facts.start,
        end: facts.end,
        outcome: facts.outcome,
      };
    },
    async notificationStateInTransaction(tx: TxContext, id: string) {
      const root = await groups.resolve(tx, applicationId(id), "share");
      return {
        id: root.id,
        ownerId: root.ownerId,
        game: root.game,
        version: root.version,
        outcome: root.outcome,
        decision: root.decision,
        groupIds: (await groups.members(tx, [root.id], "share")).map((row) => row.id),
      };
    },
    async notificationTargetsInTransaction(
      tx: TxContext,
      ids: string[],
      viewer: { userId: string; capabilities: readonly string[] },
    ) {
      if (ids.length > 100) throw new Error("NOTIFICATION_TARGET_BOUND_EXCEEDED");
      const result = new Map<
        string,
        { target: string | null; outcome: string; canonicalId: string; decision: string }
      >();
      for (const id of [...new Set(ids)].sort()) {
        const r = await groups.resolve(tx, id, "share");
        result.set(id, {
          outcome: r.outcome,
          canonicalId: r.id,
          decision: r.decision,
          target:
            r.decision === "accepted" ||
            r.ownerId === viewer.userId ||
            viewer.capabilities.includes("trips.review")
              ? r.id
              : null,
        });
      }
      return result;
    },
    async sourceEvidenceInTransaction(tx: TxContext, sourceRecordId: string) {
      const [row] = await c(tx)
        .select({ id: tripFacts.id })
        .from(tripFacts)
        .where(eq(tripFacts.messageId, applicationId(sourceRecordId)));
      return row
        ? ((await factsRepository.read(tx, [row.id])).get(row.id)?.evidence ?? null)
        : null;
    },
    async list(actor: Actor, input: ListOptions = {}): Promise<S["ListTripSummary"]> {
      const options = normalizeListOptions(input);
      const { scope, limit } = options;
      return run(async (tx) => {
        // Identity takes the company lock before the first snapshot read. Canonical-group
        // writers hold the same lock, so subsequent shared projection reads see those roots.
        const current = await authority(tx, actor, scope === "review");
        const locale = options.locale ?? current.locale;
        const cursor = tripListCursor(config.cursorKey, current, options, locale);
        const after = cursor.read();
        const labelSearchCondition = ports.catalogs?.labelSearchCondition;
        const query = tripListQuery(c(tx), {
          ...options,
          viewerId: current.userId,
          searchCondition: tripSearchCondition(
            unit,
            tx,
            labelSearchCondition,
            options.search,
            locale,
          ),
          after,
        });
        let total: number | undefined;
        if (scope !== "review") {
          const [count] = await c(tx)
            .select({ total: sql<string>`COUNT(*)` })
            .from(trips)
            .where(query.filtered);
          if (!count) throw new Error("TRIP_LIST_COUNT_MISSING");
          total = tripCount(count.total);
        }
        const rows = await c(tx)
          .select()
          .from(trips)
          .where(query.where)
          .orderBy(...query.orderBy)
          .limit(limit + 1);
        const page = rows.slice(0, limit);
        const last = page.at(-1);
        const nextCursor = rows.length > limit && last ? cursor.write(last) : null;
        const manual = await manualMetadata(
          tx,
          page.map((row) => row.id),
        );
        const items = await summaries(tx, page, locale, {
          manual,
          ...(scope !== "company" && { privateViewer: current }),
        });
        if (total !== undefined) return { items, nextCursor, total };
        return {
          items: items.map((item, index) => {
            const row = page[index] as Trip;
            const revision = manual.get(row.id);
            return {
              ...item,
              review: {
                hold: row.reviewHold,
                reasonCodes: row.reviewReasons,
                createdAt: row.createdAt,
                manualRevision: revision
                  ? { number: revision.number, submittedAt: revision.submittedAt }
                  : null,
              },
            };
          }),
          nextCursor,
        };
      });
    },
    async detail(actor: Actor, tripId: string): Promise<S["TripView"]> {
      applicationId(tripId);
      return run(async (tx) => {
        const current = await authority(tx, actor);
        const row = await groups.resolve(tx, tripId);
        const privateRead =
          row && (row.ownerId === actor.userId || current.capabilities.includes("trips.review"));
        if (!row || (!privateRead && row.decision !== "accepted")) throw identityError(404);
        if (privateRead && ports.decisionProjection)
          return ports.decisionProjection(tx, row.id, actor);
        const projection = privateRead
          ? (await ports.manualProjection?.(tx, [row.id]))?.get(row.id)
          : undefined;
        const manual = projection?.manualRevision
          ? projectedRevision(row.id, projection.manualRevision, projection.eventId)
          : await manualMetadata(tx, [row.id]);
        const [summary] = await summaries(tx, [row], current.locale, {
          manual,
          ...(privateRead && { privateViewer: current }),
        });
        if (!summary) throw new Error("TRIP_SUMMARY_MISSING");
        // summaries already checked the selected fact against the locked group membership.
        const savedFact =
          privateRead && row.currentFactId
            ? (await factsRepository.read(tx, [row.currentFactId], true)).get(row.currentFactId)
            : undefined;
        return privateRead
          ? {
              view: "private",
              summary,
              effectiveFacts: savedFact
                ? await factsRepository.projectEffective(tx, savedFact.evidence)
                : null,
              manualRevision: projection?.manualRevision ?? null,
              evidence: projection?.evidence ?? [],
              decisions: [],
              pendingProposalId: null,
              reviewReasonCodes: row.reviewReasons,
            }
          : summary;
      });
    },
    async eventAttendanceRootsInTransaction(
      tx: TxContext,
      actor: Actor,
      game: Trip["game"],
      memberIds: string[],
    ) {
      if (!memberIds.length || memberIds.length > 100)
        throw new Error("EVENT_TRIP_MEMBER_BOUND_EXCEEDED");
      // Attendance is a leadership view. Confirm current private-trip visibility
      // in the same transaction before making any canonical IDs available.
      await authority(tx, actor, true);
      return c(tx)
        .select({ tripId: trips.id, ownerId: trips.ownerId })
        .from(trips)
        .where(
          and(
            isNull(trips.aliasOf),
            eq(trips.game, game),
            inArray(trips.ownerId, memberIds.map(applicationId)),
          ),
        )
        .as("event_attendance_roots");
    },
    async lifetimeTotalsInTransaction(
      tx: TxContext,
      ownerId: string,
    ): Promise<S["LifetimeTripTotals"]> {
      const [row] = await c(tx)
        .select({
          accepted: sql<string>`COUNT(*)`,
          distance: sql<string | null>`SUM(${trips.actualDistanceM})`,
        })
        .from(trips)
        .where(
          and(
            isNull(trips.aliasOf),
            eq(trips.ownerId, applicationId(ownerId)),
            eq(trips.decision, "accepted"),
          ),
        );
      if (!row) throw new Error("TRIP_LIFETIME_TOTALS_MISSING");
      return lifetimeTotals(row.accepted, row.distance);
    },
    async status(actor: Actor, game?: "ets2" | "ats"): Promise<S["OwnTripStatusSummary"]> {
      return run(async (tx) => {
        await authority(tx, actor);
        const [row] = await c(tx)
          .select({
            unassessed: sql<string>`COALESCE(SUM(${trips.decision} = 'unassessed'),0)`,
            pendingReview: sql<string>`COALESCE(SUM(${trips.decision} = 'pending_review'),0)`,
            accepted: sql<string>`COALESCE(SUM(${trips.decision} = 'accepted'),0)`,
            rejected: sql<string>`COALESCE(SUM(${trips.decision} = 'rejected'),0)`,
            activeTrips: sql<string>`COALESCE(SUM(${trips.outcome} = 'open'),0)`,
            correctionPending: sql<string>`COALESCE(SUM(${trips.correctionPending}),0)`,
            acceptedDistance: sql<
              string | null
            >`SUM(CASE WHEN ${trips.decision} = 'accepted' THEN ${trips.actualDistanceM} END)`,
          })
          .from(trips)
          .where(
            and(
              isNull(trips.aliasOf),
              eq(trips.ownerId, actor.userId),
              game ? eq(trips.game, game) : undefined,
            ),
          );
        if (!row) throw new Error("TRIP_STATUS_MISSING");
        const totals = lifetimeTotals(row.accepted, row.acceptedDistance);
        return {
          counts: {
            unassessed: tripCount(row.unassessed),
            pendingReview: tripCount(row.pendingReview),
            accepted: totals.acceptedTrips,
            rejected: tripCount(row.rejected),
          },
          activeTrips: tripCount(row.activeTrips),
          correctionPending: tripCount(row.correctionPending),
          lifetimeTotals: totals,
        };
      });
    },
    // Internal retention policy/hold operations are caller-transaction primitives, never HTTP jobs.
    async retentionPolicyInTransaction(
      tx: TxContext,
      messageId: string,
      policy: { reviewedPolicyReference: string; eligibleAt: string | null; hold: boolean },
    ) {
      if (
        !/^[a-z0-9][a-z0-9._/-]{0,127}$/.test(policy.reviewedPolicyReference) ||
        typeof policy.hold !== "boolean"
      )
        throw new Error("INVALID_REVIEWED_RETENTION_POLICY");
      const [link] = await c(tx)
        .select({
          tripId: sourceTrips.canonicalTripId,
          ownerId: sourceTrips.ownerId,
          game: sourceTrips.game,
        })
        .from(sourceMessages)
        .innerJoin(sourceTrips, eq(sourceTrips.id, sourceMessages.sourceTripId))
        .where(eq(sourceMessages.id, applicationId(messageId)));
      if (!link) throw identityError(404);
      await ports.prepare?.(tx, link.ownerId, link.game);
      await c(tx)
        .select({ id: trips.id })
        .from(trips)
        .where(eq(trips.id, (await groups.resolve(tx, link.tripId, true)).id))
        .for("update");
      const [message] = await c(tx)
        .select()
        .from(sourceMessages)
        .where(eq(sourceMessages.id, messageId));
      if (message?.provider !== "ets2telemetry") throw new Error("MANUAL_RETENTION_OUT_OF_SCOPE");
      await c(tx)
        .update(sourcePayloads)
        .set({
          eligibleAt: policy.eligibleAt === null ? null : utcIso(utcDateTime(policy.eligibleAt)),
          policyReference: policy.reviewedPolicyReference,
          hold: policy.hold,
        })
        .where(eq(sourcePayloads.messageId, messageId));
    },
    async expirePayloadInTransaction(tx: TxContext, messageId: string) {
      const [link] = await c(tx)
        .select({
          tripId: sourceTrips.canonicalTripId,
          provider: sourceMessages.provider,
          ownerId: sourceTrips.ownerId,
          game: sourceTrips.game,
        })
        .from(sourceMessages)
        .innerJoin(sourceTrips, eq(sourceTrips.id, sourceMessages.sourceTripId))
        .where(eq(sourceMessages.id, applicationId(messageId)));
      if (link?.provider !== "ets2telemetry") return false;
      await ports.prepare?.(tx, link.ownerId, link.game);
      const [trip] = await c(tx)
        .select()
        .from(trips)
        .where(eq(trips.id, (await groups.resolve(tx, link.tripId, true)).id))
        .for("update");
      const [payload] = await c(tx)
        .select()
        .from(sourcePayloads)
        .where(eq(sourcePayloads.messageId, messageId))
        .for("update");
      if (
        !trip ||
        trip.reviewHold ||
        trip.decision === "pending_review" ||
        trip.correctionPending ||
        !payload?.content ||
        payload.hold ||
        payload.eligibleAt === null ||
        payload.eligibleAt > at() ||
        !payload.policyReference
      )
        return false;
      await c(tx)
        .update(sourcePayloads)
        .set({ content: null, expiredAt: at() })
        .where(eq(sourcePayloads.messageId, messageId));
      return true;
    },
  };
}
export type Trips = ReturnType<typeof createTrips>;
