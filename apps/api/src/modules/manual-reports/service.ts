import { createHmac, timingSafeEqual } from "node:crypto";
import type { Readable } from "node:stream";
import type { components } from "@vtc/contracts";
import {
  applicationId,
  createAudit,
  newId,
  opaqueUtf8,
  type TxContext,
  type UnitOfWork,
  utcDateTime,
  utcIso,
} from "@vtc/db";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  lt,
  lte,
  manualBlobGenerations,
  manualCommands,
  manualCorrectionHistory,
  manualCorrectionRequests,
  manualDraftEvidence,
  manualDraftHistory,
  manualDrafts,
  manualEvidence,
  manualEvidenceReferences,
  manualReports,
  manualReviewGates,
  manualRevisions,
  or,
} from "@vtc/db/manual-reports-schema";
import {
  type BlobConfig,
  BlobFailure,
  createPrivateFilesystem,
  type PrivateBlobs,
  type VerifiedBlob,
} from "../../platform/blob-storage/filesystem.js";
import { assertSeparateRoots } from "../../platform/blob-storage/roots.js";
import { createSchemaValidator } from "../../platform/http/schemas.js";
import {
  causes,
  createQueue,
  type Handler,
  RetryableJobError,
  retryTransaction,
  unknownCommit,
} from "../../platform/jobs/queue.js";
import { closed, createOutbox, type ManualEvent } from "../../platform/outbox/events.js";
import type { Catalogs } from "../catalogs/service.js";
import { type Actor, type Identity, identityError } from "../identity/service.js";
import { canonicalJson, decimal } from "../sources/contracts/canonical.js";
import { parseManualSource } from "../sources/contracts/manual.js";
import type { Trips } from "../trips/service.js";

type S = components["schemas"];
type Evidence = typeof manualEvidence.$inferSelect;
type Report = typeof manualReports.$inferSelect;
type Revision = typeof manualRevisions.$inferSelect;
export interface ManualConfig {
  key: string;
  maxFilesPerReport: number;
  policyRevision: number;
  orphanGraceMs: number;
  storage?: BlobConfig;
}
export function validateManualConfig(c: ManualConfig) {
  if (
    !/^[0-9a-f]{64}$/.test(c.key) ||
    !Number.isInteger(c.maxFilesPerReport) ||
    c.maxFilesPerReport < 1 ||
    c.maxFilesPerReport > 100 ||
    !Number.isInteger(c.policyRevision) ||
    c.policyRevision < 1 ||
    !Number.isInteger(c.orphanGraceMs) ||
    c.orphanGraceMs < 60000 ||
    c.orphanGraceMs > 30 * 86400000
  )
    throw new Error("INVALID_MANUAL_CONFIG");
  if (c.storage) createPrivateFilesystem(c.storage);
}
export function calendarYearAfter(value: string): string | null {
  const d = new Date(utcIso(utcDateTime(value)));
  if (d.getUTCFullYear() === 9999) return null;
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString();
}
export function manualError(status: number, code?: string) {
  const error = identityError(status) as Error & { publicCode?: string };
  if (code) error.publicCode = code;
  return error;
}
const transition = () => manualError(503, "EVIDENCE_TRANSITION");
const validate = createSchemaValidator();
const validators = new Map<string, ReturnType<typeof validate.compile>>();
function input<T>(name: string, value: T): T {
  let check = validators.get(name);
  if (!check) {
    check = validate.compile({ $ref: `urn:vtc:browser:v1#/$defs/${name}` });
    validators.set(name, check);
  }
  if (!check(value)) throw manualError(422);
  return JSON.parse(JSON.stringify(value)) as T;
}
type Page = { limit?: number; cursor?: string };
type Receipt =
  | {
      kind: "report";
      id: string;
      version: number;
      revisionId: string;
      tripVersion: number;
      legacySummary?: S["TripSummary"];
      legacyReviewReasons?: S["TripPrivate"]["reviewReasonCodes"];
    }
  | { kind: "draft"; id: string; version: number }
  | { kind: "correction"; id: string; version: number };
export function createManualReports(
  unit: UnitOfWork,
  config: ManualConfig,
  ports: { identity: Identity; catalogs: Catalogs; trips: Trips; blobs?: PrivateBlobs },
  now = () => new Date(),
) {
  validateManualConfig(config);
  const blobs =
      ports.blobs ?? (config.storage ? createPrivateFilesystem(config.storage) : undefined),
    c = (tx: TxContext) => unit.client(tx),
    at = () => now().toISOString(),
    later = (ms: number) => new Date(now().getTime() + ms).toISOString();
  const run = async <T>(fn: (tx: TxContext) => Promise<T>): Promise<T> => {
      try {
        return await retryTransaction(unit, fn);
      } catch (error) {
        if (
          unknownCommit(error) ||
          causes(error).some(
            (cause) =>
              "code" in cause &&
              [
                "ER_LOCK_WAIT_TIMEOUT",
                "ECONNREFUSED",
                "ECONNRESET",
                "PROTOCOL_SEQUENCE_TIMEOUT",
                "PROTOCOL_CONNECTION_LOST",
                "ETIMEDOUT",
                "EPIPE",
              ].includes(String(cause.code)),
          ) ||
          (error instanceof Error &&
            ["No connections available.", "Pool is closed."].includes(error.message))
        )
          throw manualError(503, "DEPENDENCY_UNAVAILABLE");
        throw error;
      }
    },
    audit = createAudit(unit),
    outbox = createOutbox(unit);
  async function emit(
    tx: TxContext,
    type: ManualEvent["type"],
    id: string,
    version: number,
    resourceId: string,
    tripId: string | null,
  ) {
    const eventId = newId();
    await outbox.append(tx, {
      eventId,
      type,
      schemaVersion: 1,
      aggregate: {
        kind:
          type === "manual.draft_saved"
            ? "manual_draft"
            : type === "manual.report_submitted"
              ? "manual_report"
              : "trip",
        id,
        version,
      },
      occurredAt: at(),
      correlationId: eventId,
      causationId: null,
      data: { resourceId, tripId },
    });
  }

  const hash = (domain: string, value: unknown) =>
    createHmac("sha256", Buffer.from(config.key, "hex"))
      .update(`${domain}\0${canonicalJson(value)}`)
      .digest();
  const authority = (tx: TxContext, actor: Actor, write = false) =>
    ports.identity.authorizeInTransaction(tx, actor, write ? "trips.submit_own" : "company.read");
  async function auditWrite(tx: TxContext, actor: Actor, tripId: string, correction = false) {
    await audit.append(tx, {
      actorKind: "user",
      actorId: actor.userId,
      operation: correction ? "manual.correction_requested" : "manual.submitted",
      subjectKind: "trip",
      subjectId: tripId,
      occurredAt: at(),
      reason: "operator_request",
      companyId: null,
    });
  }
  function evidenceDto(row: Evidence): S["Evidence"] {
    if (row.state === "deleting") throw transition();
    return {
      id: row.id,
      state: row.state,
      contentType: row.contentType,
      byteLength: row.byteLength,
      originalName: row.originalName,
    };
  }
  function revisionDto(row: Revision): S["ManualRevisionRead"] {
    return row.format === "legacy"
      ? {
          id: row.id,
          number: row.number,
          submittedAt: row.submittedAt,
          fields: input("ManualInput", row.fields) as S["ManualInput"],
        }
      : {
          representation: "extended",
          id: row.id,
          reportId: row.reportId,
          number: row.number,
          submittedAt: row.submittedAt,
          fields: input("ManualReportFields", row.fields) as S["ManualReportFields"],
        };
  }
  async function reportDto(
    tx: TxContext,
    row: Report,
    receipt?: Extract<Receipt, { kind: "report" }>,
  ): Promise<S["ManualReport"]> {
    const revisionId = receipt?.revisionId ?? row.currentRevisionId;
    if (!revisionId) throw Error("MANUAL_HISTORY_INCONSISTENT");
    const [revision] = await c(tx)
      .select()
      .from(manualRevisions)
      .where(eq(manualRevisions.id, revisionId))
      .for("share");
    const [trip] = await ports.trips.statesInTransaction(tx, [row.tripId]);
    if (!revision || revision.reportId !== row.id || !trip)
      throw new Error("MANUAL_HISTORY_INCONSISTENT");
    return {
      id: row.id,
      version: receipt?.version ?? row.version,
      tripId: row.tripId,
      tripVersion: receipt?.tripVersion ?? trip.version,
      currentRevision: revisionDto(revision),
      createdAt: row.createdAt,
    };
  }
  async function reportDtos(tx: TxContext, rows: Report[]): Promise<S["ManualReport"][]> {
    if (!rows.length) return [];
    const ids = rows.map((row) => {
      if (!row.currentRevisionId) throw Error("MANUAL_HISTORY_INCONSISTENT");
      return row.currentRevisionId;
    });
    const revisions = new Map(
      (await c(tx).select().from(manualRevisions).where(inArray(manualRevisions.id, ids))).map(
        (row) => [row.id, row],
      ),
    );
    const states = new Map(
      (
        await ports.trips.statesInTransaction(
          tx,
          rows.map((row) => row.tripId),
        )
      ).map((row) => [row.id, row]),
    );
    return rows.map((row) => {
      const revision = row.currentRevisionId ? revisions.get(row.currentRevisionId) : undefined,
        trip = states.get(row.tripId);
      if (!revision || revision.reportId !== row.id || !trip)
        throw Error("MANUAL_HISTORY_INCONSISTENT");
      return {
        id: row.id,
        version: row.version,
        tripId: row.tripId,
        tripVersion: trip.version,
        currentRevision: revisionDto(revision),
        createdAt: row.createdAt,
      };
    });
  }
  function draftDto(row: typeof manualDrafts.$inferSelect): S["ManualDraft"] {
    return {
      id: row.id,
      version: row.version,
      state: row.state,
      fields: input("ManualDraftFields", row.fields) as S["ManualDraftFields"],
      targetTrip: row.targetTrip as S["ManualTelemetryTarget"] | null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      submittedReportId: row.submittedReportId,
    };
  }
  async function privateTrip(tx: TxContext, actor: Actor, id: string) {
    const current = await authority(tx, actor);
    const [trip] = await ports.trips.statesInTransaction(tx, [applicationId(id)]);
    if (!trip || (trip.ownerId !== actor.userId && !current.capabilities.includes("trips.review")))
      throw manualError(404);
    return trip;
  }
  async function privateReport(tx: TxContext, actor: Actor, id: string) {
    const [row] = await c(tx)
      .select()
      .from(manualReports)
      .where(eq(manualReports.id, applicationId(id)));
    if (!row) throw manualError(404);
    await privateTrip(tx, actor, row.tripId);
    return row;
  }
  async function ownerDraft(tx: TxContext, actor: Actor, id: string) {
    await authority(tx, actor, true);
    const [row] = await c(tx)
      .select()
      .from(manualDrafts)
      .where(eq(manualDrafts.id, applicationId(id)))
      .for("update");
    if (!row || row.ownerId !== actor.userId) throw manualError(404);
    return row;
  }
  async function rememberDraft(tx: TxContext, row: typeof manualDrafts.$inferSelect) {
    await c(tx)
      .insert(manualDraftHistory)
      .values({ draftId: row.id, version: row.version, snapshot: draftDto(row) });
    await emit(tx, "manual.draft_saved", row.id, row.version, row.id, null);
  }
  async function linkedEvidence(tx: TxContext, actor: Actor, id: string) {
    const current = await authority(tx, actor),
      [row] = await c(tx)
        .select()
        .from(manualEvidence)
        .where(eq(manualEvidence.id, applicationId(id)))
        .for("share");
    if (!row) throw manualError(404);
    if (row.ownerId !== actor.userId) {
      if (!current.capabilities.includes("trips.review")) throw manualError(404);
      const [ref] = await c(tx)
        .select({ id: manualEvidenceReferences.evidenceId })
        .from(manualEvidenceReferences)
        .where(eq(manualEvidenceReferences.evidenceId, id))
        .for("share");
      if (!ref) throw manualError(404);
    }
    if (row.state === "deleting") throw transition();
    return row;
  }
  async function command<T>(
    actor: Actor,
    key: string,
    scope: string,
    value: unknown,
    work: (tx: TxContext) => Promise<Receipt>,
    render: (tx: TxContext, receipt: Receipt) => Promise<T>,
  ): Promise<T> {
    applicationId(key);
    const fingerprint = hash("manual-command/v1", value);
    return run(async (tx) => {
      await authority(tx, actor, true);
      const where = and(
        eq(manualCommands.ownerId, actor.userId),
        eq(manualCommands.scope, opaqueUtf8(scope, 128)),
        eq(manualCommands.key, key),
      );
      // Immutable receipts need a current read; the actor gate already serializes commands.
      const [old] = await c(tx).select().from(manualCommands).where(where).for("share");
      if (old) {
        if (!old.fingerprint.equals(fingerprint)) throw manualError(409, "IDEMPOTENCY_CONFLICT");
        return render(tx, old.result as Receipt);
      }
      const receipt = await work(tx);
      await c(tx)
        .insert(manualCommands)
        .values({
          ownerId: actor.userId,
          scope: opaqueUtf8(scope, 128),
          key,
          fingerprint,
          result: receipt,
          createdAt: at(),
        });
      return render(tx, receipt);
    });
  }
  async function renderReport(tx: TxContext, actor: Actor, receipt: Receipt) {
    if (receipt.kind !== "report") throw new Error("MANUAL_RECEIPT_INVALID");
    return reportDto(tx, await privateReport(tx, actor, receipt.id), receipt);
  }
  async function renderDraft(tx: TxContext, actor: Actor, receipt: Receipt) {
    if (receipt.kind !== "draft") throw new Error("MANUAL_RECEIPT_INVALID");
    await ownerDraft(tx, actor, receipt.id);
    const [row] = await c(tx)
      .select()
      .from(manualDraftHistory)
      .where(
        and(
          eq(manualDraftHistory.draftId, receipt.id),
          eq(manualDraftHistory.version, receipt.version),
        ),
      );
    if (!row) throw new Error("MANUAL_DRAFT_HISTORY_MISSING");
    return row.snapshot as S["ManualDraft"];
  }
  async function evidenceGate(tx: TxContext, ownerId: string, ids: string[], ready: boolean) {
    if (ids.length > config.maxFilesPerReport) throw manualError(422);
    if (!ids.length) return;
    const rows = await c(tx)
      .select()
      .from(manualEvidence)
      .where(inArray(manualEvidence.id, [...ids].sort()))
      .orderBy(asc(manualEvidence.id))
      .for("update");
    if (rows.length !== ids.length || rows.some((row) => row.ownerId !== ownerId))
      throw manualError(404);
    if (rows.some((row) => row.state === "deleting")) throw transition();
    if (ready && rows.some((row) => row.state !== "ready")) throw manualError(409);
  }
  async function draftReferences(
    tx: TxContext,
    actor: Actor,
    id: string,
    fields: S["ManualDraftFields"],
  ) {
    await evidenceGate(tx, actor.userId, fields.evidenceIds ?? [], false);
    await c(tx).delete(manualDraftEvidence).where(eq(manualDraftEvidence.draftId, id));
    if (fields.evidenceIds?.length)
      await c(tx)
        .insert(manualDraftEvidence)
        .values(
          fields.evidenceIds.map((evidenceId) => ({
            draftId: id,
            evidenceId,
            holdUntil: later(config.orphanGraceMs),
          })),
        );
  }
  function normalize(fields: S["ManualSubmissionFields"]): S["ManualReportFields"] {
    const checked = input("ManualSubmissionFields", fields);
    try {
      decimal(checked.cargoMassKg);
      decimal(checked.actualDistanceM);
    } catch {
      throw manualError(422);
    }
    return { ...checked, eventId: checked.eventId ?? null, comment: checked.comment ?? null };
  }
  function legacyFields(fields: S["ManualResolvedInput"]): S["ManualInput"] {
    return {
      ...input("ManualResolvedInput", fields),
      eventId: fields.eventId ?? null,
      comment: fields.comment ?? null,
    };
  }
  function extendedLegacy(f: S["ManualInput"]): S["ManualReportFields"] {
    const select = (entityId: string) => ({
      status: "resolved" as const,
      entityId,
      catalogRevisionId: f.catalogRevisionId,
    });
    return {
      game: f.game,
      origin: select(f.originCityId),
      destination: select(f.destinationCityId),
      cargo: select(f.cargoId),
      trailerType: select(f.trailerTypeId),
      cargoMassKg: f.cargoMassKg,
      actualDistanceM: f.actualDistanceM,
      evidenceIds: f.evidenceIds,
      eventId: f.eventId,
      comment: f.comment,
    };
  }
  async function validateSelections(
    tx: TxContext,
    fields: S["ManualReportFields"],
    previous?: S["ManualReportFields"],
  ) {
    for (const [name, kind] of [
      ["origin", "city"],
      ["destination", "city"],
      ["cargo", "cargo"],
      ["trailerType", "trailer_type"],
    ] as const) {
      const selection = fields[name];
      if (selection.status === "unresolved") continue;
      let fact: Awaited<ReturnType<Catalogs["pinnedInTransaction"]>>;
      try {
        fact = await ports.catalogs.pinnedInTransaction(
          tx,
          selection.catalogRevisionId,
          selection.entityId,
        );
      } catch {
        throw manualError(422);
      }
      if (
        !fact ||
        fact.game !== fields.game ||
        fact.kind !== kind ||
        (fact.retired && canonicalJson(previous?.[name] ?? null) !== canonicalJson(selection))
      )
        throw manualError(422);
    }
  }
  async function submit(
    tx: TxContext,
    actor: Actor,
    fields: S["ManualReportFields"],
    original: S["ManualInput"] | null,
    target: S["ManualTelemetryTarget"] | null,
    existing?: Report,
    expectedTripVersion?: number,
  ): Promise<Extract<Receipt, { kind: "report" }>> {
    await ports.trips.prepareSourceInTransaction(tx, actor.userId, fields.game);
    let tripId: string;
    if (existing) {
      const trip = await ports.trips.manualGateInTransaction(
        tx,
        actor.userId,
        existing.tripId,
        expectedTripVersion,
      );
      if (trip.game !== fields.game || !["pending_review", "rejected"].includes(trip.decision))
        throw manualError(409);
      tripId = trip.id;
    } else if (target) {
      const trip = await ports.trips.manualGateInTransaction(
        tx,
        actor.userId,
        target.tripId,
        target.expectedVersion,
        true,
      );
      if (trip.game !== fields.game || trip.decision === "accepted") throw manualError(409);
      tripId = trip.id;
    } else tripId = await ports.trips.reserveManualInTransaction(tx, actor.userId, fields.game);
    const [oldRevision] = existing?.currentRevisionId
      ? await c(tx)
          .select()
          .from(manualRevisions)
          .where(eq(manualRevisions.id, existing.currentRevisionId))
          .for("share")
      : [];
    await validateSelections(
      tx,
      fields,
      oldRevision
        ? oldRevision.format === "legacy"
          ? extendedLegacy(oldRevision.fields as S["ManualInput"])
          : (oldRevision.fields as S["ManualReportFields"])
        : undefined,
    );
    await evidenceGate(tx, actor.userId, fields.evidenceIds, true);
    const reportId = existing?.id ?? newId(),
      revisionId = newId(),
      number = (existing?.revisionNumber ?? 0) + 1,
      version = (existing?.version ?? 0) + 1;
    if (!existing)
      await c(tx).insert(manualReports).values({
        id: reportId,
        ownerId: actor.userId,
        tripId,
        version,
        revisionNumber: number,
        createdAt: at(),
      });
    await c(tx)
      .insert(manualRevisions)
      .values({
        id: revisionId,
        reportId,
        number,
        format: original ? "legacy" : "extended",
        fields: original ?? fields,
        submittedAt: at(),
      });
    const payload = original
      ? {
          reportId,
          revisionId,
          revision: number,
          game: original.game,
          catalogRevisionId: original.catalogRevisionId,
          originId: original.originCityId,
          destinationId: original.destinationCityId,
          cargoId: original.cargoId,
          trailerTypeId: original.trailerTypeId,
          cargoMassKg: original.cargoMassKg,
          actualDistanceM: original.actualDistanceM,
          evidenceIds: original.evidenceIds,
        }
      : { format: 2 as const, reportId, revisionId, revision: number, fields };
    const [state] = await ports.trips.statesInTransaction(tx, [tripId]);
    if (!state) throw new Error("MANUAL_TRIP_MISSING");
    const context = {
      ownerUserId: actor.userId,
      connection: { state: "unknown" as const, referenceId: null },
      canonical: { tripId, expectedVersion: state.version },
    };
    const stored = existing?.currentRevisionId
      ? await ports.trips.supersedeManualInTransaction(
          tx,
          payload,
          context,
          existing.currentRevisionId,
        )
      : await ports.trips.storeInTransaction(tx, "manual", payload, context);
    await c(tx)
      .update(manualRevisions)
      .set({ sourceRecordId: stored.sourceRecordId })
      .where(eq(manualRevisions.id, revisionId));
    await c(tx)
      .insert(manualEvidenceReferences)
      .values(
        fields.evidenceIds.map((evidenceId) => ({ evidenceId, revisionId, reportId, tripId })),
      );
    await c(tx)
      .update(manualReports)
      .set({ currentRevisionId: revisionId, revisionNumber: number, version })
      .where(eq(manualReports.id, reportId));
    await c(tx)
      .insert(manualReviewGates)
      .values({ tripId, underReview: true })
      .onDuplicateKeyUpdate({ set: { underReview: true } });
    let tripVersion = await ports.trips.manualPendingInTransaction(tx, tripId);
    await ports.trips.manualStoredInTransaction(tx, tripId, stored.sourceRecordId);
    tripVersion = (await ports.trips.groups.resolve(tx, tripId, true)).version;
    await auditWrite(tx, actor, tripId);
    await emit(tx, "manual.report_submitted", reportId, version, revisionId, tripId);
    return { kind: "report", id: reportId, version, revisionId, tripVersion };
  }
  function pageCursor(actor: Actor, scope: string, page: Page) {
    const limit = page.limit ?? 25;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw manualError(422);
    if (!page.cursor) return { limit, after: null };
    try {
      const [body, sig, ...extra] = page.cursor.split(".");
      if (!body || !sig || extra.length) throw Error();
      const signature = hash("manual-cursor/v1", body),
        given = Buffer.from(sig, "base64url");
      if (given.length !== signature.length || !timingSafeEqual(given, signature)) throw Error();
      const value = JSON.parse(Buffer.from(body, "base64url").toString()) as {
        binding: unknown;
        time: string;
        id: string;
      };
      if (
        canonicalJson(value.binding) !==
        canonicalJson([actor.userId, actor.sessionId, actor.accessEpoch, scope])
      )
        throw Error();
      applicationId(value.id);
      utcDateTime(value.time);
      return { limit, after: value };
    } catch {
      throw manualError(409, "VERSION_CONFLICT");
    }
  }
  function pageResult<T>(
    actor: Actor,
    scope: string,
    rows: T[],
    limit: number,
    identity: (row: T) => { time: string; id: string },
  ) {
    const items = rows.slice(0, limit),
      last = items.at(-1);
    let nextCursor: string | null = null;
    if (rows.length > limit && last) {
      const body = Buffer.from(
        canonicalJson({
          binding: [actor.userId, actor.sessionId, actor.accessEpoch, scope],
          ...identity(last),
        }),
      ).toString("base64url");
      nextCursor = `${body}.${hash("manual-cursor/v1", body).toString("base64url")}`;
    }
    return { items, nextCursor };
  }
  async function correctionDtos(
    tx: TxContext,
    rows: (typeof manualCorrectionRequests.$inferSelect)[],
  ): Promise<S["ManualCorrectionRequest"][]> {
    if (!rows.length) return [];
    const history = await c(tx)
      .select()
      .from(manualCorrectionHistory)
      .where(
        inArray(
          manualCorrectionHistory.requestId,
          rows.map((row) => row.id),
        ),
      )
      .orderBy(asc(manualCorrectionHistory.recordedAt), asc(manualCorrectionHistory.id));
    return rows.map((row) => ({
      id: row.id,
      tripId: row.tripId,
      baseTripVersion: row.baseTripVersion,
      baseRevisionId: row.baseRevisionId,
      reason: row.reason,
      requestedAt: row.requestedAt,
      status: row.status,
      history: history
        .filter((h) => h.requestId === row.id)
        .map((h) => ({ status: h.status, recordedAt: h.recordedAt, reason: h.reason })),
    }));
  }
  const deleteReference = (value: unknown) => {
    const p = closed(value, ["evidenceId", "generation"]);
    return {
      evidenceId: applicationId(p.evidenceId as string),
      generation: applicationId(p.generation as string),
    };
  };
  const handler: Handler = {
    kind: "manual.evidence-delete",
    consumer: "manual-evidence-delete-v1",
    version: 1,
    mode: "local",
    validate: deleteReference,
    async prepare(value, _claim, signal) {
      if (!blobs) throw new RetryableJobError();
      const ref = deleteReference(value);
      const [row] = await run((tx) =>
        c(tx).select().from(manualEvidence).where(eq(manualEvidence.id, ref.evidenceId)),
      );
      if (row?.state !== "deleting" || row.generation !== ref.generation) return;
      signal.throwIfAborted();
      try {
        await blobs.remove({ id: ref.evidenceId, generation: ref.generation });
      } catch {
        throw new RetryableJobError();
      }
    },
    async local(tx, value) {
      const ref = deleteReference(value);
      await c(tx)
        .update(manualEvidence)
        .set({ state: "expired", expiredAt: at(), updatedAt: at() })
        .where(
          and(
            eq(manualEvidence.id, ref.evidenceId),
            eq(manualEvidence.generation, ref.generation),
            eq(manualEvidence.state, "deleting"),
          ),
        );
    },
  };
  async function trackGeneration(
    tx: TxContext,
    evidenceId: string,
    generation: string,
    current = false,
  ) {
    const where = and(
      eq(manualBlobGenerations.evidenceId, evidenceId),
      eq(manualBlobGenerations.generation, generation),
    );
    const [old] = await c(tx).select().from(manualBlobGenerations).where(where).for("update");
    if (old) {
      if (!current) throw Error("GENERATION_REUSE_FORBIDDEN");
      if (old.state !== "tracked") throw transition();
      await c(tx)
        .update(manualBlobGenerations)
        .set({ leaseUntil: later(config.storage?.timeoutMs ?? 120000), updatedAt: at() })
        .where(where);
      return;
    }
    await c(tx)
      .insert(manualBlobGenerations)
      .values({
        evidenceId,
        generation,
        createdAt: at(),
        updatedAt: at(),
        leaseUntil: later(config.storage?.timeoutMs ?? 120000),
        nextCheckAt: later(config.orphanGraceMs),
      });
  }
  const generationWhere = (id: string, generation: string) =>
    and(eq(manualBlobGenerations.evidenceId, id), eq(manualBlobGenerations.generation, generation));
  const protectedGeneration = (e: Evidence, generation: string) =>
    e.generation === generation && ["processing", "ready", "deleting"].includes(e.state);
  async function generationFence(tx: TxContext, ref: ReturnType<typeof deleteReference>) {
    const [evidence] = await c(tx)
      .select()
      .from(manualEvidence)
      .where(eq(manualEvidence.id, ref.evidenceId))
      .for("update");
    const [generation] = await c(tx)
      .select()
      .from(manualBlobGenerations)
      .where(generationWhere(ref.evidenceId, ref.generation))
      .for("update");
    if (!evidence || !generation || generation.state !== "deleting") return null;
    if (protectedGeneration(evidence, ref.generation)) throw new RetryableJobError();
    return generation;
  }
  const generationHandler: Handler = {
    kind: "manual.generation-delete",
    consumer: "manual-generation-delete-v1",
    version: 1,
    mode: "local",
    validate: deleteReference,
    async prepare(value, _claim, signal) {
      if (!blobs) throw new RetryableJobError();
      const ref = deleteReference(value);
      if (!(await run((tx) => generationFence(tx, ref)))) return;
      signal.throwIfAborted();
      try {
        await blobs.remove({ id: ref.evidenceId, generation: ref.generation }, true);
        await blobs.remove({ id: ref.evidenceId, generation: ref.generation });
      } catch {
        throw new RetryableJobError();
      }
    },
    async local(tx, value) {
      const ref = deleteReference(value);
      if (!(await generationFence(tx, ref))) return;
      await c(tx)
        .update(manualBlobGenerations)
        .set({ state: "tracked", nextCheckAt: later(config.orphanGraceMs), updatedAt: at() })
        .where(generationWhere(ref.evidenceId, ref.generation));
    },
  };
  const queue = createQueue(unit, [handler, generationHandler]);
  async function enqueueGeneration(
    tx: TxContext,
    generation: typeof manualBlobGenerations.$inferSelect,
  ) {
    const attempt = generation.deleteAttempt + 1;
    const jobId = await queue.enqueue(tx, {
      kind: generationHandler.kind,
      consumer: generationHandler.consumer,
      schemaVersion: 1,
      eventId: null,
      effectKey: `generation:${generation.evidenceId}:${generation.generation}:${attempt}`,
      reference: { evidenceId: generation.evidenceId, generation: generation.generation },
      availableAt: at(),
      maxAttempts: 5,
    });
    await c(tx)
      .update(manualBlobGenerations)
      .set({
        state: "deleting",
        deleteAttempt: attempt,
        deletionJobId: jobId,
        nextCheckAt: later(config.orphanGraceMs),
        updatedAt: at(),
      })
      .where(generationWhere(generation.evidenceId, generation.generation));
  }
  async function generationMaintenance(signal: AbortSignal) {
    if (!blobs) return;
    for (const state of ["tracked", "deleting"] as const) {
      const due = await run((tx) =>
        c(tx)
          .select()
          .from(manualBlobGenerations)
          .where(
            and(
              eq(manualBlobGenerations.state, state),
              lte(manualBlobGenerations.nextCheckAt, at()),
            ),
          )
          .orderBy(
            asc(manualBlobGenerations.nextCheckAt),
            asc(manualBlobGenerations.evidenceId),
            asc(manualBlobGenerations.generation),
          )
          .limit(25),
      );
      for (const candidate of due) {
        signal.throwIfAborted();
        const reserved = await run(async (tx) => {
          const [evidence] = await c(tx)
            .select()
            .from(manualEvidence)
            .where(eq(manualEvidence.id, candidate.evidenceId))
            .for("update");
          const [generation] = await c(tx)
            .select()
            .from(manualBlobGenerations)
            .where(generationWhere(candidate.evidenceId, candidate.generation))
            .for("update");
          if (!evidence || !generation || generation.nextCheckAt > at()) return null;
          await c(tx)
            .update(manualBlobGenerations)
            .set({ nextCheckAt: later(config.orphanGraceMs), updatedAt: at() })
            .where(generationWhere(candidate.evidenceId, candidate.generation));
          if (
            protectedGeneration(evidence, generation.generation) ||
            generation.leaseUntil > at() ||
            generation.createdAt > new Date(now().getTime() - config.orphanGraceMs).toISOString()
          )
            return null;
          if (generation.state === "deleting") {
            const effect = await queue.effectState(
              tx,
              generationHandler.consumer,
              `generation:${generation.evidenceId}:${generation.generation}:${generation.deleteAttempt}`,
            );
            if (!effect || effect.state === "failed" || effect.state === "completed")
              await enqueueGeneration(tx, generation);
            return null;
          }
          return generation;
        });
        if (!reserved) continue;
        const key = { id: reserved.evidenceId, generation: reserved.generation };
        // A missing result is only one observation. Persisted next_check_at is
        // retained so a late filesystem completion is found by a fresh process.
        if (!(await blobs.present(key, true)) && !(await blobs.present(key))) continue;
        await run(async (tx) => {
          const [evidence] = await c(tx)
            .select()
            .from(manualEvidence)
            .where(eq(manualEvidence.id, key.id))
            .for("update");
          const [generation] = await c(tx)
            .select()
            .from(manualBlobGenerations)
            .where(generationWhere(key.id, key.generation))
            .for("update");
          if (
            !evidence ||
            !generation ||
            generation.state !== "tracked" ||
            protectedGeneration(evidence, key.generation) ||
            generation.leaseUntil > at()
          )
            return;
          await enqueueGeneration(tx, generation);
        });
      }
    }
  }
  async function enqueueDeletion(tx: TxContext, row: Evidence) {
    const attempt = row.deleteAttempt + 1,
      jobId = await queue.enqueue(tx, {
        kind: handler.kind,
        consumer: handler.consumer,
        schemaVersion: 1,
        eventId: null,
        effectKey: `evidence:${row.id}:${attempt}`,
        reference: { evidenceId: row.id, generation: row.generation },
        availableAt: at(),
        maxAttempts: 5,
      });
    await c(tx)
      .update(manualEvidence)
      .set({ state: "deleting", deleteAttempt: attempt, deletionJobId: jobId, updatedAt: at() })
      .where(eq(manualEvidence.id, row.id));
  }
  async function recoverUpload(id: string, signal?: AbortSignal) {
    if (!blobs) return;
    const token = newId();
    const reserved = await run(async (tx) => {
      const [row] = await c(tx)
        .select()
        .from(manualEvidence)
        .where(eq(manualEvidence.id, id))
        .for("update");
      if (row?.state !== "processing" || (row.leaseUntil && row.leaseUntil > at())) return null;
      await trackGeneration(tx, row.id, row.generation, true);
      await c(tx)
        .update(manualEvidence)
        .set({ leaseToken: token, leaseUntil: later(config.storage?.timeoutMs ?? 120000) })
        .where(eq(manualEvidence.id, id));
      return row;
    });
    if (!reserved) return;
    let verified: VerifiedBlob | null = null;
    try {
      const recovered = await blobs.inspect(reserved, signal);
      if (recovered && recovered.contentType !== reserved.contentType)
        throw new BlobFailure("invalid");
      verified = recovered;
    } catch (error) {
      if (
        !(error instanceof BlobFailure) ||
        error.category === "unavailable" ||
        error.category === "cancelled"
      )
        throw error;
    }
    await run(async (tx) => {
      const [row] = await c(tx)
        .select()
        .from(manualEvidence)
        .where(eq(manualEvidence.id, id))
        .for("update");
      if (
        !row ||
        row.leaseToken !== token ||
        row.generation !== reserved.generation ||
        row.state !== "processing"
      )
        return;
      if (verified)
        await c(tx)
          .update(manualEvidence)
          .set({
            state: "ready",
            ...verified,
            fingerprint: hash("manual-upload/v1", {
              name: row.originalName,
              ...verified,
              sha256: verified.sha256.toString("hex"),
            }),
            leaseToken: null,
            leaseUntil: null,
            updatedAt: at(),
          })
          .where(eq(manualEvidence.id, id));
      else
        await c(tx)
          .update(manualEvidence)
          .set({ state: "rejected", leaseToken: null, leaseUntil: null, updatedAt: at() })
          .where(eq(manualEvidence.id, id));
    });
  }
  return {
    config,
    handler,
    generationHandler,
    async initialize(webRoot?: string) {
      if (config.storage && webRoot) await assertSeparateRoots(config.storage.root, webRoot);
      await blobs?.ready?.();
    },
    async policy(actor: Actor): Promise<S["UploadPolicy"]> {
      await run((tx) => authority(tx, actor, true));
      return {
        enabled: !!blobs,
        maxFileBytes: config.storage?.maxFileBytes ?? null,
        maxFilesPerReport: blobs ? config.maxFilesPerReport : null,
        allowedMimeTypes: blobs ? ["image/png", "image/jpeg"] : [],
        policyRevision: config.policyRevision,
      };
    },
    authorize(actor: Actor, write = false) {
      return run((tx) => authority(tx, actor, write));
    },
    createDraft(actor: Actor, key: string, value: S["ManualDraftInput"]) {
      value = input("ManualDraftInput", value);
      return command(
        actor,
        key,
        "draft/create",
        { ...value, targetTrip: value.targetTrip ?? null },
        async (tx) => {
          const row = {
            id: newId(),
            ownerId: actor.userId,
            version: 1,
            state: "editing" as const,
            fields: value.fields,
            targetTrip: value.targetTrip ?? null,
            submittedReportId: null,
            createdAt: at(),
            updatedAt: at(),
          };
          await c(tx).insert(manualDrafts).values(row);
          await draftReferences(tx, actor, row.id, value.fields);
          await rememberDraft(tx, row);
          return { kind: "draft", id: row.id, version: 1 };
        },
        (tx, r) => renderDraft(tx, actor, r),
      );
    },
    replaceDraft(
      actor: Actor,
      id: string,
      key: string,
      expected: number,
      value: S["ManualDraftInput"],
    ) {
      value = input("ManualDraftInput", value);
      return command(
        actor,
        key,
        `draft/${applicationId(id)}/replace`,
        { expected, ...value, targetTrip: value.targetTrip ?? null },
        async (tx) => {
          const row = await ownerDraft(tx, actor, id);
          if (row.version !== expected) throw manualError(409, "VERSION_CONFLICT");
          if (row.state !== "editing") throw manualError(409);
          await draftReferences(tx, actor, id, value.fields);
          const next = {
            ...row,
            version: row.version + 1,
            fields: value.fields,
            targetTrip: value.targetTrip ?? null,
            updatedAt: at(),
          };
          await c(tx).update(manualDrafts).set(next).where(eq(manualDrafts.id, id));
          await rememberDraft(tx, next);
          return { kind: "draft", id, version: next.version };
        },
        (tx, r) => renderDraft(tx, actor, r),
      );
    },
    getDraft(actor: Actor, id: string) {
      return run(async (tx) => draftDto(await ownerDraft(tx, actor, id)));
    },
    listDrafts(actor: Actor, page: Page = {}) {
      return run(async (tx) => {
        await authority(tx, actor, true);
        const scope = "drafts",
          { limit, after } = pageCursor(actor, scope, page);
        const rows = await c(tx)
          .select()
          .from(manualDrafts)
          .where(
            and(
              eq(manualDrafts.ownerId, actor.userId),
              after
                ? or(
                    lt(manualDrafts.createdAt, after.time),
                    and(eq(manualDrafts.createdAt, after.time), lt(manualDrafts.id, after.id)),
                  )
                : undefined,
            ),
          )
          .orderBy(desc(manualDrafts.createdAt), desc(manualDrafts.id))
          .limit(limit + 1);
        const result = pageResult(actor, scope, rows, limit, (row) => ({
          id: row.id,
          time: row.createdAt,
        }));
        return { ...result, items: result.items.map(draftDto) };
      });
    },
    submitDraft(
      actor: Actor,
      id: string,
      key: string,
      expected: number,
      value: S["ManualDraftSubmission"],
    ) {
      value = input("ManualDraftSubmission", value);
      const fields = normalize(value.fields);
      return command(
        actor,
        key,
        `draft/${applicationId(id)}/submit`,
        { expected, fields },
        async (tx) => {
          const row = await ownerDraft(tx, actor, id);
          if (row.version !== expected) throw manualError(409, "VERSION_CONFLICT");
          if (row.state !== "editing") throw manualError(409);
          const receipt = await submit(
            tx,
            actor,
            fields,
            null,
            row.targetTrip as S["ManualTelemetryTarget"] | null,
          );
          const next = {
            ...row,
            version: row.version + 1,
            state: "submitted" as const,
            fields,
            submittedReportId: receipt.id,
            updatedAt: at(),
          };
          await c(tx).update(manualDrafts).set(next).where(eq(manualDrafts.id, id));
          await c(tx).delete(manualDraftEvidence).where(eq(manualDraftEvidence.draftId, id));
          await rememberDraft(tx, next);
          return receipt;
        },
        (tx, r) => renderReport(tx, actor, r),
      );
    },
    submitReport(actor: Actor, key: string, value: S["ManualReportInput"]) {
      value = input("ManualReportInput", value);
      const fields = normalize(value.fields);
      return command(
        actor,
        key,
        "report/create",
        { fields, targetTrip: value.targetTrip ?? null },
        (tx) => submit(tx, actor, fields, null, value.targetTrip ?? null),
        (tx, r) => renderReport(tx, actor, r),
      );
    },
    reviseReport(
      actor: Actor,
      id: string,
      key: string,
      expected: number,
      value: S["ManualReportRevisionInput"],
    ) {
      value = input("ManualReportRevisionInput", value);
      const fields = normalize(value.fields);
      return command(
        actor,
        key,
        `report/${applicationId(id)}/revise`,
        { expected, ...value, fields },
        async (tx) => {
          const row = await privateReport(tx, actor, id);
          if (row.ownerId !== actor.userId) throw manualError(404);
          await ports.trips.manualGateInTransaction(
            tx,
            actor.userId,
            row.tripId,
            value.expectedTripVersion,
          );
          const [locked] = await c(tx)
            .select()
            .from(manualReports)
            .where(eq(manualReports.id, id))
            .for("update");
          if (!locked || locked.version !== expected) throw manualError(409, "VERSION_CONFLICT");
          return submit(tx, actor, fields, null, null, locked, value.expectedTripVersion);
        },
        (tx, r) => renderReport(tx, actor, r),
      );
    },
    async legacySubmit(
      actor: Actor,
      key: string,
      value: S["ManualResolvedInput"],
      tripId?: string,
      expected?: number,
    ): Promise<S["TripPrivate"]> {
      const original = legacyFields(value),
        fields = normalize(extendedLegacy(original));
      return command(
        actor,
        key,
        tripId ? `legacy/${applicationId(tripId)}/revise` : "legacy/create",
        { fields, expected: expected ?? null },
        async (tx) => {
          let existing: Report | undefined;
          if (tripId) {
            await ports.trips.manualGateInTransaction(tx, actor.userId, tripId, expected);
            const reports = await c(tx)
              .select()
              .from(manualReports)
              .where(and(eq(manualReports.tripId, tripId), eq(manualReports.ownerId, actor.userId)))
              .for("update");
            if (reports.length !== 1) throw manualError(409);
            existing = reports[0];
          }
          const receipt = await submit(tx, actor, fields, original, null, existing, expected);
          const row = await privateReport(tx, actor, receipt.id);
          const [trip] = await ports.trips.statesInTransaction(tx, [row.tripId]);
          if (!trip) throw Error("MANUAL_TRIP_MISSING");
          return {
            ...receipt,
            legacySummary: await ports.trips.summaryInTransaction(
              tx,
              row.tripId,
              (await authority(tx, actor)).locale,
            ),
            legacyReviewReasons: trip.reviewReasons,
          };
        },
        async (tx, r) => {
          const report = await renderReport(tx, actor, r);
          if (r.kind !== "report" || !r.legacySummary || !r.legacyReviewReasons)
            throw Error("MANUAL_RECEIPT_INVALID");
          const ids = report.currentRevision.fields.evidenceIds;
          const evidence = await c(tx)
            .select()
            .from(manualEvidence)
            .where(inArray(manualEvidence.id, ids));
          return {
            view: "private",
            summary: r.legacySummary,
            manualRevision: report.currentRevision,
            evidence: evidence.map(evidenceDto),
            decisions: [],
            pendingProposalId: null,
            reviewReasonCodes: r.legacyReviewReasons,
          };
        },
      );
    },
    getReport(actor: Actor, id: string) {
      return run(async (tx) => reportDto(tx, await privateReport(tx, actor, id)));
    },
    listReports(actor: Actor, page: Page = {}, tripId?: string) {
      return run(async (tx) => {
        await authority(tx, actor);
        if (tripId) await privateTrip(tx, actor, tripId);
        const scope = tripId ? `trip/${tripId}/reports` : "reports",
          { limit, after } = pageCursor(actor, scope, page);
        const rows = await c(tx)
          .select()
          .from(manualReports)
          .where(
            and(
              tripId ? eq(manualReports.tripId, tripId) : eq(manualReports.ownerId, actor.userId),
              after
                ? or(
                    lt(manualReports.createdAt, after.time),
                    and(eq(manualReports.createdAt, after.time), lt(manualReports.id, after.id)),
                  )
                : undefined,
            ),
          )
          .orderBy(desc(manualReports.createdAt), desc(manualReports.id))
          .limit(limit + 1);
        const result = pageResult(actor, scope, rows, limit, (row) => ({
          id: row.id,
          time: row.createdAt,
        }));
        return {
          ...result,
          items: await reportDtos(tx, result.items),
        };
      });
    },
    revisions(actor: Actor, id: string, page: Page = {}, tripScope = false, revisionId?: string) {
      return run(async (tx) => {
        await authority(tx, actor);
        if (tripScope) await privateTrip(tx, actor, id);
        const reportIds = tripScope
          ? (
              await c(tx)
                .select({ id: manualReports.id })
                .from(manualReports)
                .where(
                  inArray(
                    manualReports.tripId,
                    (await ports.trips.groups.members(tx, [id], true)).map((t) => t.id),
                  ),
                )
            ).map((row) => row.id)
          : [(await privateReport(tx, actor, id)).id];
        const scope = `${tripScope ? "trip" : "report"}/${id}/revisions`,
          { limit, after } = pageCursor(actor, scope, page);
        if (!reportIds.length) {
          if (revisionId) throw manualError(404);
          return { items: [], nextCursor: null };
        }
        const rows = await c(tx)
          .select()
          .from(manualRevisions)
          .where(
            and(
              inArray(manualRevisions.reportId, reportIds),
              revisionId ? eq(manualRevisions.id, applicationId(revisionId)) : undefined,
              after
                ? or(
                    lt(manualRevisions.submittedAt, after.time),
                    and(
                      eq(manualRevisions.submittedAt, after.time),
                      lt(manualRevisions.id, after.id),
                    ),
                  )
                : undefined,
            ),
          )
          .orderBy(desc(manualRevisions.submittedAt), desc(manualRevisions.id))
          .limit(revisionId ? 1 : limit + 1);
        if (revisionId) {
          if (!rows[0]) throw manualError(404);
          return revisionDto(rows[0]);
        }
        const result = pageResult(actor, scope, rows, limit, (row) => ({
          id: row.id,
          time: row.submittedAt,
        }));
        return { ...result, items: result.items.map(revisionDto) };
      });
    },
    requestCorrection(
      actor: Actor,
      id: string,
      key: string,
      expected: number,
      value: S["ReasonInput"],
    ) {
      value = input("ReasonInput", value);
      return command(
        actor,
        key,
        `trip/${applicationId(id)}/correction`,
        { expected, ...value },
        async (tx) => {
          const trip = await ports.trips.manualGateInTransaction(tx, actor.userId, id, expected);
          if (trip.decision !== "accepted") throw manualError(409);
          await gateTripEvidence(tx, id);
          const [report] = await c(tx)
            .select()
            .from(manualReports)
            .where(eq(manualReports.tripId, id))
            .orderBy(desc(manualReports.createdAt), desc(manualReports.id))
            .limit(1);
          const requestId = newId();
          await c(tx)
            .insert(manualCorrectionRequests)
            .values({
              id: requestId,
              ownerId: actor.userId,
              tripId: id,
              baseTripVersion: expected,
              baseRevisionId: report?.currentRevisionId ?? null,
              reason: value.reason,
              status: "pending",
              requestedAt: at(),
            });
          await c(tx)
            .insert(manualCorrectionHistory)
            .values({ id: newId(), requestId, status: "pending", recordedAt: at() });
          await c(tx)
            .insert(manualReviewGates)
            .values({ tripId: id, underReview: true })
            .onDuplicateKeyUpdate({ set: { underReview: true } });
          const version = await ports.trips.manualPendingInTransaction(tx, id, true);
          await auditWrite(tx, actor, id, true);
          await emit(tx, "manual.correction_requested", id, version, requestId, id);
          await ports.trips.correctionRequestedInTransaction(
            tx,
            id,
            requestId,
            actor,
            value.reason,
          );
          return { kind: "correction", id: requestId, version };
        },
        async (tx, r) => {
          if (r.kind !== "correction") throw Error("MANUAL_RECEIPT_INVALID");
          await privateTrip(tx, actor, id);
          return { id: r.id, version: r.version };
        },
      );
    },
    corrections(actor: Actor, tripId: string, page: Page = {}, requestId?: string) {
      return run(async (tx) => {
        const trip = await privateTrip(tx, actor, tripId),
          scope = `trip/${tripId}/corrections`,
          { limit, after } = pageCursor(actor, scope, page);
        const rows = await c(tx)
          .select()
          .from(manualCorrectionRequests)
          .where(
            and(
              inArray(
                manualCorrectionRequests.tripId,
                (await ports.trips.groups.members(tx, [tripId])).map((t) => t.id),
              ),
              requestId ? eq(manualCorrectionRequests.id, applicationId(requestId)) : undefined,
              after
                ? or(
                    lt(manualCorrectionRequests.requestedAt, after.time),
                    and(
                      eq(manualCorrectionRequests.requestedAt, after.time),
                      lt(manualCorrectionRequests.id, after.id),
                    ),
                  )
                : undefined,
            ),
          )
          .orderBy(desc(manualCorrectionRequests.requestedAt), desc(manualCorrectionRequests.id))
          .limit(requestId ? 1 : limit + 1);
        if (requestId) {
          if (!rows[0]) throw manualError(404);
          return { data: (await correctionDtos(tx, [rows[0]]))[0], version: trip.version };
        }
        const result = pageResult(actor, scope, rows, limit, (row) => ({
          id: row.id,
          time: row.requestedAt,
        }));
        return {
          items: await correctionDtos(tx, result.items),
          nextCursor: result.nextCursor,
        };
      });
    },
    metadata(actor: Actor, id: string) {
      return run(async (tx) => evidenceDto(await linkedEvidence(tx, actor, id)));
    },
    async content(
      actor: Actor,
      id: string,
    ): Promise<{ stream: Readable; metadata: S["Evidence"] }> {
      if (!blobs) throw manualError(503, "DEPENDENCY_UNAVAILABLE");
      const row = await run((tx) => linkedEvidence(tx, actor, id));
      if (row.state === "expired") throw manualError(410, "EVIDENCE_EXPIRED");
      if (row.state !== "ready") throw manualError(409);
      let stream: Readable;
      try {
        stream = await blobs.read(row);
      } catch {
        throw manualError(503, "DEPENDENCY_UNAVAILABLE");
      }
      try {
        await run(async (tx) => {
          const current = await linkedEvidence(tx, actor, id);
          if (current.state !== "ready" || current.generation !== row.generation)
            throw transition();
        });
      } catch (error) {
        stream.destroy();
        throw error;
      }
      return { stream, metadata: evidenceDto(row) };
    },
    async upload(
      actor: Actor,
      key: string,
      name: string,
      bytes: AsyncIterable<Uint8Array>,
      declaredType: string,
      signal?: AbortSignal,
    ): Promise<S["Evidence"]> {
      if (!blobs || !config.storage) throw manualError(503, "DEPENDENCY_UNAVAILABLE");
      applicationId(key);
      name = name.split(/[\\/]/).at(-1) ?? "";
      if (
        !name ||
        name.length > 256 ||
        [...name].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
        !["image/png", "image/jpeg"].includes(declaredType)
      )
        throw manualError(422);
      const initialToken = newId();
      let row = await run(async (tx) => {
        await authority(tx, actor, true);
        const scope = opaqueUtf8("upload", 128);
        const [old] = await c(tx)
          .select()
          .from(manualCommands)
          .where(
            and(
              eq(manualCommands.ownerId, actor.userId),
              eq(manualCommands.scope, scope),
              eq(manualCommands.key, key),
            ),
          )
          .for("share");
        if (old) {
          const [e] = await c(tx)
            .select()
            .from(manualEvidence)
            .where(eq(manualEvidence.id, (old.result as { id: string }).id))
            .for("update");
          if (!e) throw Error("UPLOAD_IDENTITY_MISSING");
          return e;
        }
        const id = newId(),
          generation = newId(),
          token = initialToken;
        await c(tx)
          .insert(manualEvidence)
          .values({
            id,
            ownerId: actor.userId,
            state: "processing",
            generation,
            originalName: name,
            contentType: declaredType,
            leaseToken: token,
            leaseUntil: later(config.storage?.timeoutMs ?? 120000),
            createdAt: at(),
            updatedAt: at(),
            nextCheckAt: at(),
          });
        await trackGeneration(tx, id, generation);
        await c(tx)
          .insert(manualCommands)
          .values({
            ownerId: actor.userId,
            scope,
            key,
            fingerprint: hash("upload-key/v1", key),
            result: { id },
            createdAt: at(),
          });
        return (
          await c(tx).select().from(manualEvidence).where(eq(manualEvidence.id, id))
        )[0] as Evidence;
      });
      if (row.state === "processing" && row.leaseUntil && row.leaseUntil <= at()) {
        try {
          await recoverUpload(row.id, signal);
        } catch (error) {
          if (
            unknownCommit(error) ||
            !(error instanceof BlobFailure) ||
            "cause" in error ||
            "statusCode" in error ||
            !["unavailable", "cancelled"].includes(error.category)
          )
            throw error;
          throw manualError(503, "DEPENDENCY_UNAVAILABLE");
        }
        row = (
          await run((tx) =>
            c(tx).select().from(manualEvidence).where(eq(manualEvidence.id, row.id)),
          )
        )[0] as Evidence;
      }
      const reserved = await run(async (tx) => {
        await authority(tx, actor, true);
        const [current] = await c(tx)
          .select()
          .from(manualEvidence)
          .where(eq(manualEvidence.id, row.id))
          .for("update");
        if (!current) throw Error("UPLOAD_IDENTITY_MISSING");
        if (current.state === "deleting") throw transition();
        if (current.state === "expired") throw manualError(409);
        if (current.state === "ready") {
          const generation = newId();
          await trackGeneration(tx, current.id, generation);
          return { row: current, key: { id: current.id, generation }, replay: true };
        }
        if (
          current.state === "processing" &&
          current.leaseToken !== initialToken &&
          current.leaseUntil &&
          current.leaseUntil > at()
        )
          throw manualError(503, "DEPENDENCY_UNAVAILABLE");
        const generation = current.state === "rejected" ? newId() : current.generation,
          token = newId();
        await c(tx)
          .update(manualEvidence)
          .set({
            state: "processing",
            generation,
            leaseToken: token,
            leaseUntil: later(config.storage?.timeoutMs ?? 120000),
            originalName: name,
            contentType: declaredType,
            updatedAt: at(),
          })
          .where(eq(manualEvidence.id, current.id));
        await trackGeneration(tx, current.id, generation, current.state !== "rejected");
        return {
          row: {
            ...current,
            generation,
            leaseToken: token,
            originalName: name,
            contentType: declaredType,
          },
          key: { id: current.id, generation },
          replay: false,
        };
      });
      let verified: VerifiedBlob;
      try {
        verified = await blobs.put(reserved.key, bytes, signal);
        if (verified.contentType !== declaredType) throw new BlobFailure("invalid");
      } catch (error) {
        if (!reserved.replay)
          await run((tx) =>
            c(tx)
              .update(manualEvidence)
              .set({ state: "rejected", leaseToken: null, leaseUntil: null, updatedAt: at() })
              .where(
                and(
                  eq(manualEvidence.id, row.id),
                  eq(manualEvidence.generation, reserved.key.generation),
                  eq(manualEvidence.leaseToken, reserved.row.leaseToken as string),
                ),
              ),
          );
        if (error instanceof BlobFailure)
          throw manualError(
            error.category === "oversized" ? 413 : error.category === "invalid" ? 422 : 503,
            error.category === "unavailable" || error.category === "cancelled"
              ? "DEPENDENCY_UNAVAILABLE"
              : undefined,
          );
        throw error;
      }
      const fingerprint = hash("manual-upload/v1", {
        name,
        ...verified,
        sha256: verified.sha256.toString("hex"),
      });
      try {
        return await run(async (tx) => {
          await authority(tx, actor, true);
          const [current] = await c(tx)
            .select()
            .from(manualEvidence)
            .where(eq(manualEvidence.id, row.id))
            .for("update");
          if (!current) throw Error("UPLOAD_IDENTITY_MISSING");
          if (reserved.replay) {
            if (current.state !== "ready" || !current.fingerprint?.equals(fingerprint))
              throw manualError(409, "IDEMPOTENCY_CONFLICT");
            return evidenceDto(current);
          }
          if (
            current.state !== "processing" ||
            current.generation !== reserved.key.generation ||
            current.leaseToken !== reserved.row.leaseToken
          )
            throw manualError(503, "DEPENDENCY_UNAVAILABLE");
          await c(tx)
            .update(manualEvidence)
            .set({
              state: "ready",
              ...verified,
              fingerprint,
              leaseToken: null,
              leaseUntil: null,
              updatedAt: at(),
            })
            .where(eq(manualEvidence.id, row.id));
          return evidenceDto({ ...current, state: "ready", ...verified, fingerprint });
        });
      } finally {
        if (reserved.replay) await blobs.remove(reserved.key);
      }
    },
    async reviewContextInTransaction(tx: TxContext, tripId: string) {
      const members = await ports.trips.groups.members(tx, [tripId], true),
        ids = members.map((t) => t.id);
      const reports = await c(tx)
        .select()
        .from(manualReports)
        .where(inArray(manualReports.tripId, ids))
        .orderBy(manualReports.id)
        .for("share");
      const revisions = reports.length
        ? await c(tx)
            .select()
            .from(manualRevisions)
            .where(
              inArray(
                manualRevisions.id,
                reports.flatMap((r) => (r.currentRevisionId ? [r.currentRevisionId] : [])),
              ),
            )
            .for("share")
        : [];
      await gateTripEvidence(tx, tripId);
      return {
        reports: reports.map((r) => ({
          id: r.id,
          ownerId: r.ownerId,
          revisionId: r.currentRevisionId,
        })),
        revisions: revisions.map(revisionDto),
      };
    },
    async resolutionEvidenceInTransaction(
      tx: TxContext,
      tripId: string,
      ownerId: string,
      ids: string[],
      validateReady = true,
    ) {
      if (ids.length > config.maxFilesPerReport || new Set(ids).size !== ids.length)
        throw manualError(422);
      const members = await ports.trips.groups.members(tx, [tripId], true);
      const refs = ids.length
        ? await c(tx)
            .select()
            .from(manualEvidenceReferences)
            .where(inArray(manualEvidenceReferences.evidenceId, ids))
            .for("share")
        : [];
      if (
        ids.some(
          (id) => !refs.some((r) => r.evidenceId === id && members.some((t) => t.id === r.tripId)),
        )
      )
        throw manualError(422);
      if (ids.length && validateReady) await evidenceGate(tx, ownerId, ids, true);
      return ids.length
        ? (
            await c(tx)
              .select()
              .from(manualEvidence)
              .where(inArray(manualEvidence.id, ids))
              .for("share")
          ).map(evidenceDto)
        : [];
    },
    async groupDecisionInTransaction(tx: TxContext, tripId: string, decisionAt: string | null) {
      await gateTripEvidence(tx, tripId);
      for (const member of await ports.trips.groups.members(tx, [tripId], true)) {
        const [old] = await c(tx)
          .select()
          .from(manualReviewGates)
          .where(eq(manualReviewGates.tripId, member.id))
          .for("update");
        if (decisionAt && old?.latestDecisionAt && decisionAt < old.latestDecisionAt)
          throw manualError(409);
        await c(tx)
          .insert(manualReviewGates)
          .values({
            tripId: member.id,
            latestDecisionAt: decisionAt ?? old?.latestDecisionAt ?? null,
            underReview: decisionAt === null,
          })
          .onDuplicateKeyUpdate({
            set: {
              latestDecisionAt: decisionAt ?? old?.latestDecisionAt ?? null,
              underReview: decisionAt === null,
            },
          });
      }
    },
    validateSourceInTransaction: validateSource,
    projectionInTransaction: projection,
    async reconciliationGuardInTransaction(tx: TxContext, tripIds: string[], actorId?: string) {
      const members = await ports.trips.groups.members(tx, tripIds, true),
        ids = members.map((t) => t.id);
      const reports = await c(tx)
        .select({ ownerId: manualReports.ownerId })
        .from(manualReports)
        .where(inArray(manualReports.tripId, ids))
        .for("share");
      if (actorId && reports.some((r) => r.ownerId === actorId))
        throw manualError(403, "SELF_REVIEW_FORBIDDEN");
      for (const id of ids) await gateTripEvidence(tx, id);
      return [...new Set(reports.map((r) => r.ownerId))];
    },

    // VTC-029 calls this only in its decision transaction after applying the trip
    // state. It records retention metadata, never an acceptance or contribution.
    async decisionRecordedInTransaction(
      tx: TxContext,
      actor: Actor,
      reportId: string,
      revisionId: string,
      decisionAt: string,
    ) {
      await ports.identity.authorizeInTransaction(tx, actor, "trips.review");
      const report = await privateReport(tx, actor, reportId);
      if (report.ownerId === actor.userId) throw manualError(403, "SELF_REVIEW_FORBIDDEN");
      const trip = await ports.trips.manualGateInTransaction(tx, report.ownerId, report.tripId);
      const [currentReport] = await c(tx)
        .select()
        .from(manualReports)
        .where(eq(manualReports.id, reportId))
        .for("share");
      if (
        !["accepted", "rejected"].includes(trip.decision) ||
        trip.reviewHold ||
        trip.correctionPending ||
        !currentReport ||
        currentReport.currentRevisionId !== revisionId
      )
        throw manualError(409);
      await gateTripEvidence(tx, trip.id);
      const instant = utcIso(utcDateTime(decisionAt));
      if (instant > at()) throw manualError(422);
      const [gate] = await c(tx)
        .select()
        .from(manualReviewGates)
        .where(eq(manualReviewGates.tripId, trip.id))
        .for("update");
      if (gate?.latestDecisionAt && instant < gate.latestDecisionAt) throw manualError(409);
      for (const member of await ports.trips.groups.members(tx, [trip.id], true)) {
        const [previous] = await c(tx)
          .select()
          .from(manualReviewGates)
          .where(eq(manualReviewGates.tripId, member.id))
          .for("update");
        if (previous?.latestDecisionAt && previous.latestDecisionAt > instant)
          throw manualError(409);
        await c(tx)
          .insert(manualReviewGates)
          .values({ tripId: member.id, latestDecisionAt: instant, underReview: false })
          .onDuplicateKeyUpdate({ set: { latestDecisionAt: instant, underReview: false } });
      }
    },
    async reopenInTransaction(tx: TxContext, actor: Actor, tripId: string) {
      await ports.identity.authorizeInTransaction(tx, actor, "trips.review");
      const trip = await privateTrip(tx, actor, tripId);
      await ports.trips.manualGateInTransaction(tx, trip.ownerId, tripId);
      await gateTripEvidence(tx, tripId);
      for (const member of await ports.trips.groups.members(tx, [tripId], true))
        await c(tx)
          .insert(manualReviewGates)
          .values({ tripId: member.id, underReview: true })
          .onDuplicateKeyUpdate({ set: { underReview: true } });
    },
    reserveExpiry,
    recoverUpload,
    async maintenance(signal: AbortSignal) {
      if (!blobs) return "configuration_pending" as const;
      const processing = await run((tx) =>
        c(tx)
          .select({ id: manualEvidence.id })
          .from(manualEvidence)
          .where(and(eq(manualEvidence.state, "processing"), lte(manualEvidence.leaseUntil, at())))
          .orderBy(asc(manualEvidence.leaseUntil))
          .limit(25),
      );
      for (const row of processing) {
        signal.throwIfAborted();
        await recoverUpload(row.id, signal);
      }
      const ready = await run((tx) =>
        c(tx)
          .select({ id: manualEvidence.id })
          .from(manualEvidence)
          .where(and(eq(manualEvidence.state, "ready"), lte(manualEvidence.nextCheckAt, at())))
          .orderBy(asc(manualEvidence.nextCheckAt), asc(manualEvidence.id))
          .limit(25),
      );
      for (const row of ready) {
        signal.throwIfAborted();
        await reserveExpiry(row.id);
      }
      const deleting = await run((tx) =>
        c(tx)
          .select()
          .from(manualEvidence)
          .where(eq(manualEvidence.state, "deleting"))
          .orderBy(asc(manualEvidence.updatedAt))
          .limit(25),
      );
      for (const row of deleting)
        await run(async (tx) => {
          const [locked] = await c(tx)
            .select()
            .from(manualEvidence)
            .where(eq(manualEvidence.id, row.id))
            .for("update");
          if (locked?.state !== "deleting") return;
          const state = await queue.effectState(
            tx,
            handler.consumer,
            `evidence:${row.id}:${locked.deleteAttempt}`,
          );
          if (!state || state.state === "failed" || state.state === "completed")
            await enqueueDeletion(tx, locked);
        });
      await generationMaintenance(signal);
      return "complete" as const;
    },
  };
  async function validateSource(tx: TxContext, ownerId: string, payload: unknown, tripId: string) {
    const parsed = parseManualSource(payload),
      [revision] = await c(tx)
        .select()
        .from(manualRevisions)
        .where(eq(manualRevisions.id, parsed.revisionId))
        .for("share"),
      [report] = await c(tx)
        .select()
        .from(manualReports)
        .where(eq(manualReports.id, parsed.reportId))
        .for("share");
    if (
      !revision ||
      !report ||
      report.ownerId !== ownerId ||
      report.tripId !== tripId ||
      revision.reportId !== report.id ||
      revision.number !== parsed.revision
    )
      throw manualError(403);
    const expected =
      revision.format === "legacy"
        ? extendedLegacy(revision.fields as S["ManualInput"])
        : (revision.fields as S["ManualReportFields"]);
    const actual =
      "format" in parsed
        ? parsed.fields
        : {
            ...expected,
            game: parsed.game,
            cargoMassKg: parsed.cargoMassKg,
            actualDistanceM: parsed.actualDistanceM,
            evidenceIds: parsed.evidenceIds,
            origin: {
              status: "resolved",
              entityId: parsed.originId,
              catalogRevisionId: parsed.catalogRevisionId,
            },
            destination: {
              status: "resolved",
              entityId: parsed.destinationId,
              catalogRevisionId: parsed.catalogRevisionId,
            },
            cargo: {
              status: "resolved",
              entityId: parsed.cargoId,
              catalogRevisionId: parsed.catalogRevisionId,
            },
            trailerType: {
              status: "resolved",
              entityId: parsed.trailerTypeId,
              catalogRevisionId: parsed.catalogRevisionId,
            },
          };
    if (canonicalJson(expected) !== canonicalJson(actual)) throw manualError(403);
    await evidenceGate(tx, ownerId, expected.evidenceIds, true);
  }
  async function projection(tx: TxContext, tripIds: string[]) {
    if (tripIds.length > 100) throw Error("MANUAL_PROJECTION_BATCH_BOUND");
    const result = new Map<
      string,
      { manualRevision: S["ManualRevisionRead"] | null; evidence: S["Evidence"][] }
    >();
    if (!tripIds.length) return result;
    const members = await ports.trips.groups.members(tx, tripIds, "share");
    const group = new Map(members.map((t) => [t.id, t.aliasOf ?? t.id]));
    const originalIds = members.map((t) => t.id);
    const reports = await c(tx)
      .select()
      .from(manualReports)
      .where(inArray(manualReports.tripId, originalIds))
      .orderBy(desc(manualReports.createdAt), desc(manualReports.id))
      .for("share");
    const ids = reports.flatMap((r) => (r.currentRevisionId ? [r.currentRevisionId] : [])),
      revisions = ids.length
        ? await c(tx)
            .select()
            .from(manualRevisions)
            .where(inArray(manualRevisions.id, ids))
            .for("share")
        : [],
      refs = await c(tx)
        .select({ tripId: manualEvidenceReferences.tripId, evidence: manualEvidence })
        .from(manualEvidenceReferences)
        .innerJoin(manualEvidence, eq(manualEvidence.id, manualEvidenceReferences.evidenceId))
        .where(inArray(manualEvidenceReferences.tripId, originalIds))
        .for("share");
    for (const tripId of tripIds) {
      const report = reports.find((r) => group.get(r.tripId) === group.get(tripId)),
        revision = report ? revisions.find((r) => r.id === report.currentRevisionId) : null;
      const unique = new Map(
        refs
          .filter((r) => group.get(r.tripId) === group.get(tripId))
          .map((r) => [r.evidence.id, r.evidence]),
      );
      result.set(tripId, {
        manualRevision: revision ? revisionDto(revision) : null,
        evidence: [...unique.values()].map(evidenceDto),
      });
    }
    return result;
  }
  async function gateTripEvidence(tx: TxContext, tripId: string) {
    const refs = await c(tx)
      .select({ id: manualEvidenceReferences.evidenceId })
      .from(manualEvidenceReferences)
      .where(
        inArray(
          manualEvidenceReferences.tripId,
          (await ports.trips.groups.members(tx, [tripId], true)).map((t) => t.id),
        ),
      )
      .for("share");
    if (refs.length) {
      const rows = await c(tx)
        .select()
        .from(manualEvidence)
        .where(inArray(manualEvidence.id, [...new Set(refs.map((r) => r.id))].sort()))
        .orderBy(asc(manualEvidence.id))
        .for("update");
      if (rows.some((row) => row.state === "deleting")) throw transition();
    }
  }
  async function reserveExpiry(id: string): Promise<boolean> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const discover = await run((tx) =>
        c(tx)
          .select({ tripId: manualEvidenceReferences.tripId })
          .from(manualEvidenceReferences)
          .where(eq(manualEvidenceReferences.evidenceId, applicationId(id))),
      );
      const tripIds = [...new Set(discover.map((r) => r.tripId))].sort();
      const outcome = await run(async (tx) => {
        // Current shared trip locks fence decisions without granting a cleanup worker domain writes.
        if (tripIds.length)
          for (const owner of await ports.trips.contributions.owners(tx, tripIds))
            await ports.trips.prepareSourceInTransaction(tx, owner.ownerId, owner.game);
        // Keep discovery before the established owning lock boundary. Group expansion must
        // not take a trip/gap lock before callers can coordinate that boundary.
        if (tripIds.length) await ports.trips.statesInTransaction(tx, tripIds, "share");
        const members = tripIds.length
          ? await ports.trips.groups.members(tx, tripIds, "share")
          : [];
        const groupIds = members.map((t) => t.id);
        const roots = new Map(members.filter((t) => !t.aliasOf).map((t) => [t.id, t]));
        const states = members.map((t) => roots.get(t.aliasOf ?? t.id) ?? t);
        const [row] = await c(tx)
          .select()
          .from(manualEvidence)
          .where(eq(manualEvidence.id, id))
          .for("update");
        if (row?.state !== "ready") return false;
        const refs = await c(tx)
          .select({ tripId: manualEvidenceReferences.tripId })
          .from(manualEvidenceReferences)
          .where(eq(manualEvidenceReferences.evidenceId, id))
          .for("share");
        if (
          canonicalJson([...new Set(refs.map((r) => r.tripId))].sort()) !== canonicalJson(tripIds)
        )
          return "retry" as const;
        await c(tx)
          .update(manualEvidence)
          .set({ nextCheckAt: later(60000) })
          .where(eq(manualEvidence.id, id));
        if (tripIds.length) {
          const gates = await c(tx)
            .select()
            .from(manualReviewGates)
            .where(inArray(manualReviewGates.tripId, groupIds))
            .for("share");
          if (
            states.length !== groupIds.length ||
            gates.length !== groupIds.length ||
            states.some(
              (t) =>
                t.reviewHold ||
                t.correctionPending ||
                t.decision === "pending_review" ||
                t.decision === "unassessed",
            ) ||
            gates.some(
              (g) =>
                g.underReview ||
                !g.latestDecisionAt ||
                !calendarYearAfter(g.latestDecisionAt) ||
                (calendarYearAfter(g.latestDecisionAt) as string) > at(),
            )
          )
            return false;
        } else {
          if (row.updatedAt > new Date(now().getTime() - config.orphanGraceMs).toISOString())
            return false;
          const drafts = await c(tx)
            .select({ holdUntil: manualDraftEvidence.holdUntil })
            .from(manualDraftEvidence)
            .where(eq(manualDraftEvidence.evidenceId, id))
            .for("share");
          if (drafts.some((d) => d.holdUntil > at())) return false;
        }
        await enqueueDeletion(tx, row);
        return true;
      });
      if (outcome !== "retry") return outcome;
    }
    // Continuously changing discovery must not pin the first maintenance page.
    // This only defers another check; it never authorizes deletion.
    await run((tx) =>
      c(tx)
        .update(manualEvidence)
        .set({ nextCheckAt: later(60000) })
        .where(and(eq(manualEvidence.id, id), eq(manualEvidence.state, "ready"))),
    );
    console.warn(JSON.stringify({ event: "manual_retention_deferred", reason: "reference_churn" }));
    return false;
  }
}
export type ManualReports = ReturnType<typeof createManualReports>;
export async function manualCleanupPending(unit: UnitOfWork) {
  try {
    return await unit.run(
      async (tx) =>
        (
          await unit
            .client(tx)
            .select({ id: manualEvidence.id })
            .from(manualEvidence)
            .where(inArray(manualEvidence.state, ["processing", "ready", "deleting"]))
            .limit(1)
        ).length > 0 ||
        (
          await unit
            .client(tx)
            .select({ id: manualBlobGenerations.evidenceId })
            .from(manualBlobGenerations)
            .limit(1)
        ).length > 0,
    );
  } catch (error) {
    // A disabled feature may not yet have its additive schema/inspection grant.
    // Surface configuration pending rather than claiming there is no work.
    if (
      !unknownCommit(error) &&
      causes(error).some(
        (cause) =>
          "code" in cause &&
          ["ER_NO_SUCH_TABLE", "ER_TABLEACCESS_DENIED_ERROR"].includes(String(cause.code)),
      )
    )
      return true;
    throw error;
  }
}
