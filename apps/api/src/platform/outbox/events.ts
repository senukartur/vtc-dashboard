import { createHash } from "node:crypto";
import {
  applicationId,
  opaqueUtf8,
  type TxContext,
  type UnitOfWork,
  utcDateTime,
  utcIso,
} from "@vtc/db";
import { eq, outboxEvents, sql } from "@vtc/db/platform-schema";

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
export function createOutbox(unit: UnitOfWork) {
  return {
    async append(tx: TxContext, input: AccessEvent | AdmissionsEvent): Promise<void> {
      const client = unit.client(tx);
      const e =
        input.type === "member.access_changed" ? accessEvent(input) : admissionsEvent(input);
      const hash = fingerprint(e);
      // MySQL rolls back the duplicate statement only; lock/read its durable identity.
      // Immutable evidence needs no UPDATE/DELETE privilege.
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
      } catch (error) {
        if (!duplicateKey(error)) throw error;
      }
      const [saved] = await client
        .select({ fingerprint: outboxEvents.fingerprint })
        .from(outboxEvents)
        .where(eq(outboxEvents.id, e.eventId))
        .for("share");
      if (!saved?.fingerprint.equals(hash)) throw new Error("EVENT_IDENTITY_CONFLICT");
    },
  };
}
export function admissionsEvents(unit: UnitOfWork) {
  const outbox = createOutbox(unit);
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
export function identityAccessEvents(unit: UnitOfWork) {
  const outbox = createOutbox(unit);
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
