import { createHmac, timingSafeEqual } from "node:crypto";
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
  desc,
  eq,
  inArray,
  lt,
  or,
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
import { type Actor, type Identity, identityError } from "../identity/service.js";
import { canonicalJson, contentHash, decimal, sourceKey } from "../sources/contracts/canonical.js";
import type {
  NormalizedTripEvidence,
  Provider,
  TripSourceAdapter,
} from "../sources/contracts/evidence.js";
import { manualAdapter } from "../sources/contracts/manual.js";
import { telemetryAdapter } from "../sources/contracts/telemetry.js";
import { createFactRepository } from "./facts.js";
import { createContributionRegister } from "./contributions.js";

type S = components["schemas"];
type Trip = typeof trips.$inferSelect;
export interface TripsConfig {
  cursorKey: string;
}
export function validateTripsConfig(config: TripsConfig) {
  if (!/^[0-9a-f]{64}$/.test(config.cursorKey)) throw new Error("INVALID_TRIPS_CONFIG");
}
export interface TripsPorts {
  identity: Pick<
    Identity,
    "authorizeInTransaction" | "accessState" | "memberSummariesInTransaction"
  >;
  catalogs?: Pick<
    Catalogs,
    | "publishedInTransaction"
    | "resolveInTransaction"
    | "pinnedInTransaction"
    | "labelsInTransaction"
  >;
  // VTC-025 supplies a caller-transaction check of immutable validated evidence references.
  manualEvidence?: (
    tx: TxContext,
    ownerId: string,
    payload: unknown,
    tripId: string,
  ) => Promise<void>;
  manualProjection?: (
    tx: TxContext,
    tripIds: string[],
  ) => Promise<
    Map<string, { manualRevision: S["ManualRevisionRead"] | null; evidence: S["Evidence"][] }>
  >;
  events?: ReturnType<typeof createOutbox>;
}
export interface SourceContext {
  ownerUserId: string;
  connection: { state: "unknown" | "bound" | "disconnected"; referenceId: string | null };
  // Explicit trusted coordinator selection; never copied from source payloads or inferred.
  canonical?: { tripId: string; expectedVersion: number };
}
export interface ListOptions {
  scope?: "company" | "mine" | "review";
  game?: "ets2" | "ats";
  decision?: Trip["decision"];
  cursor?: string;
  limit?: number;
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
  const factsRepository = createFactRepository(unit);
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
    if (existing && context.canonical && existing.canonicalTripId !== context.canonical.tripId)
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
        tripId: existing.canonicalTripId,
        sourceRecordId: event.id,
        firstReceivedAt: event.receivedAt,
        duplicate: true,
      };
    }
    const tripId = existing?.canonicalTripId ?? context.canonical?.tripId ?? newId(),
      sourceTripId = existing?.id ?? newId();
    if (context.canonical) {
      const [target] = await c(tx)
        .select()
        .from(trips)
        .where(eq(trips.id, context.canonical.tripId))
        .for("update");
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
          canonicalTripId: tripId,
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
      await ports.manualEvidence(tx, context.ownerUserId, immutablePayload, tripId);
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
    if (trip.currentFactId && (!current || current.tripId !== trip.id))
      throw new Error("TRIP_FACT_POINTER_INVALID");
    const previous = current?.evidence;
    const newer = !existing || key.revision > Number(existing.latestRevision);
    const conflicts =
      previous && !supersede && (newer || fact.outcome !== "open") ? differing(previous, fact) : [];
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
    await factsRepository.insert(
      tx,
      tripId,
      fact,
      adapter.versionFor?.(immutablePayload) ?? adapter.version,
    );
    await emit(tx, "source.snapshot_stored", tripId, trip.version, fact);
    if (!newer && conflicts.length === 0)
      return { tripId, sourceRecordId: messageId, firstReceivedAt, duplicate: false };
    if (newer)
      await c(tx)
        .update(sourceTrips)
        .set({ latestRevision: String(key.revision) })
        .where(eq(sourceTrips.id, sourceTripId));
    const confirmed = trip.decision === "accepted";
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
    return { tripId, sourceRecordId: messageId, firstReceivedAt, duplicate: false };
  }
  async function summaries(
    tx: TxContext,
    rows: Trip[],
    locale: "en" | "ru",
  ): Promise<S["TripSummary"][]> {
    const members = await ports.identity.memberSummariesInTransaction(
      tx,
      rows.map((row) => row.ownerId),
    );
    if (!rows.length) return [];
    const facts = await factsRepository.read(
      tx,
      rows.flatMap((row) => (row.currentFactId ? [row.currentFactId] : [])),
    );
    const sources = await c(tx)
      .select({ tripId: sourceTrips.canonicalTripId, provider: sourceTrips.provider })
      .from(sourceTrips)
      .where(
        inArray(
          sourceTrips.canonicalTripId,
          rows.map((row) => row.id),
        ),
      );
    let labels = new Map<string, S["CatalogLabel"]>();
    if (ports.catalogs) {
      const pins = new Map<string, { revisionId: string; entityId: string }>();
      for (const saved of facts.values()) {
        const f = saved.evidence;
        for (const value of [f.origin, f.destination, f.cargo])
          if (value.status === "known") {
            pins.set(`${value.value.catalogRevisionId}:${value.value.entityId}`, {
              revisionId: value.value.catalogRevisionId,
              entityId: value.value.entityId,
            });
          }
      }
      labels = await ports.catalogs.labelsInTransaction(tx, [...pins.values()], locale);
    }
    return rows.map((row) => {
      const owner = members.get(row.ownerId);
      if (!owner) throw new Error("TRIP_OWNER_MISSING");
      const saved = row.currentFactId ? facts.get(row.currentFactId) : undefined;
      if (row.currentFactId && (!saved || saved.tripId !== row.id))
        throw new Error("TRIP_FACT_POINTER_INVALID");
      const f = saved?.evidence;
      const label = (value: NormalizedTripEvidence["origin"] | undefined) =>
        value?.status === "known"
          ? (labels.get(`${value.value.catalogRevisionId}:${value.value.entityId}`) ?? null)
          : null;
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
        sourceKinds: [
          ...new Set(sources.filter((s) => s.tripId === row.id).map((s) => s.provider)),
        ],
      };
    });
  }
  function signature(value: string) {
    return createHmac("sha256", Buffer.from(config.cursorKey, "hex"))
      .update("trips/cursor/v1\0")
      .update(value)
      .digest();
  }
  function cursorBinding(actor: Actor, options: ListOptions) {
    return [
      actor.userId,
      actor.sessionId,
      actor.accessEpoch,
      options.scope ?? "company",
      options.game ?? null,
      options.decision ?? null,
      "createdAt/id:desc",
    ];
  }
  function readCursor(
    actor: Actor,
    options: ListOptions,
  ): { createdAt: string; id: string } | null {
    if (!options.cursor) return null;
    try {
      if (options.cursor.length > 2048) throw new Error();
      const [body = "", mac = "", extra] = options.cursor.split(".");
      if (!/^[A-Za-z0-9_-]+$/.test(body) || !/^[A-Za-z0-9_-]{43}$/.test(mac)) throw new Error();
      const actual = Buffer.from(mac, "base64url"),
        expected = signature(body);
      if (
        extra !== undefined ||
        actual.toString("base64url") !== mac ||
        Buffer.from(body, "base64url").toString("base64url") !== body ||
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      )
        throw new Error();
      const parsed = JSON.parse(Buffer.from(body, "base64url").toString()) as {
        binding: unknown;
        createdAt: string;
        id: string;
      };
      if (canonicalJson(parsed.binding) !== canonicalJson(cursorBinding(actor, options)))
        throw new Error();
      applicationId(parsed.id);
      utcDateTime(parsed.createdAt);
      return parsed;
    } catch {
      throw identityError(409, "VERSION_CONFLICT");
    }
  }
  return {
    config,
    async summaryInTransaction(tx: TxContext, tripId: string, locale: "en" | "ru") {
      const [row] = await c(tx)
        .select()
        .from(trips)
        .where(eq(trips.id, applicationId(tripId)));
      if (!row) throw identityError(404);
      const [result] = await summaries(tx, [row], locale);
      if (!result) throw new Error("TRIP_SUMMARY_MISSING");
      return result;
    },
    contributions: createContributionRegister(unit),
    // Caller owns binding/token validation and the outer transaction/ACK, not the payload.
    storeInTransaction: store,
    async reserveManualInTransaction(tx: TxContext, ownerId: string, game: "ets2" | "ats") {
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
      const [row] = await c(tx)
        .select()
        .from(trips)
        .where(eq(trips.id, applicationId(tripId)))
        .for("update");
      if (!row || row.ownerId !== ownerId) throw identityError(404);
      if (expectedVersion !== undefined && row.version !== expectedVersion)
        throw identityError(409, "VERSION_CONFLICT");
      if (telemetry) {
        const [source] = await c(tx)
          .select({ id: sourceTrips.id })
          .from(sourceTrips)
          .where(
            and(eq(sourceTrips.canonicalTripId, tripId), eq(sourceTrips.provider, "ets2telemetry")),
          )
          .for("share");
        if (!source) throw identityError(409);
      }
      return row;
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
      return rows;
    },
    async manualPendingInTransaction(tx: TxContext, tripId: string, correction = false) {
      const [row] = await c(tx).select().from(trips).where(eq(trips.id, tripId)).for("update");
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
        tripId: row.tripId,
        receivedAt: row.receivedAt,
        deliveryMode: row.deliveryMode,
        start: facts.start,
        end: facts.end,
        outcome: facts.outcome,
      };
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
    async list(actor: Actor, options: ListOptions = {}) {
      const limit = options.limit ?? 25,
        scope = options.scope ?? "company";
      if (
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 100 ||
        !["company", "mine", "review"].includes(scope)
      )
        throw identityError(422);
      return run(async (tx) => {
        const current = await authority(tx, actor, scope === "review");
        const after = readCursor(actor, options);
        const rows = await c(tx)
          .select()
          .from(trips)
          .where(
            and(
              scope === "company"
                ? eq(trips.decision, "accepted")
                : scope === "mine"
                  ? eq(trips.ownerId, actor.userId)
                  : undefined,
              options.game ? eq(trips.game, options.game) : undefined,
              options.decision ? eq(trips.decision, options.decision) : undefined,
              after
                ? or(
                    lt(trips.createdAt, after.createdAt),
                    and(eq(trips.createdAt, after.createdAt), lt(trips.id, after.id)),
                  )
                : undefined,
            ),
          )
          .orderBy(desc(trips.createdAt), desc(trips.id))
          .limit(limit + 1);
        const page = rows.slice(0, limit),
          last = page.at(-1);
        let nextCursor: string | null = null;
        if (rows.length > limit && last) {
          const body = Buffer.from(
            JSON.stringify({
              binding: cursorBinding(actor, options),
              createdAt: last.createdAt,
              id: last.id,
            }),
          ).toString("base64url");
          nextCursor = `${body}.${signature(body).toString("base64url")}`;
        }
        return { items: await summaries(tx, page, current.locale), nextCursor };
      });
    },
    async detail(actor: Actor, tripId: string): Promise<S["TripView"]> {
      applicationId(tripId);
      return run(async (tx) => {
        const current = await authority(tx, actor);
        const [row] = await c(tx).select().from(trips).where(eq(trips.id, tripId));
        const privateRead =
          row && (row.ownerId === actor.userId || current.capabilities.includes("trips.review"));
        if (!row || (!privateRead && row.decision !== "accepted")) throw identityError(404);
        const [summary] = await summaries(tx, [row], current.locale);
        if (!summary) throw new Error("TRIP_SUMMARY_MISSING");
        const projection = privateRead
          ? (await ports.manualProjection?.(tx, [row.id]))?.get(row.id)
          : undefined;
        return privateRead
          ? {
              view: "private",
              summary,
              manualRevision: projection?.manualRevision ?? null,
              evidence: projection?.evidence ?? [],
              decisions: [],
              pendingProposalId: null,
              reviewReasonCodes: row.reviewReasons,
            }
          : summary;
      });
    },
    async status(actor: Actor, game?: "ets2" | "ats"): Promise<S["OwnTripStatusSummary"]> {
      return run(async (tx) => {
        await authority(tx, actor);
        const [row] = await c(tx)
          .select({
            unassessed: sql<number>`COALESCE(SUM(${trips.decision} = 'unassessed'),0)`,
            pendingReview: sql<number>`COALESCE(SUM(${trips.decision} = 'pending_review'),0)`,
            accepted: sql<number>`COALESCE(SUM(${trips.decision} = 'accepted'),0)`,
            rejected: sql<number>`COALESCE(SUM(${trips.decision} = 'rejected'),0)`,
            activeTrips: sql<number>`COALESCE(SUM(${trips.outcome} = 'open'),0)`,
            correctionPending: sql<number>`COALESCE(SUM(${trips.correctionPending}),0)`,
          })
          .from(trips)
          .where(and(eq(trips.ownerId, actor.userId), game ? eq(trips.game, game) : undefined));
        if (!row) throw new Error("TRIP_STATUS_MISSING");
        const count = (n: unknown) => {
          const value = Number(n);
          if (!Number.isSafeInteger(value) || value < 0) throw new Error("TRIP_COUNT_RANGE");
          return value;
        };
        return {
          counts: {
            unassessed: count(row.unassessed),
            pendingReview: count(row.pendingReview),
            accepted: count(row.accepted),
            rejected: count(row.rejected),
          },
          activeTrips: count(row.activeTrips),
          correctionPending: count(row.correctionPending),
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
        .select({ tripId: sourceTrips.canonicalTripId })
        .from(sourceMessages)
        .innerJoin(sourceTrips, eq(sourceTrips.id, sourceMessages.sourceTripId))
        .where(eq(sourceMessages.id, applicationId(messageId)));
      if (!link) throw identityError(404);
      await c(tx)
        .select({ id: trips.id })
        .from(trips)
        .where(eq(trips.id, link.tripId))
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
        .select({ tripId: sourceTrips.canonicalTripId, provider: sourceMessages.provider })
        .from(sourceMessages)
        .innerJoin(sourceTrips, eq(sourceTrips.id, sourceMessages.sourceTripId))
        .where(eq(sourceMessages.id, applicationId(messageId)));
      if (link?.provider !== "ets2telemetry") return false;
      const [trip] = await c(tx)
        .select()
        .from(trips)
        .where(eq(trips.id, link.tripId))
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
