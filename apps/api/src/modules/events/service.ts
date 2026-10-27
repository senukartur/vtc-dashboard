import { createHmac, timingSafeEqual } from "node:crypto";
import type { components } from "@vtc/contracts";
import {
  applicationId,
  createAudit,
  decimal38_18,
  newId,
  type TxContext,
  type UnitOfWork,
  utcDateTime,
  utcIso,
} from "@vtc/db";
import {
  and,
  asc,
  eq,
  eventAttendanceRevisions,
  eventAttendances,
  eventCatalogPins,
  eventCommands,
  eventResponseRevisions,
  eventResponses,
  eventRevisions,
  events,
  gt,
  gte,
  inArray,
  lt,
  or,
  sql,
} from "@vtc/db/events-schema";
import type { SQLWrapper } from "drizzle-orm";
import { causes, retryTransaction, unknownCommit } from "../../platform/jobs/queue.js";
import { type CompanyEvent, closed, createOutbox } from "../../platform/outbox/events.js";
import type { Catalogs } from "../catalogs/service.js";
import { type Actor, type Identity, identityError } from "../identity/service.js";
import type { ConfirmedEventContext } from "../qualification-rules/contracts.js";
import { canonicalJson, decimal } from "../sources/contracts/canonical.js";
import { type Page, pagination } from "./pagination.js";

type S = components["schemas"];
type Event = typeof events.$inferSelect;
type Revision = typeof eventRevisions.$inferSelect;
type ResponseRevision = typeof eventResponseRevisions.$inferSelect;
type AttendanceRevision = typeof eventAttendanceRevisions.$inferSelect;
type Route = typeof eventCommands.$inferSelect.route;
type Receipt = typeof eventCommands.$inferSelect.result & {
  responseRevisionId?: string | null;
  attendanceRevisionId?: string | null;
};
type Pin = typeof eventCatalogPins.$inferInsert;
export interface EventsConfig {
  cursorKey: string;
}
export function validateEventsConfig(config: EventsConfig) {
  if (!/^[0-9a-f]{64}$/.test(config.cursorKey)) throw new Error("INVALID_EVENTS_CONFIG");
}
interface Ports {
  identity: Pick<
    Identity,
    "eventContextInTransaction" | "eventRosterInTransaction" | "memberSummariesInTransaction"
  >;
  catalogs?: Pick<Catalogs, "eventReferencesInTransaction">;
  outbox?: Pick<ReturnType<typeof createOutbox>, "append">;
  tripChanged?: (tx: TxContext, eventId: string, generation: number) => Promise<void>;
  notificationChanged?: (tx: TxContext, eventId: string, memberId: string | null) => Promise<void>;
}
export function createEvents(
  unit: UnitOfWork,
  config: EventsConfig,
  ports: Ports,
  now = () => new Date(),
) {
  validateEventsConfig(config);
  const c = (tx: TxContext) => unit.client(tx),
    run = <T>(command: (tx: TxContext) => Promise<T>) =>
      retryTransaction(unit, command).catch((error) => {
        if (
          !unknownCommit(error) &&
          causes(error).some(
            (e) =>
              "code" in e &&
              [
                "ER_LOCK_WAIT_TIMEOUT",
                "ER_LOCK_DEADLOCK",
                "ECONNREFUSED",
                "ECONNRESET",
                "PROTOCOL_CONNECTION_LOST",
                "ETIMEDOUT",
                "PROTOCOL_SEQUENCE_TIMEOUT",
              ].includes(String(e.code)),
          )
        )
          throw identityError(503);
        throw error;
      }),
    at = () => now().toISOString(),
    audit = createAudit(unit),
    outbox = ports.outbox ?? createOutbox(unit),
    page = pagination(config.cursorKey, now);
  const authorize = (
    tx: TxContext,
    actor: Actor,
    capability = "company.read",
    targets: string[] = [],
  ) => ports.identity.eventContextInTransaction(tx, actor, targets, capability);
  function date(value: string) {
    try {
      const normalized = utcIso(utcDateTime(value));
      if (normalized !== value) throw new Error("NONCANONICAL_EVENT_TIME");
      return normalized;
    } catch {
      throw identityError(422);
    }
  }
  function text(value: unknown, max: number): asserts value is string {
    if (typeof value !== "string" || !value.trim() || value.length > max) throw identityError(422);
  }
  function input(raw: S["EventInput"]) {
    try {
      closed(raw, [
        "title",
        "description",
        "game",
        "server",
        "organizer",
        "meetingLocation",
        "route",
        "meetingAt",
        "startsAt",
        "endsAt",
        "visibility",
        "originCityId",
        "destinationCityId",
        "prescribedCargoId",
        "prescribedMassKg",
        "prescribedTrailerTypeId",
      ]);
    } catch {
      throw identityError(422);
    }
    for (const k of ["title", "server", "organizer"] as const) text(raw[k], 256);
    text(raw.description, 8000);
    text(raw.meetingLocation, 2048);
    text(raw.route, 2048);
    if (!["ets2", "ats"].includes(raw.game) || !["public", "members"].includes(raw.visibility))
      throw identityError(422);
    const meetingAt = date(raw.meetingAt),
      startsAt = date(raw.startsAt),
      endsAt = raw.endsAt === null ? null : date(raw.endsAt);
    if (meetingAt > startsAt || (endsAt !== null && endsAt < startsAt)) throw identityError(422);
    let mass = null;
    try {
      mass = raw.prescribedMassKg === null ? null : decimal(decimal38_18(raw.prescribedMassKg));
      if (mass?.startsWith("-")) throw new Error();
      for (const k of [
        "originCityId",
        "destinationCityId",
        "prescribedCargoId",
        "prescribedTrailerTypeId",
      ] as const)
        if (raw[k] !== null) applicationId(raw[k]);
    } catch {
      throw identityError(422);
    }
    return { ...raw, meetingAt, startsAt, endsAt, prescribedMassKg: mass };
  }
  async function lock(tx: TxContext, id: string, publicOnly = false) {
    const [row] = await c(tx)
      .select()
      .from(events)
      .where(eq(events.id, applicationId(id)))
      .for("update");
    if (!row || (publicOnly && row.visibility !== "public")) throw identityError(404);
    return row;
  }
  async function revision(tx: TxContext, id: string) {
    const [row] = await c(tx)
      .select()
      .from(eventRevisions)
      .where(eq(eventRevisions.id, applicationId(id)))
      .for("share");
    if (!row) throw new Error("EVENT_REVISION_MISSING");
    return row;
  }
  async function pins(tx: TxContext, r: S["EventInput"]): Promise<Omit<Pin, "revisionId">[]> {
    const selections = [
      { field: "origin", kind: "city", id: r.originCityId },
      { field: "destination", kind: "city", id: r.destinationCityId },
      { field: "cargo", kind: "cargo", id: r.prescribedCargoId },
      { field: "trailer", kind: "trailer_type", id: r.prescribedTrailerTypeId },
    ].filter(
      (s): s is { field: string; kind: "city" | "cargo" | "trailer_type"; id: string } =>
        s.id !== null,
    );
    if (!selections.length) return [];
    if (!ports.catalogs) throw identityError(503);
    const selected = await ports.catalogs.eventReferencesInTransaction(tx, r.game, selections);
    if (!selected) throw identityError(422);
    return selected.map((p) => ({ ...p, field: p.field as Pin["field"] }));
  }
  async function publicDto(
    tx: TxContext,
    r: Revision,
    knownPins?: (typeof eventCatalogPins.$inferSelect)[],
  ): Promise<S["EventPublic"]> {
    const references =
      knownPins ??
      (await c(tx).select().from(eventCatalogPins).where(eq(eventCatalogPins.revisionId, r.id)));
    return {
      id: r.eventId,
      version: r.version,
      title: r.title,
      description: r.description,
      game: r.game,
      server: r.server,
      organizer: r.organizer,
      meetingLocation: r.meetingLocation,
      route: r.route,
      meetingAt: r.meetingAt,
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      status: r.status,
      origin: references.find((p) => p.field === "origin")?.label ?? null,
      destination: references.find((p) => p.field === "destination")?.label ?? null,
    };
  }
  async function response(tx: TxContext, eventId: string, memberId: string) {
    const [row] = await c(tx)
      .select()
      .from(eventResponses)
      .where(and(eq(eventResponses.eventId, eventId), eq(eventResponses.memberId, memberId)))
      .for("update");
    if (!row) return null;
    const [r] = await c(tx)
      .select()
      .from(eventResponseRevisions)
      .where(eq(eventResponseRevisions.id, row.currentRevisionId));
    if (
      !r ||
      r.eventId !== eventId ||
      r.memberId !== memberId ||
      r.responseId !== row.id ||
      r.version !== row.version ||
      r.status !== row.status
    )
      throw new Error("EVENT_RESPONSE_REVISION_MISSING");
    return { row, revision: r };
  }
  const responseDto = (r: ResponseRevision | null): S["Rsvp"] => ({
    version: r?.version ?? 1,
    response: r?.status ?? "unanswered",
    declineReason: r?.reason ?? null,
  });
  async function attendance(tx: TxContext, eventId: string, memberId: string) {
    const [row] = await c(tx)
      .select()
      .from(eventAttendances)
      .where(and(eq(eventAttendances.eventId, eventId), eq(eventAttendances.memberId, memberId)))
      .for("share");
    if (!row) return null;
    const [r] = await c(tx)
      .select()
      .from(eventAttendanceRevisions)
      .where(eq(eventAttendanceRevisions.id, row.currentRevisionId))
      .for("share");
    if (!r || r.eventId !== eventId || r.memberId !== memberId)
      throw new Error("EVENT_ATTENDANCE_REVISION_MISSING");
    return r;
  }
  async function memberDto(
    tx: TxContext,
    r: Revision,
    actor: Actor,
    receipt?: Receipt,
  ): Promise<S["EventMember"]> {
    const references = await c(tx)
      .select()
      .from(eventCatalogPins)
      .where(eq(eventCatalogPins.revisionId, r.id))
      .for("share");
    let ownResponse: ResponseRevision | null, ownAttendance: AttendanceRevision | null;
    if (receipt) {
      const [rr] = receipt.responseRevisionId
        ? await c(tx)
            .select()
            .from(eventResponseRevisions)
            .where(eq(eventResponseRevisions.id, receipt.responseRevisionId))
        : [];
      const [ar] = receipt.attendanceRevisionId
        ? await c(tx)
            .select()
            .from(eventAttendanceRevisions)
            .where(eq(eventAttendanceRevisions.id, receipt.attendanceRevisionId))
        : [];
      ownResponse = rr ?? null;
      ownAttendance = ar ?? null;
    } else {
      ownResponse = (await response(tx, r.eventId, actor.userId))?.revision ?? null;
      ownAttendance = await attendance(tx, r.eventId, actor.userId);
    }
    return {
      event: await publicDto(tx, r),
      visibility: r.visibility,
      myResponse: responseDto(ownResponse),
      myAttendance: ownAttendance?.status ?? "unconfirmed",
      prescribedCargoId: references.find((p) => p.field === "cargo")?.entityId ?? null,
      prescribedMassKg: r.prescribedMassKg === null ? null : decimal(r.prescribedMassKg),
      prescribedTrailerTypeId: references.find((p) => p.field === "trailer")?.entityId ?? null,
    };
  }
  function fingerprint(actor: Actor, route: Route, target: string, key: string, value: unknown) {
    return createHmac("sha256", Buffer.from(config.cursorKey, "hex"))
      .update("events/command/v1\0")
      .update(canonicalJson([actor.userId, route, target, key, value]))
      .digest();
  }
  async function once(
    tx: TxContext,
    actor: Actor,
    route: Route,
    target: string,
    key: string,
    value: unknown,
    command: () => Promise<Receipt>,
  ) {
    applicationId(key);
    const hash = fingerprint(actor, route, target, key, value);
    const [saved] = await c(tx)
      .select()
      .from(eventCommands)
      .where(
        and(
          eq(eventCommands.actorId, actor.userId),
          eq(eventCommands.route, route),
          eq(eventCommands.targetId, target),
          eq(eventCommands.key, key),
        ),
      )
      .for("share");
    if (saved) {
      if (!timingSafeEqual(saved.fingerprint, hash))
        throw identityError(409, "IDEMPOTENCY_CONFLICT");
      return saved.result;
    }
    const rawResult = await command();
    const result: Receipt =
      route === "create" || route === "update" || route === "cancel"
        ? {
            ...rawResult,
            responseRevisionId:
              (await response(tx, rawResult.eventId, actor.userId))?.revision.id ?? null,
            attendanceRevisionId:
              (await attendance(tx, rawResult.eventId, actor.userId))?.id ?? null,
          }
        : rawResult;
    await c(tx).insert(eventCommands).values({
      actorId: actor.userId,
      route,
      targetId: target,
      key,
      fingerprint: hash,
      result,
      recordedAt: at(),
    });
    return result;
  }
  async function emit(
    tx: TxContext,
    actor: Actor,
    event: Event,
    type: CompanyEvent["type"],
    revisionId: string,
    version: number,
    category: CompanyEvent["data"]["category"],
    memberId: string | null,
  ) {
    const eventId = newId();
    await audit.append(tx, {
      actorKind: "user",
      actorId: actor.userId,
      operation: "configuration.changed",
      subjectKind: "event",
      subjectId: event.id,
      occurredAt: at(),
      reason: "operator_request",
    });
    await outbox.append(tx, {
      eventId,
      type,
      schemaVersion: 1,
      aggregate: {
        kind:
          type === "event.changed"
            ? "event"
            : type === "event.response_changed"
              ? "event_response"
              : "event_attendance",
        id:
          type === "event.response_changed"
            ? ((await response(tx, event.id, memberId as string))?.row.id ?? event.id)
            : event.id,
        version,
      },
      occurredAt: at(),
      correlationId: eventId,
      causationId: null,
      data: {
        eventId: event.id,
        eventRevisionId: event.currentRevisionId as string,
        revisionId,
        changeSequence: event.changeSequence,
        memberId,
        category,
      },
    });
    if (type !== "event.attendance_changed") {
      await c(tx).update(events).set({ notificationPending: true }).where(eq(events.id, event.id));
      await ports.notificationChanged?.(
        tx,
        event.id,
        type === "event.response_changed" ? memberId : null,
      );
    }
    if (type !== "event.response_changed") {
      await c(tx)
        .update(events)
        .set({
          tripAssessmentPending: true,
          tripAssessmentGeneration: sql`${events.tripAssessmentGeneration}+1`,
        })
        .where(eq(events.id, event.id));
      const [support] = await c(tx)
        .select({ generation: events.tripAssessmentGeneration })
        .from(events)
        .where(eq(events.id, event.id))
        .for("share");
      if (!support) throw new Error("EVENT_TRIP_GENERATION_MISSING");
      await ports.tripChanged?.(tx, event.id, support.generation);
    }
  }
  async function writeRevision(
    tx: TxContext,
    actor: Actor,
    e: Event,
    value: S["EventInput"],
    category: "created" | "updated" | "cancelled",
    reason: string | null = null,
  ) {
    const id = newId(),
      selected =
        category === "cancelled"
          ? await c(tx)
              .select()
              .from(eventCatalogPins)
              .where(eq(eventCatalogPins.revisionId, e.currentRevisionId as string))
          : await pins(tx, value);
    const version = category === "created" ? 1 : e.version + 1,
      sequence = category === "created" ? 1 : e.changeSequence + 1;
    await c(tx)
      .insert(eventRevisions)
      .values({
        id,
        eventId: e.id,
        version,
        sequence,
        actorId: actor.userId,
        recordedAt: at(),
        category,
        status: category === "cancelled" ? "cancelled" : "scheduled",
        title: value.title,
        description: value.description,
        game: value.game,
        server: value.server,
        organizer: value.organizer,
        meetingLocation: value.meetingLocation,
        route: value.route,
        meetingAt: value.meetingAt,
        startsAt: value.startsAt,
        endsAt: value.endsAt,
        visibility: value.visibility,
        prescribedMassKg: value.prescribedMassKg,
        privateReason: reason,
      });
    if (selected.length)
      await c(tx)
        .insert(eventCatalogPins)
        .values(selected.map((p) => ({ ...p, revisionId: id })));
    const next = {
      ...e,
      version,
      changeSequence: sequence,
      currentRevisionId: id,
      game: value.game,
      visibility: value.visibility,
      status: category === "cancelled" ? ("cancelled" as const) : ("scheduled" as const),
      startsAt: value.startsAt,
    };
    await c(tx)
      .update(events)
      .set({
        version,
        changeSequence: sequence,
        currentRevisionId: id,
        game: next.game,
        visibility: next.visibility,
        status: next.status,
        startsAt: next.startsAt,
      })
      .where(eq(events.id, e.id));
    await emit(tx, actor, next, "event.changed", id, version, category, null);
    return { eventId: e.id, revisionId: id, version };
  }
  async function revisionInput(tx: TxContext, r: Revision): Promise<S["EventInput"]> {
    const p = await c(tx)
      .select()
      .from(eventCatalogPins)
      .where(eq(eventCatalogPins.revisionId, r.id))
      .for("share");
    return {
      title: r.title,
      description: r.description,
      game: r.game,
      server: r.server,
      organizer: r.organizer,
      meetingLocation: r.meetingLocation,
      route: r.route,
      meetingAt: r.meetingAt,
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      visibility: r.visibility,
      originCityId: p.find((v) => v.field === "origin")?.entityId ?? null,
      destinationCityId: p.find((v) => v.field === "destination")?.entityId ?? null,
      prescribedCargoId: p.find((v) => v.field === "cargo")?.entityId ?? null,
      prescribedTrailerTypeId: p.find((v) => v.field === "trailer")?.entityId ?? null,
      prescribedMassKg: r.prescribedMassKg === null ? null : decimal(r.prescribedMassKg),
    };
  }
  const checkVersion = (actual: number, expected: number) => {
    if (actual !== expected) throw identityError(412, "VERSION_CONFLICT");
  };
  async function association(
    tx: TxContext,
    input: {
      eventId: string;
      memberId: string;
      game: "ets2" | "ats";
      eventRevisionId?: string;
      attendanceRevisionId?: string;
    },
  ) {
    const e = await lock(tx, input.eventId);
    const r = await revision(tx, input.eventRevisionId ?? (e.currentRevisionId as string));
    if (
      r.eventId !== e.id ||
      r.game !== input.game ||
      e.game !== input.game ||
      r.status !== "scheduled" ||
      e.status !== "scheduled"
    )
      throw identityError(409);
    let a: AttendanceRevision | null;
    if (input.attendanceRevisionId) {
      const [selected] = await c(tx)
        .select()
        .from(eventAttendanceRevisions)
        .where(eq(eventAttendanceRevisions.id, applicationId(input.attendanceRevisionId)))
        .for("share");
      if (!selected) throw identityError(404);
      a = selected;
    } else a = await attendance(tx, e.id, input.memberId);
    if (a && (a.memberId !== input.memberId || a.eventId !== e.id || a.eventRevisionId !== r.id))
      throw identityError(409);
    const p = await c(tx)
      .select()
      .from(eventCatalogPins)
      .where(eq(eventCatalogPins.revisionId, r.id))
      .for("share");
    const latestAttendance = await attendance(tx, e.id, input.memberId);
    const reviewRequired =
      r.id !== e.currentRevisionId || (a !== null && a.id !== latestAttendance?.id);
    const confirmedEvent: ConfirmedEventContext | null =
      a?.status === "attended" && !reviewRequired
        ? {
            eventId: e.id,
            eventRevisionId: r.id,
            attendanceRevisionId: a.id,
            attendanceStatus: "confirmed",
            prescribedCargoId: p.find((v) => v.field === "cargo")?.entityId ?? null,
            prescribedMassKg: r.prescribedMassKg === null ? null : decimal(r.prescribedMassKg),
            prescribedTrailerTypeId: p.find((v) => v.field === "trailer")?.entityId ?? null,
          }
        : null;
    return {
      eventId: e.id,
      eventRevisionId: r.id,
      attendanceRevisionId: a?.id ?? null,
      attendanceStatus:
        a?.status === "attended"
          ? ("confirmed" as const)
          : a?.status === "not_attended"
            ? ("declined" as const)
            : ("unconfirmed" as const),
      confirmedEvent,
      reviewRequired,
    };
  }

  return {
    // Correlation inputs are trusted query columns. The caller authorizes the current actor
    // on the same transaction; Events alone owns this eligibility/table implementation.
    notificationReminderCondition(fields: {
      eventId: SQLWrapper;
      memberId: SQLWrapper;
      revisionId: SQLWrapper;
      responseRevisionId: SQLWrapper;
      now: string;
    }) {
      return sql`EXISTS (SELECT 1 FROM ${events} JOIN ${eventResponses}
        ON ${eventResponses.eventId}=${events.id} AND ${eventResponses.memberId}=${fields.memberId}
        WHERE ${events.id}=${fields.eventId} AND ${events.currentRevisionId}=${fields.revisionId}
          AND ${eventResponses.currentRevisionId}=${fields.responseRevisionId}
          AND ${eventResponses.status}='participating' AND ${events.status}='scheduled'
          AND ${events.startsAt}>${utcDateTime(fields.now)})`;
    },
    authorize: (actor: Actor, manage = false) =>
      run(async (tx) => {
        await authorize(tx, actor, manage ? "events.manage" : "company.read");
      }),
    async create(actor: Actor, key: string, raw: S["EventInput"]) {
      const value = input(raw);
      return run(async (tx) => {
        await authorize(tx, actor, "events.manage"); // Stable create target is its idempotency key, serialized by the company lock.
        const target = applicationId(key);
        const result = await once(tx, actor, "create", target, key, value, async () => {
          const e: Event = {
            id: newId(),
            version: 1,
            changeSequence: 1,
            tripAssessmentPending: false,
            notificationPending: true,
            tripAssessmentGeneration: 0,
            attendanceVersion: 1,
            currentRevisionId: null,
            game: value.game,
            visibility: value.visibility,
            status: "scheduled",
            startsAt: value.startsAt,
            createdAt: at(),
          };
          await c(tx).insert(events).values(e);
          return writeRevision(tx, actor, e, value, "created");
        });
        return {
          data: await memberDto(tx, await revision(tx, result.revisionId), actor, result),
          version: result.version,
        };
      });
    },
    async update(actor: Actor, id: string, key: string, expected: number, raw: S["EventInput"]) {
      const value = input(raw);
      return run(async (tx) => {
        await authorize(tx, actor, "events.manage");
        const e = await lock(tx, id);
        const result = await once(tx, actor, "update", id, key, [expected, value], async () => {
          checkVersion(e.version, expected);
          if (e.status === "cancelled") throw identityError(409);
          return writeRevision(tx, actor, e, value, "updated");
        });
        return {
          data: await memberDto(tx, await revision(tx, result.revisionId), actor, result),
          version: result.version,
        };
      });
    },
    async cancel(actor: Actor, id: string, key: string, expected: number, reason: string) {
      text(reason, 2048);
      return run(async (tx) => {
        await authorize(tx, actor, "events.manage");
        const e = await lock(tx, id);
        const result = await once(tx, actor, "cancel", id, key, [expected, reason], async () => {
          checkVersion(e.version, expected);
          if (e.status === "cancelled") throw identityError(409);
          const r = await revision(tx, e.currentRevisionId as string);
          return writeRevision(tx, actor, e, await revisionInput(tx, r), "cancelled", reason);
        });
        return {
          data: await memberDto(tx, await revision(tx, result.revisionId), actor, result),
          version: result.version,
        };
      });
    },
    async get(actor: Actor | null, id: string) {
      return run(async (tx) => {
        if (actor) await authorize(tx, actor);
        const e = await lock(tx, id, !actor),
          r = await revision(tx, e.currentRevisionId as string);
        return {
          data: actor ? await memberDto(tx, r, actor) : await publicDto(tx, r),
          version: e.version,
        };
      });
    },
    async list(actor: Actor | null, options: Page & { period?: "upcoming" | "past" } = {}) {
      return run(async (tx) => {
        if (actor) await authorize(tx, actor);
        const period = options.period ?? "upcoming";
        if (!["upcoming", "past"].includes(period)) throw identityError(422);
        const p = page(actor, ["list", period, actor ? "member" : "public"], options);
        const rows = await c(tx)
          .select()
          .from(events)
          .where(
            and(
              actor ? undefined : eq(events.visibility, "public"),
              period === "upcoming"
                ? gte(events.startsAt, p.boundary)
                : lt(events.startsAt, p.boundary),
              p.after
                ? or(
                    gt(events.startsAt, p.after.time as string),
                    and(eq(events.startsAt, p.after.time as string), gt(events.id, p.after.id)),
                  )
                : undefined,
            ),
          )
          .orderBy(asc(events.startsAt), asc(events.id))
          .limit(p.limit + 1);
        const result = p.finish(rows, (r) => ({ id: r.id, time: r.startsAt }));
        const ids = result.items.map((e) => e.currentRevisionId as string);
        if (!ids.length) return { ...result, items: [] };
        const revisions = await c(tx)
          .select()
          .from(eventRevisions)
          .where(inArray(eventRevisions.id, ids));
        const allPins = await c(tx)
          .select()
          .from(eventCatalogPins)
          .where(inArray(eventCatalogPins.revisionId, ids));
        const byId = new Map(revisions.map((r) => [r.id, r]));
        return {
          ...result,
          items: await Promise.all(
            result.items.map((e) => {
              const r = byId.get(e.currentRevisionId as string);
              if (!r) throw new Error("EVENT_REVISION_MISSING");
              return publicDto(
                tx,
                r,
                allPins.filter((p) => p.revisionId === r.id),
              );
            }),
          ),
        };
      });
    },
    async nearest(actor: Actor) {
      return run(async (tx) => {
        await authorize(tx, actor);
        const [e] = await c(tx)
          .select()
          .from(events)
          .where(and(eq(events.status, "scheduled"), gte(events.startsAt, at())))
          .orderBy(asc(events.startsAt), asc(events.id))
          .limit(1);
        return e ? publicDto(tx, await revision(tx, e.currentRevisionId as string)) : null;
      });
    },
    async myResponse(actor: Actor, id: string) {
      return run(async (tx) => {
        await authorize(tx, actor, "events.respond");
        await lock(tx, id);
        const data = responseDto((await response(tx, id, actor.userId))?.revision ?? null);
        return { data, version: data.version };
      });
    },
    async respond(actor: Actor, id: string, key: string, expected: number, value: S["RsvpInput"]) {
      try {
        closed(value, value.response === "declined" ? ["response", "reason"] : ["response"]);
      } catch {
        throw identityError(422);
      }
      if (!["unanswered", "participating", "declined"].includes(value.response))
        throw identityError(422);
      if (value.response === "declined") text(value.reason, 2048);
      return run(async (tx) => {
        await authorize(tx, actor, "events.respond");
        const e = await lock(tx, id);
        const result = await once(tx, actor, "response", id, key, [expected, value], async () => {
          const current = await response(tx, id, actor.userId);
          checkVersion(current?.row.version ?? 1, expected);
          const time = at();
          if (e.status !== "scheduled" || time >= e.startsAt) throw identityError(409);
          const reason = value.response === "declined" ? value.reason : null;
          if (
            (current?.revision.status ?? "unanswered") === value.response &&
            (current?.revision.reason ?? null) === reason
          )
            return {
              eventId: id,
              revisionId: current?.revision.id ?? (e.currentRevisionId as string),
              version: current?.row.version ?? 1,
            };
          const version = (current?.row.version ?? 1) + 1,
            revisionId = newId(),
            responseId = current?.row.id ?? newId(),
            sequence = e.changeSequence + 1;
          await c(tx).insert(eventResponseRevisions).values({
            id: revisionId,
            responseId,
            eventId: id,
            memberId: actor.userId,
            actorId: actor.userId,
            version,
            sequence,
            recordedAt: time,
            status: value.response,
            reason,
          });
          if (current)
            await c(tx)
              .update(eventResponses)
              .set({ version, currentRevisionId: revisionId, status: value.response })
              .where(eq(eventResponses.id, responseId));
          else
            await c(tx).insert(eventResponses).values({
              id: responseId,
              eventId: id,
              memberId: actor.userId,
              version,
              currentRevisionId: revisionId,
              status: value.response,
            });
          await c(tx).update(events).set({ changeSequence: sequence }).where(eq(events.id, id));
          await emit(
            tx,
            actor,
            { ...e, changeSequence: sequence },
            "event.response_changed",
            revisionId,
            version,
            "response",
            actor.userId,
          );
          return { eventId: id, revisionId, version };
        });
        const [r] = await c(tx)
          .select()
          .from(eventResponseRevisions)
          .where(eq(eventResponseRevisions.id, result.revisionId));
        const data = responseDto(r ?? null);
        return { data, version: result.version };
      });
    },
    async participants(actor: Actor, id: string, options: Page = {}) {
      return run(async (tx) => {
        await authorize(tx, actor);
        await lock(tx, id);
        const p = page(actor, ["participants", id], options);
        const rows = await c(tx)
          .select()
          .from(eventResponses)
          .where(
            and(
              eq(eventResponses.eventId, id),
              eq(eventResponses.status, "participating"),
              p.after ? gt(eventResponses.memberId, p.after.id) : undefined,
            ),
          )
          .orderBy(asc(eventResponses.memberId))
          .limit(p.limit + 1);
        const result = p.finish(rows, (r) => ({ id: r.memberId, time: null }));
        const summaries = await ports.identity.memberSummariesInTransaction(
          tx,
          result.items.map((r) => r.memberId),
        );
        return {
          items: result.items.map((r) => ({
            member: summaries.get(r.memberId) as S["MemberSummary"],
          })),
          nextCursor: result.nextCursor,
        };
      });
    },
    async attendance(actor: Actor, id: string, options: Page = {}) {
      return run(async (tx) => {
        await authorize(tx, actor, "events.manage");
        const e = await lock(tx, id),
          p = page(actor, ["attendance", id, e.attendanceVersion], options),
          rows = await ports.identity.eventRosterInTransaction(
            tx,
            p.after?.id ?? null,
            p.limit + 1,
          ),
          result = p.finish(rows, (r) => ({ id: r.id, time: null })),
          summaries = await ports.identity.memberSummariesInTransaction(
            tx,
            result.items.map((r) => r.id),
          );
        const ids = result.items.map((r) => r.id);
        const responses = ids.length
          ? await c(tx)
              .select({ memberId: eventResponses.memberId, revision: eventResponseRevisions })
              .from(eventResponses)
              .innerJoin(
                eventResponseRevisions,
                eq(eventResponseRevisions.id, eventResponses.currentRevisionId),
              )
              .where(and(eq(eventResponses.eventId, id), inArray(eventResponses.memberId, ids)))
          : [];
        const attendances = ids.length
          ? await c(tx)
              .select({ memberId: eventAttendances.memberId, revision: eventAttendanceRevisions })
              .from(eventAttendances)
              .innerJoin(
                eventAttendanceRevisions,
                eq(eventAttendanceRevisions.id, eventAttendances.currentRevisionId),
              )
              .where(and(eq(eventAttendances.eventId, id), inArray(eventAttendances.memberId, ids)))
          : [];
        const items = result.items.map((r) => {
          const a = attendances.find((a) => a.memberId === r.id)?.revision;
          return {
            member: summaries.get(r.id) as S["MemberSummary"],
            response: responseDto(responses.find((a) => a.memberId === r.id)?.revision ?? null),
            attendance: a?.status ?? ("unconfirmed" as const),
            note: a?.note ?? null,
          };
        });
        return { data: { items, nextCursor: result.nextCursor }, version: e.attendanceVersion };
      });
    },
    async setAttendance(
      actor: Actor,
      id: string,
      key: string,
      expected: number,
      value: S["AttendanceInput"],
    ) {
      try {
        closed(value, ["members"]);
        if (
          !Array.isArray(value.members) ||
          value.members.length < 1 ||
          value.members.length > 100 ||
          new Set(value.members.map((m) => m.memberId)).size !== value.members.length
        )
          throw new Error();
        for (const m of value.members) {
          closed(m, ["memberId", "attendance", "note"]);
          applicationId(m.memberId);
          if (!["attended", "not_attended"].includes(m.attendance)) throw new Error();
          if (m.note !== null) text(m.note, 2048);
        }
      } catch {
        throw identityError(422);
      }
      return run(async (tx) => {
        await authorize(
          tx,
          actor,
          "events.manage",
          value.members.map((m) => m.memberId),
        );
        const e = await lock(tx, id);
        const result = await once(tx, actor, "attendance", id, key, [expected, value], async () => {
          checkVersion(e.attendanceVersion, expected);
          const time = at();
          if (e.status !== "scheduled" || time < e.startsAt) throw identityError(409);
          const version = e.attendanceVersion + 1,
            sequence = e.changeSequence + 1;
          let lastId = e.currentRevisionId as string;
          for (const m of [...value.members].sort((a, b) => a.memberId.localeCompare(b.memberId))) {
            const revisionId = newId();
            await c(tx)
              .insert(eventAttendanceRevisions)
              .values({
                id: revisionId,
                eventId: id,
                eventRevisionId: e.currentRevisionId as string,
                memberId: m.memberId,
                actorId: actor.userId,
                version,
                sequence,
                recordedAt: time,
                status: m.attendance,
                note: m.note,
              });
            const old = await attendance(tx, id, m.memberId);
            if (old)
              await c(tx)
                .update(eventAttendances)
                .set({ currentRevisionId: revisionId })
                .where(
                  and(eq(eventAttendances.eventId, id), eq(eventAttendances.memberId, m.memberId)),
                );
            else
              await c(tx)
                .insert(eventAttendances)
                .values({ eventId: id, memberId: m.memberId, currentRevisionId: revisionId });
            lastId = revisionId;
          }
          await c(tx)
            .update(events)
            .set({ attendanceVersion: version, changeSequence: sequence })
            .where(eq(events.id, id));
          await emit(
            tx,
            actor,
            { ...e, changeSequence: sequence },
            "event.attendance_changed",
            lastId,
            version,
            "attendance",
            null,
          );
          return { eventId: id, revisionId: lastId, version };
        });
        return { data: { id, version: result.version }, version: result.version };
      });
    },
    async history(actor: Actor, id: string, afterSequence = 0, limit = 25) {
      return run(async (tx) => {
        await authorize(tx, actor, "events.manage");
        await lock(tx, id);
        const after = afterSequence;
        if (
          !Number.isSafeInteger(after) ||
          after < 0 ||
          !Number.isInteger(limit) ||
          limit < 1 ||
          limit > 100
        )
          throw identityError(422);
        const definitions = await c(tx)
          .select()
          .from(eventRevisions)
          .where(and(eq(eventRevisions.eventId, id), gt(eventRevisions.sequence, after)))
          .orderBy(asc(eventRevisions.sequence))
          .limit(limit + 1);
        const responses = await c(tx)
          .select()
          .from(eventResponseRevisions)
          .where(
            and(eq(eventResponseRevisions.eventId, id), gt(eventResponseRevisions.sequence, after)),
          )
          .orderBy(asc(eventResponseRevisions.sequence), asc(eventResponseRevisions.id))
          .limit(limit + 1);
        const attendanceSequences = await c(tx)
          .select({ sequence: eventAttendanceRevisions.sequence })
          .from(eventAttendanceRevisions)
          .where(
            and(
              eq(eventAttendanceRevisions.eventId, id),
              gt(eventAttendanceRevisions.sequence, after),
            ),
          )
          .groupBy(eventAttendanceRevisions.sequence)
          .orderBy(asc(eventAttendanceRevisions.sequence))
          .limit(limit + 1);
        const sequences = attendanceSequences.slice(0, limit).map((r) => r.sequence);
        const attendance = sequences.length
          ? await c(tx)
              .select()
              .from(eventAttendanceRevisions)
              .where(
                and(
                  eq(eventAttendanceRevisions.eventId, id),
                  inArray(eventAttendanceRevisions.sequence, sequences),
                ),
              )
              .orderBy(asc(eventAttendanceRevisions.sequence), asc(eventAttendanceRevisions.id))
          : [];
        const next = (rows: { sequence: number }[]) =>
          rows.length > limit ? (rows[limit - 1]?.sequence ?? null) : null;
        return {
          definitions: definitions.slice(0, limit),
          responses: responses.slice(0, limit),
          attendance,
          nextAfterSequence: {
            definitions: next(definitions),
            responses: next(responses),
            attendance: next(attendanceSequences),
          },
        };
      });
    },
    // Safe future-consumer seam: immutable change order reconstructs RSVP recipients at that change.
    async notificationChangeInTransaction(tx: TxContext, change: CompanyEvent) {
      const e = await lock(tx, change.data.eventId);
      const r = await revision(tx, change.data.eventRevisionId);
      if (
        r.eventId !== e.id ||
        (change.type === "event.changed" &&
          (r.id !== change.data.revisionId ||
            r.version !== change.aggregate.version ||
            r.sequence !== change.data.changeSequence))
      )
        throw new Error("NOTIFICATION_EVENT_REFERENCE_CONFLICT");
      const [prior] =
        r.version > 1
          ? await c(tx)
              .select()
              .from(eventRevisions)
              .where(
                and(eq(eventRevisions.eventId, e.id), eq(eventRevisions.version, r.version - 1)),
              )
              .for("share")
          : [];
      const changed =
        r.status === "cancelled"
          ? "event.cancelled"
          : prior && prior.startsAt !== r.startsAt
            ? "event.start_changed"
            : prior && (prior.route !== r.route || prior.meetingLocation !== r.meetingLocation)
              ? "event.route_changed"
              : null;
      return {
        eventId: e.id,
        revisionId: r.id,
        version: r.version,
        current: e.currentRevisionId === r.id,
        category: changed,
        title: r.title,
        game: r.game,
        startsAt: r.startsAt,
      };
    },
    async notificationScheduleInTransaction(
      tx: TxContext,
      id: string,
      after: string | null = null,
      limit = 25,
    ) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 25)
        throw new Error("NOTIFICATION_REMINDER_BOUND_EXCEEDED");
      const e = await lock(tx, id),
        r = await revision(tx, e.currentRevisionId as string);
      const members = await c(tx)
        .select({
          id: eventResponses.memberId,
          responseRevisionId: eventResponses.currentRevisionId,
        })
        .from(eventResponses)
        .where(
          and(
            eq(eventResponses.eventId, id),
            eq(eventResponses.status, "participating"),
            after ? gt(eventResponses.memberId, applicationId(after)) : undefined,
          ),
        )
        .orderBy(asc(eventResponses.memberId))
        .limit(limit)
        .for("share");
      return {
        eventId: e.id,
        revisionId: r.id,
        generation: e.changeSequence,
        startsAt: r.startsAt,
        status: r.status,
        title: r.title,
        game: r.game,
        members,
      };
    },
    async reminderEligibleInTransaction(
      tx: TxContext,
      eventId: string,
      memberId: string,
      revisionId: string,
      responseRevisionId: string,
    ) {
      const e = await lock(tx, eventId);
      const r = await response(tx, eventId, memberId);
      return (
        e.status === "scheduled" &&
        e.currentRevisionId === revisionId &&
        at() < e.startsAt &&
        r?.row.status === "participating" &&
        r.row.currentRevisionId === responseRevisionId
      );
    },
    async pendingNotificationsInTransaction(tx: TxContext) {
      return c(tx)
        .select({ id: events.id })
        .from(events)
        .where(eq(events.notificationPending, true))
        .orderBy(asc(events.id))
        .limit(25)
        .for("share");
    },
    async acknowledgeNotificationsInTransaction(tx: TxContext, id: string, generation: number) {
      await c(tx)
        .update(events)
        .set({ notificationPending: false })
        .where(and(eq(events.id, id), eq(events.changeSequence, generation)));
    },
    async recipientsInTransaction(
      tx: TxContext,
      eventId: string,
      sequence: number,
      after: string | null = null,
      limit = 100,
    ) {
      if (
        !Number.isInteger(sequence) ||
        sequence < 1 ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 100
      )
        throw identityError(422);
      const rows = await c(tx)
        .select({ memberId: eventResponseRevisions.memberId })
        .from(eventResponseRevisions)
        .where(
          and(
            eq(eventResponseRevisions.eventId, applicationId(eventId)),
            lt(eventResponseRevisions.sequence, sequence),
            eq(eventResponseRevisions.status, "participating"),
            after ? gt(eventResponseRevisions.memberId, applicationId(after)) : undefined,
            sql`NOT EXISTS (SELECT 1 FROM event_response_revisions newer WHERE newer.event_id=${eventResponseRevisions.eventId} AND newer.member_id=${eventResponseRevisions.memberId} AND newer.sequence>${eventResponseRevisions.sequence} AND newer.sequence<${sequence})`,
          ),
        )
        .orderBy(asc(eventResponseRevisions.memberId))
        .limit(limit);
      return rows.map((r) => r.memberId);
    },
    async pendingTripInvalidationsInTransaction(tx: TxContext, limit = 25) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 25)
        throw new Error("EVENT_TRIP_INVALIDATION_BOUND_INVALID");
      return c(tx)
        .select({ eventId: events.id, generation: events.tripAssessmentGeneration })
        .from(events)
        .where(eq(events.tripAssessmentPending, true))
        .orderBy(asc(events.id))
        .limit(limit)
        .for("share");
    },
    async tripInvalidationInTransaction(tx: TxContext, id: string) {
      const [row] = await c(tx)
        .select({ eventId: events.id, generation: events.tripAssessmentGeneration })
        .from(events)
        .where(eq(events.id, applicationId(id)))
        .for("share");
      if (!row) throw identityError(404);
      return row;
    },
    async acknowledgeTripInvalidationInTransaction(tx: TxContext, id: string, generation: number) {
      await c(tx)
        .update(events)
        .set({ tripAssessmentPending: false })
        .where(
          and(eq(events.id, applicationId(id)), eq(events.tripAssessmentGeneration, generation)),
        );
    },
    async generationInTransaction(tx: TxContext, eventId: string) {
      const [row] = await c(tx)
        .select({
          eventId: events.id,
          revisionId: events.currentRevisionId,
          version: events.version,
          changeSequence: events.changeSequence,
          startsAt: events.startsAt,
          status: events.status,
          visibility: events.visibility,
        })
        .from(events)
        .where(eq(events.id, applicationId(eventId)))
        .for("share");
      if (!row) throw identityError(404);
      if (!row.revisionId) throw new Error("EVENT_REVISION_MISSING");
      return row;
    },
    async definitionInTransaction(tx: TxContext, revisionId: string) {
      const r = await revision(tx, revisionId);
      return {
        eventId: r.eventId,
        revisionId: r.id,
        version: r.version,
        changeSequence: r.sequence,
        startsAt: r.startsAt,
        status: r.status,
      };
    },
    // Caller must acquire identity/company locks before trip locks, then invoke on that same tx.
    currentAssociationInTransaction: association,
    async associateInTransaction(
      tx: TxContext,
      actor: Actor,
      input: {
        eventId: string;
        memberId: string;
        game: "ets2" | "ats";
        eventRevisionId?: string;
        attendanceRevisionId?: string;
      },
    ) {
      await authorize(tx, actor, "company.read", [input.memberId]);
      if (
        actor.userId !== input.memberId &&
        !actor.capabilities.includes("events.manage") &&
        !actor.capabilities.includes("trips.review")
      )
        throw identityError(404);
      return association(tx, input);
    },
  };
}
export type Events = ReturnType<typeof createEvents>;
