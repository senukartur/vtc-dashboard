import { createHash } from "node:crypto";
import {
  applicationId,
  opaqueUtf8,
  type TxContext,
  type UnitOfWork,
  utcDateTime,
  utcIso,
} from "@vtc/db";
import { eq, outboxEvents, outboxRouting, sql } from "@vtc/db/platform-schema";

export function closed(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).length !== keys.length ||
    Reflect.ownKeys(value).some(
      (key) =>
        typeof key !== "string" ||
        !keys.includes(key) ||
        !Object.getOwnPropertyDescriptor(value, key)?.enumerable ||
        !("value" in (Object.getOwnPropertyDescriptor(value, key) ?? {})),
    )
  ) {
    throw new Error("INVALID_CLOSED_INPUT");
  }
  return { ...value };
}
export function positive(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 2147483647)
    throw new Error("INVALID_VERSION");
  return value;
}
export const fingerprint = (value: unknown): Buffer =>
  createHash("sha256").update(JSON.stringify(value)).digest();
export function duplicateKey(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 8 && current && typeof current === "object"; depth++) {
    if ("code" in current && current.code === "ER_DUP_ENTRY") return true;
    current = "cause" in current ? current.cause : null;
  }
  return false;
}
export interface AccessEvent {
  eventId: string;
  type: "member.access_changed";
  schemaVersion: 1;
  aggregate: { kind: "member"; id: string; version: number };
  occurredAt: string;
  correlationId: string;
  causationId: string | null;
  data: { userId: string; accessEpoch: number; identityEpoch: number };
}
export interface AdmissionsEvent {
  eventId: string;
  type:
    | "application.submitted"
    | "application.decided"
    | "invitation.reissued"
    | "invitation.redeemed";
  schemaVersion: 1;
  aggregate: { kind: "application"; id: string; version: number };
  occurredAt: string;
  correlationId: string;
  causationId: string | null;
  data: { applicationId: string };
}
export interface CatalogEvent {
  eventId: string;
  type: "catalog.published";
  schemaVersion: 1;
  aggregate: { kind: "catalog"; id: string; version: number };
  occurredAt: string;
  correlationId: string;
  causationId: string | null;
  data: { catalogRevisionId: string };
}
export interface ReconciliationEvent {
  eventId: string;
  type: "trip.correction_recorded";
  schemaVersion: 1;
  aggregate: { kind: "trip"; id: string; version: number };
  occurredAt: string;
  correlationId: string;
  causationId: string | null;
  data: {
    reconciliationId: string;
    primaryTripId: string;
    secondaryTripId: string;
    reconciliationVersion: number;
  };
}
export function reconciliationEvent(value: unknown): ReconciliationEvent {
  const e = closed(value, [
      "eventId",
      "type",
      "schemaVersion",
      "aggregate",
      "occurredAt",
      "correlationId",
      "causationId",
      "data",
    ]),
    a = closed(e.aggregate, ["kind", "id", "version"]),
    d = closed(e.data, [
      "reconciliationId",
      "primaryTripId",
      "secondaryTripId",
      "reconciliationVersion",
    ]);
  if (
    e.type !== "trip.correction_recorded" ||
    e.schemaVersion !== 1 ||
    a.kind !== "trip" ||
    a.id !== d.primaryTripId ||
    d.primaryTripId === d.secondaryTripId
  )
    throw new Error("INVALID_RECONCILIATION_EVENT");
  return {
    eventId: applicationId(e.eventId as string),
    type: "trip.correction_recorded",
    schemaVersion: 1,
    aggregate: { kind: "trip", id: applicationId(a.id as string), version: positive(a.version) },
    occurredAt: utcIso(utcDateTime(e.occurredAt as string)),
    correlationId: applicationId(e.correlationId as string),
    causationId: e.causationId === null ? null : applicationId(e.causationId as string),
    data: {
      reconciliationId: applicationId(d.reconciliationId as string),
      primaryTripId: applicationId(d.primaryTripId as string),
      secondaryTripId: applicationId(d.secondaryTripId as string),
      reconciliationVersion: positive(d.reconciliationVersion),
    },
  };
}
export interface TripProposalReviewedEvent {
  eventId: string;
  type: "trip.proposal_reviewed";
  schemaVersion: 1;
  aggregate: { kind: "trip"; id: string; version: number };
  occurredAt: string;
  correlationId: string;
  causationId: string | null;
  data: { proposalId: string; reviewedRevisionId: string };
}
export function tripProposalReviewedEvent(value: unknown): TripProposalReviewedEvent {
  const e = closed(value, [
      "eventId",
      "type",
      "schemaVersion",
      "aggregate",
      "occurredAt",
      "correlationId",
      "causationId",
      "data",
    ]),
    a = closed(e.aggregate, ["kind", "id", "version"]),
    d = closed(e.data, ["proposalId", "reviewedRevisionId"]);
  if (e.type !== "trip.proposal_reviewed" || e.schemaVersion !== 1 || a.kind !== "trip")
    throw new Error("INVALID_TRIP_PROPOSAL_EVENT");
  return {
    eventId: applicationId(e.eventId as string),
    type: "trip.proposal_reviewed",
    schemaVersion: 1,
    aggregate: { kind: "trip", id: applicationId(a.id as string), version: positive(a.version) },
    occurredAt: utcIso(utcDateTime(e.occurredAt as string)),
    correlationId: applicationId(e.correlationId as string),
    causationId: e.causationId === null ? null : applicationId(e.causationId as string),
    data: {
      proposalId: applicationId(d.proposalId as string),
      reviewedRevisionId: applicationId(d.reviewedRevisionId as string),
    },
  };
}
export interface TripDecisionEvent {
  eventId: string;
  type: "trip.decision_changed";
  schemaVersion: 1;
  aggregate: { kind: "trip"; id: string; version: number };
  occurredAt: string;
  correlationId: string;
  causationId: string | null;
  data: { decisionId: string; contributionVersion: number };
}
export function tripDecisionEvent(value: unknown): TripDecisionEvent {
  const e = closed(value, [
      "eventId",
      "type",
      "schemaVersion",
      "aggregate",
      "occurredAt",
      "correlationId",
      "causationId",
      "data",
    ]),
    a = closed(e.aggregate, ["kind", "id", "version"]),
    d = closed(e.data, ["decisionId", "contributionVersion"]);
  if (e.type !== "trip.decision_changed" || e.schemaVersion !== 1 || a.kind !== "trip")
    throw new Error("INVALID_TRIP_DECISION_EVENT");
  return {
    eventId: applicationId(e.eventId as string),
    type: "trip.decision_changed",
    schemaVersion: 1,
    aggregate: { kind: "trip", id: applicationId(a.id as string), version: positive(a.version) },
    occurredAt: utcIso(utcDateTime(e.occurredAt as string)),
    correlationId: applicationId(e.correlationId as string),
    causationId: e.causationId === null ? null : applicationId(e.causationId as string),
    data: {
      decisionId: applicationId(d.decisionId as string),
      contributionVersion: positive(d.contributionVersion),
    },
  };
}
export interface TripEvent {
  eventId: string;
  type: "source.snapshot_stored" | "trip.lifecycle_changed" | "trip.facts_changed";
  schemaVersion: 1;
  aggregate: { kind: "source" | "trip"; id: string; version: number };
  occurredAt: string;
  correlationId: string;
  causationId: string | null;
  data: { sourceRecordId: string; tripId: string; factRevisionId: string };
}
export interface ManualEvent {
  eventId: string;
  type: "manual.draft_saved" | "manual.report_submitted" | "manual.correction_requested";
  schemaVersion: 1;
  aggregate: { kind: "manual_draft" | "manual_report" | "trip"; id: string; version: number };
  occurredAt: string;
  correlationId: string;
  causationId: null;
  data: { resourceId: string; tripId: string | null };
}
export function manualEvent(value: unknown): ManualEvent {
  const p = closed(value, [
      "eventId",
      "type",
      "schemaVersion",
      "aggregate",
      "occurredAt",
      "correlationId",
      "causationId",
      "data",
    ]),
    a = closed(p.aggregate, ["kind", "id", "version"]),
    d = closed(p.data, ["resourceId", "tripId"]);
  const kinds = {
    "manual.draft_saved": "manual_draft",
    "manual.report_submitted": "manual_report",
    "manual.correction_requested": "trip",
  };
  if (
    !Object.hasOwn(kinds, p.type as string) ||
    a.kind !== kinds[p.type as keyof typeof kinds] ||
    p.schemaVersion !== 1 ||
    p.causationId !== null ||
    (p.type === "manual.draft_saved" && d.tripId !== null) ||
    (p.type !== "manual.draft_saved" && d.tripId === null)
  )
    throw new Error("INVALID_MANUAL_EVENT");
  return {
    eventId: applicationId(p.eventId as string),
    type: p.type as ManualEvent["type"],
    schemaVersion: 1,
    aggregate: {
      kind: a.kind as ManualEvent["aggregate"]["kind"],
      id: applicationId(a.id as string),
      version: positive(a.version),
    },
    occurredAt: utcIso(utcDateTime(p.occurredAt as string)),
    correlationId: applicationId(p.correlationId as string),
    causationId: null,
    data: {
      resourceId: applicationId(d.resourceId as string),
      tripId: d.tripId === null ? null : applicationId(d.tripId as string),
    },
  };
}
export function tripEvent(value: unknown): TripEvent {
  const e = closed(value, [
    "eventId",
    "type",
    "schemaVersion",
    "aggregate",
    "occurredAt",
    "correlationId",
    "causationId",
    "data",
  ]);
  const a = closed(e.aggregate, ["kind", "id", "version"]),
    d = closed(e.data, ["sourceRecordId", "tripId", "factRevisionId"]);
  const source = e.type === "source.snapshot_stored";
  if (
    !["source.snapshot_stored", "trip.lifecycle_changed", "trip.facts_changed"].includes(
      e.type as string,
    ) ||
    e.schemaVersion !== 1 ||
    a.kind !== (source ? "source" : "trip") ||
    a.id !== (source ? d.sourceRecordId : d.tripId) ||
    typeof e.occurredAt !== "string"
  )
    throw new Error("UNSUPPORTED_EVENT");
  return {
    eventId: applicationId(e.eventId as string),
    type: e.type as TripEvent["type"],
    schemaVersion: 1,
    aggregate: {
      kind: source ? "source" : "trip",
      id: applicationId(a.id as string),
      version: positive(a.version),
    },
    occurredAt: utcIso(utcDateTime(e.occurredAt)),
    correlationId: applicationId(e.correlationId as string),
    causationId: e.causationId === null ? null : applicationId(e.causationId as string),
    data: {
      sourceRecordId: applicationId(d.sourceRecordId as string),
      tripId: applicationId(d.tripId as string),
      factRevisionId: applicationId(d.factRevisionId as string),
    },
  };
}
export function catalogEvent(value: unknown): CatalogEvent {
  const e = closed(value, [
      "eventId",
      "type",
      "schemaVersion",
      "aggregate",
      "occurredAt",
      "correlationId",
      "causationId",
      "data",
    ]),
    a = closed(e.aggregate, ["kind", "id", "version"]),
    d = closed(e.data, ["catalogRevisionId"]);
  if (
    e.type !== "catalog.published" ||
    e.schemaVersion !== 1 ||
    a.kind !== "catalog" ||
    a.id !== d.catalogRevisionId ||
    typeof e.occurredAt !== "string"
  )
    throw new Error("UNSUPPORTED_EVENT");
  return {
    eventId: applicationId(e.eventId as string),
    type: "catalog.published",
    schemaVersion: 1,
    aggregate: { kind: "catalog", id: applicationId(a.id as string), version: positive(a.version) },
    occurredAt: utcIso(utcDateTime(e.occurredAt)),
    correlationId: applicationId(e.correlationId as string),
    causationId: e.causationId === null ? null : applicationId(e.causationId as string),
    data: { catalogRevisionId: applicationId(d.catalogRevisionId as string) },
  };
}
export function admissionsEvent(value: unknown): AdmissionsEvent {
  const e = closed(value, [
    "eventId",
    "type",
    "schemaVersion",
    "aggregate",
    "occurredAt",
    "correlationId",
    "causationId",
    "data",
  ]);
  const a = closed(e.aggregate, ["kind", "id", "version"]),
    d = closed(e.data, ["applicationId"]);
  if (
    ![
      "application.submitted",
      "application.decided",
      "invitation.reissued",
      "invitation.redeemed",
    ].includes(e.type as string) ||
    e.schemaVersion !== 1 ||
    a.kind !== "application" ||
    a.id !== d.applicationId ||
    typeof e.occurredAt !== "string"
  )
    throw new Error("UNSUPPORTED_EVENT");
  return {
    eventId: applicationId(e.eventId as string),
    type: e.type as AdmissionsEvent["type"],
    schemaVersion: 1,
    aggregate: {
      kind: "application",
      id: applicationId(a.id as string),
      version: positive(a.version),
    },
    occurredAt: utcIso(utcDateTime(e.occurredAt)),
    correlationId: applicationId(e.correlationId as string),
    causationId: e.causationId === null ? null : applicationId(e.causationId as string),
    data: { applicationId: applicationId(d.applicationId as string) },
  };
}
export function accessEvent(value: unknown): AccessEvent {
  const e = closed(value, [
    "eventId",
    "type",
    "schemaVersion",
    "aggregate",
    "occurredAt",
    "correlationId",
    "causationId",
    "data",
  ]);
  const a = closed(e.aggregate, ["kind", "id", "version"]);
  const d = closed(e.data, ["userId", "accessEpoch", "identityEpoch"]);
  if (
    e.type !== "member.access_changed" ||
    e.schemaVersion !== 1 ||
    typeof e.occurredAt !== "string" ||
    a.kind !== "member" ||
    d.userId !== a.id
  )
    throw new Error("UNSUPPORTED_EVENT");
  return {
    eventId: applicationId(e.eventId as string),
    type: "member.access_changed",
    schemaVersion: 1,
    aggregate: { kind: "member", id: applicationId(a.id as string), version: positive(a.version) },
    occurredAt: utcIso(utcDateTime(e.occurredAt as string)),
    correlationId: applicationId(e.correlationId as string),
    causationId: e.causationId === null ? null : applicationId(e.causationId as string),
    data: {
      userId: applicationId(d.userId as string),
      accessEpoch: positive(d.accessEpoch),
      identityEpoch: positive(d.identityEpoch),
    },
  };
}
export interface QualificationEvent {
  eventId: string;
  type:
    | "qualification.rules_changed"
    | "qualification.assigned"
    | "qualification.promoted"
    | "qualification.progress_changed"
    | "promotion.review_required";
  schemaVersion: 1;
  aggregate: { kind: "qualification"; id: string; version: number };
  occurredAt: string;
  correlationId: string;
  causationId: string | null;
  data: { userId: string | null; assignmentId: string | null };
}
export function qualificationEvent(value: unknown): QualificationEvent {
  const e = closed(value, [
      "eventId",
      "type",
      "schemaVersion",
      "aggregate",
      "occurredAt",
      "correlationId",
      "causationId",
      "data",
    ]),
    a = closed(e.aggregate, ["kind", "id", "version"]),
    d = closed(e.data, ["userId", "assignmentId"]);
  if (
    ![
      "qualification.rules_changed",
      "qualification.assigned",
      "qualification.promoted",
      "qualification.progress_changed",
      "promotion.review_required",
    ].includes(e.type as string) ||
    e.schemaVersion !== 1 ||
    a.kind !== "qualification" ||
    typeof e.occurredAt !== "string" ||
    (e.type === "qualification.rules_changed"
      ? d.userId !== null || d.assignmentId !== null
      : d.userId === null || d.assignmentId === null)
  )
    throw new Error("UNSUPPORTED_EVENT");
  return {
    eventId: applicationId(e.eventId as string),
    type: e.type as QualificationEvent["type"],
    schemaVersion: 1,
    aggregate: {
      kind: "qualification",
      id: applicationId(a.id as string),
      version: positive(a.version),
    },
    occurredAt: utcIso(utcDateTime(e.occurredAt)),
    correlationId: applicationId(e.correlationId as string),
    causationId: e.causationId === null ? null : applicationId(e.causationId as string),
    data: {
      userId: d.userId === null ? null : applicationId(d.userId as string),
      assignmentId: d.assignmentId === null ? null : applicationId(d.assignmentId as string),
    },
  };
}
export interface CompanyEvent {
  eventId: string;
  type: "event.changed" | "event.response_changed" | "event.attendance_changed";
  schemaVersion: 1;
  aggregate: { kind: "event" | "event_response" | "event_attendance"; id: string; version: number };
  occurredAt: string;
  correlationId: string;
  causationId: string | null;
  data: {
    eventId: string;
    eventRevisionId: string;
    revisionId: string;
    changeSequence: number;
    memberId: string | null;
    category: "created" | "updated" | "cancelled" | "response" | "attendance";
  };
}
export function companyEvent(value: unknown): CompanyEvent {
  const e = closed(value, [
      "eventId",
      "type",
      "schemaVersion",
      "aggregate",
      "occurredAt",
      "correlationId",
      "causationId",
      "data",
    ]),
    a = closed(e.aggregate, ["kind", "id", "version"]),
    d = closed(e.data, [
      "eventId",
      "eventRevisionId",
      "revisionId",
      "changeSequence",
      "memberId",
      "category",
    ]);
  const kind =
    e.type === "event.changed"
      ? "event"
      : e.type === "event.response_changed"
        ? "event_response"
        : e.type === "event.attendance_changed"
          ? "event_attendance"
          : null;
  if (
    !kind ||
    e.schemaVersion !== 1 ||
    a.kind !== kind ||
    typeof e.occurredAt !== "string" ||
    (kind !== "event_response" && a.id !== d.eventId) ||
    (kind === "event_response"
      ? d.memberId === null || d.category !== "response"
      : d.memberId !== null) ||
    (kind === "event"
      ? !["created", "updated", "cancelled"].includes(d.category as string)
      : kind === "event_attendance" && d.category !== "attendance")
  )
    throw new Error("UNSUPPORTED_EVENT");
  return {
    eventId: applicationId(e.eventId as string),
    type: e.type as CompanyEvent["type"],
    schemaVersion: 1,
    aggregate: { kind, id: applicationId(a.id as string), version: positive(a.version) },
    occurredAt: utcIso(utcDateTime(e.occurredAt)),
    correlationId: applicationId(e.correlationId as string),
    causationId: e.causationId === null ? null : applicationId(e.causationId as string),
    data: {
      eventId: applicationId(d.eventId as string),
      eventRevisionId: applicationId(d.eventRevisionId as string),
      revisionId: applicationId(d.revisionId as string),
      changeSequence: positive(d.changeSequence),
      memberId: d.memberId === null ? null : applicationId(d.memberId as string),
      category: d.category as CompanyEvent["data"]["category"],
    },
  };
}
export type DomainEvent =
  | AccessEvent
  | AdmissionsEvent
  | CatalogEvent
  | ReconciliationEvent
  | TripProposalReviewedEvent
  | TripDecisionEvent
  | TripEvent
  | ManualEvent
  | QualificationEvent
  | CompanyEvent;
export const notificationEventTypes = [
  "member.access_changed",
  "application.submitted",
  "application.decided",
  "trip.lifecycle_changed",
  "trip.decision_changed",
  "manual.report_submitted",
  "manual.correction_requested",
  "qualification.assigned",
  "qualification.promoted",
  "qualification.progress_changed",
  "promotion.review_required",
  "event.changed",
  "event.response_changed",
] as const;
export function domainEvent(input: unknown): DomainEvent {
  const e = closed(input, [
    "eventId",
    "type",
    "schemaVersion",
    "aggregate",
    "occurredAt",
    "correlationId",
    "causationId",
    "data",
  ]);
  switch (e.type) {
    case "member.access_changed":
      return accessEvent(input);
    case "application.submitted":
    case "application.decided":
    case "invitation.reissued":
    case "invitation.redeemed":
      return admissionsEvent(input);
    case "catalog.published":
      return catalogEvent(input);
    case "trip.correction_recorded":
      return reconciliationEvent(input);
    case "trip.proposal_reviewed":
      return tripProposalReviewedEvent(input);
    case "trip.decision_changed":
      return tripDecisionEvent(input);
    case "source.snapshot_stored":
    case "trip.lifecycle_changed":
    case "trip.facts_changed":
      return tripEvent(input);
    case "manual.draft_saved":
    case "manual.report_submitted":
    case "manual.correction_requested":
      return manualEvent(input);
    case "qualification.rules_changed":
    case "qualification.assigned":
    case "qualification.promoted":
    case "qualification.progress_changed":
    case "promotion.review_required":
      return qualificationEvent(input);
    case "event.changed":
    case "event.response_changed":
    case "event.attendance_changed":
      return companyEvent(input);
    default:
      throw new Error("UNSUPPORTED_EVENT");
  }
}
export function decodeStoredEvent(e: typeof outboxEvents.$inferSelect): DomainEvent {
  return domainEvent({
    eventId: e.id,
    type: e.type.toString(),
    schemaVersion: e.schemaVersion,
    aggregate: { kind: e.aggregateKind.toString(), id: e.aggregateId, version: e.aggregateVersion },
    occurredAt: e.occurredAt,
    correlationId: e.correlationId,
    causationId: e.causationId,
    data: e.data,
  });
}
export function createOutbox(unit: UnitOfWork, options: { notifications?: boolean } = {}) {
  return {
    async readInTransaction(tx: TxContext, id: string) {
      const [row] = await unit
        .client(tx)
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.id, applicationId(id)))
        .for("share");
      if (!row) throw new Error("EVENT_MISSING");
      return decodeStoredEvent(row);
    },
    async append(
      tx: TxContext,
      input:
        | TripProposalReviewedEvent
        | TripDecisionEvent
        | ReconciliationEvent
        | AccessEvent
        | AdmissionsEvent
        | CatalogEvent
        | TripEvent
        | ManualEvent
        | QualificationEvent
        | CompanyEvent,
    ): Promise<void> {
      const client = unit.client(tx);
      const e =
        input.type === "trip.proposal_reviewed"
          ? tripProposalReviewedEvent(input)
          : input.type === "trip.decision_changed"
            ? tripDecisionEvent(input)
            : input.type === "trip.correction_recorded"
              ? reconciliationEvent(input)
              : input.type.startsWith("manual.")
                ? manualEvent(input)
                : input.type === "member.access_changed"
                  ? accessEvent(input)
                  : input.type === "catalog.published"
                    ? catalogEvent(input)
                    : [
                          "source.snapshot_stored",
                          "trip.lifecycle_changed",
                          "trip.facts_changed",
                        ].includes(input.type)
                      ? tripEvent(input)
                      : input.type.startsWith("qualification.") ||
                          input.type === "promotion.review_required"
                        ? qualificationEvent(input)
                        : input.type.startsWith("event.")
                          ? companyEvent(input)
                          : admissionsEvent(input);
      const hash = fingerprint(e);
      // MySQL rolls back the duplicate statement only; lock/read its durable identity.
      // Immutable evidence needs no UPDATE/DELETE privilege.
      let inserted = false;
      try {
        await client.insert(outboxEvents).values({
          id: e.eventId,
          type: opaqueUtf8(e.type, 64),
          schemaVersion: e.schemaVersion,
          aggregateKind: opaqueUtf8(e.aggregate.kind, 32),
          aggregateId: e.aggregate.id,
          aggregateVersion: e.aggregate.version,
          occurredAt: e.occurredAt,
          correlationId: e.correlationId,
          causationId: e.causationId,
          data: e.data,
          fingerprint: hash,
          recordedAt: sql`UTC_TIMESTAMP(3)`,
        });
        inserted = true;
      } catch (error) {
        if (!duplicateKey(error)) throw error;
      }
      const [saved] = await client
        .select({ fingerprint: outboxEvents.fingerprint, recordedAt: outboxEvents.recordedAt })
        .from(outboxEvents)
        .where(eq(outboxEvents.id, e.eventId))
        .for("share");
      if (!saved?.fingerprint.equals(hash)) throw new Error("EVENT_IDENTITY_CONFLICT");
      if (
        options.notifications &&
        inserted &&
        notificationEventTypes.some((type) => type === e.type)
      )
        await client.insert(outboxRouting).values({
          eventId: e.eventId,
          consumer: opaqueUtf8("notifications.v1", 64),
          eventType: opaqueUtf8(e.type, 64),
          recordedAt: saved.recordedAt,
        });
    },
  };
}
export function catalogEvents(
  unit: UnitOfWork,
  outbox: Pick<ReturnType<typeof createOutbox>, "append"> = createOutbox(unit),
) {
  return {
    async append(
      tx: TxContext,
      e: { eventId: string; revisionId: string; version: number; occurredAt: string },
    ) {
      await outbox.append(tx, {
        eventId: e.eventId,
        type: "catalog.published",
        schemaVersion: 1,
        aggregate: { kind: "catalog", id: e.revisionId, version: e.version },
        occurredAt: e.occurredAt,
        correlationId: e.eventId,
        causationId: null,
        data: { catalogRevisionId: e.revisionId },
      });
    },
  };
}
export function admissionsEvents(
  unit: UnitOfWork,
  outbox: Pick<ReturnType<typeof createOutbox>, "append"> = createOutbox(unit),
) {
  return {
    async append(
      tx: TxContext,
      e: {
        eventId: string;
        type: AdmissionsEvent["type"];
        applicationId: string;
        version: number;
        occurredAt: string;
      },
    ) {
      await outbox.append(tx, {
        eventId: e.eventId,
        type: e.type,
        schemaVersion: 1,
        aggregate: { kind: "application", id: e.applicationId, version: e.version },
        occurredAt: e.occurredAt,
        correlationId: e.eventId,
        causationId: null,
        data: { applicationId: e.applicationId },
      });
    },
  };
}
export function identityAccessEvents(
  unit: UnitOfWork,
  outbox: Pick<ReturnType<typeof createOutbox>, "append"> = createOutbox(unit),
) {
  return {
    async append(
      tx: TxContext,
      e: {
        eventId: string;
        type: "member.access_changed";
        userId: string;
        version: number;
        accessEpoch: number;
        identityEpoch: number;
        occurredAt: string;
      },
    ) {
      await outbox.append(tx, {
        eventId: e.eventId,
        type: e.type,
        schemaVersion: 1,
        aggregate: { kind: "member", id: e.userId, version: e.version },
        occurredAt: e.occurredAt,
        correlationId: e.eventId,
        causationId: null,
        data: { userId: e.userId, accessEpoch: e.accessEpoch, identityEpoch: e.identityEpoch },
      });
    },
  };
}
