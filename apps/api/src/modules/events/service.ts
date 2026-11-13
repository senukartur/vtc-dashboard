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
} from "@vtc/db";
import {
  and,
  asc,
  eq,
  eventAttendanceRevisions,
  eventAttendances,
  eventCommands,
  eventResponseRevisions,
  eventResponses,
  eventRevisions,
  events,
  gt,
  gte,
  inArray,
  lt,
  lte,
  or,
  sql,
} from "@vtc/db/events-schema";
import { notExists, type SQLWrapper } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { causes, retryTransaction, unknownCommit } from "../../platform/jobs/queue.js";
import { type CompanyEvent, closed, createOutbox } from "../../platform/outbox/events.js";
import type { Catalogs } from "../catalogs/service.js";
import { type Actor, type Identity, identityError } from "../identity/service.js";
import type { ConfirmedEventContext } from "../qualification-rules/contracts.js";
import { canonicalJson, decimal } from "../sources/contracts/canonical.js";
import { createEventDrafts } from "./drafts.js";
import { type Page, pagination } from "./pagination.js";
import {
  blankLegacyText,
  createPublishedRoutes,
  eventDate as date,
  definitionFields,
  type EventLocale,
  legacyRouteDetails,
  legacyTextFields,
  publishedRouteInput,
  type RouteCatalogs,
  type RouteDetails,
  routeChanged,
  eventText as text,
} from "./published-route.js";

type S = components["schemas"];
type Event = Omit<typeof events.$inferSelect, "notificationMaterialPending">;
type Revision = typeof eventRevisions.$inferSelect;
const publicRevisionFields = {
  id: eventRevisions.id,
  eventId: eventRevisions.eventId,
  version: eventRevisions.version,
  title: eventRevisions.title,
  description: eventRevisions.description,
  game: eventRevisions.game,
  server: eventRevisions.server,
  organizer: eventRevisions.organizer,
  meetingLocation: eventRevisions.meetingLocation,
  route: eventRevisions.route,
  meetingAt: eventRevisions.meetingAt,
  startsAt: eventRevisions.startsAt,
  endsAt: eventRevisions.endsAt,
  status: eventRevisions.status,
  visibility: eventRevisions.visibility,
  originCityId: eventRevisions.originCityId,
  destinationCityId: eventRevisions.destinationCityId,
};
type PublicRevision = Pick<Revision, keyof typeof publicRevisionFields>;
type ListOptions = Page & { period?: "upcoming" | "past" };
type OwnResponse = Pick<S["Rsvp"], "response" | "version">;
type NotificationMaterial = Pick<
  Revision,
  "status" | "startsAt" | "route" | "meetingLocation" | "originCityId" | "destinationCityId"
>;
type DepotIds = Pick<RouteDetails, "originDepotId" | "destinationDepotId">;
type MaterialState = NonNullable<Event["notificationMaterial"]>;
function materialState(raw: unknown, version: number): MaterialState | null {
  if (raw === null) return null;
  try {
    const value = closed(raw, [
      "schemaVersion",
      "throughVersion",
      "startVersion",
      "routeVersion",
      "statusVersion",
    ]);
    if (value.schemaVersion !== 1) throw new Error();
    for (const key of ["throughVersion", "startVersion", "routeVersion", "statusVersion"] as const)
      if (
        !Number.isInteger(value[key]) ||
        (value[key] as number) < 1 ||
        (value[key] as number) > version
      )
        throw new Error();
    const state = value as MaterialState;
    if (
      [state.startVersion, state.routeVersion, state.statusVersion].some(
        (v) => v > state.throughVersion,
      )
    )
      throw new Error();
    return state;
  } catch {
    throw new Error("EVENT_NOTIFICATION_MATERIAL_INVALID");
  }
}
function advanceMaterial(
  state: MaterialState,
  prior: NotificationMaterial,
  next: NotificationMaterial & { version: number },
  priorDepots: DepotIds | null,
  nextDepots: DepotIds | null,
) {
  if (next.version !== state.throughVersion + 1 || prior.status !== "scheduled")
    throw new Error("EVENT_NOTIFICATION_MATERIAL_HISTORY_INVALID");
  const statusChanged = prior.status !== next.status;
  return {
    schemaVersion: 1 as const,
    throughVersion: next.version,
    startVersion:
      statusChanged || prior.startsAt !== next.startsAt ? next.version : state.startVersion,
    routeVersion:
      statusChanged || routeChanged(prior, next, priorDepots, nextDepots)
        ? next.version
        : state.routeVersion,
    statusVersion: statusChanged ? next.version : state.statusVersion,
  };
}
function materialChangeCurrent(
  category: string,
  originalVersion: number,
  current: Revision | { status: Revision["status"]; version: number },
  state: MaterialState | null,
) {
  if (!state || state.throughVersion !== current.version) return false;
  if (category === "event.cancelled")
    return current.status === "cancelled" && state.statusVersion === originalVersion;
  if (current.status !== "scheduled") return false;
  return category === "event.start_changed"
    ? state.startVersion === originalVersion
    : category === "event.route_changed" && state.routeVersion === originalVersion;
}
type ResponseRevision = typeof eventResponseRevisions.$inferSelect;
type AttendanceRevision = typeof eventAttendanceRevisions.$inferSelect;
type Route = typeof eventCommands.$inferSelect.route;
type Receipt = typeof eventCommands.$inferSelect.result & {
  responseRevisionId?: string | null;
  attendanceRevisionId?: string | null;
  responseCounts?: S["EventResponseCounts"];
};
type DefinitionCommand =
  | { legacy: S["EventInput"] }
  | { published: ReturnType<typeof publishedRouteInput> };
type MemberProjection<T> = (
  tx: TxContext,
  revision: Revision,
  actor: Actor,
  receipt: Receipt,
) => Promise<T>;

export interface EventsConfig {
  cursorKey: string;
  routeEnabled?: boolean;
  draftsEnabled?: boolean;
}
export function validateEventsConfig(config: EventsConfig) {
  if (!/^[0-9a-f]{64}$/.test(config.cursorKey) || (config.draftsEnabled && !config.routeEnabled))
    throw new Error("INVALID_EVENTS_CONFIG");
}
interface Ports {
  identity: Pick<
    Identity,
    | "eventContextInTransaction"
    | "eventRosterInTransaction"
    | "eventRosterCountInTransaction"
    | "eventEligibleMembersInTransaction"
    | "memberSummariesInTransaction"
  >;
  catalogs?: Pick<Catalogs, "selectionsInTransaction" | "labelsInTransaction"> &
    Partial<Pick<RouteCatalogs, "eventRouteCatalogInTransaction">>;
  outbox?: Pick<ReturnType<typeof createOutbox>, "append">;
  tripChanged?: (tx: TxContext, eventId: string, generation: number) => Promise<void>;
  attendanceTripIds?: (
    tx: TxContext,
    actor: Actor,
    eventId: string,
    game: Event["game"],
    memberIds: string[],
  ) => Promise<ReadonlyMap<string, string>>;
  notificationChanged?: (tx: TxContext, eventId: string, memberId: string | null) => Promise<void>;
  media?: Pick<import("./media.js").EventMedia, "coverIdsInTransaction" | "discardInTransaction">;
}
export function createEvents(
  unit: UnitOfWork,
  config: EventsConfig,
  ports: Ports,
  now = () => new Date(),
) {
  validateEventsConfig(config);
  const catalogs = ports.catalogs;
  const routeCatalogs = catalogs?.eventRouteCatalogInTransaction
    ? {
        labelsInTransaction: catalogs.labelsInTransaction,
        eventRouteCatalogInTransaction: catalogs.eventRouteCatalogInTransaction,
      }
    : null;
  if (config.routeEnabled && !routeCatalogs) throw new Error("EVENT_ROUTE_CATALOGS_REQUIRED");
  const publishedRoutes =
    config.routeEnabled && routeCatalogs ? createPublishedRoutes(unit, routeCatalogs) : null;
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
    organizerId?: string,
  ) => ports.identity.eventContextInTransaction(tx, actor, targets, capability, organizerId);
  function legacyInput(raw: S["EventInput"]) {
    try {
      closed(raw, [...definitionFields, ...legacyTextFields, "organizer"]);
    } catch {
      throw identityError(422);
    }
    text(raw.organizer, 256);
    for (const field of legacyTextFields) text(raw[field], field === "description" ? 8000 : 2048);
    return input(raw);
  }
  function input<T extends Pick<S["EventInput"], (typeof definitionFields)[number]>>(raw: T) {
    text(raw.title, 256);
    text(raw.server, 256);
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
  async function lock(
    tx: TxContext,
    id: string,
    publicOnly = false,
    mode: "update" | "share" = "update",
  ) {
    const [row] = await c(tx)
      .select()
      .from(events)
      .where(eq(events.id, applicationId(id)))
      .for(mode);
    if (!row || (publicOnly && row.visibility !== "public")) throw identityError(404);
    return row;
  }
  // Member-visible response lists: safe summaries only, never reasons. Each status keeps its own cursor scope.
  function responders(
    actor: Actor,
    id: string,
    status: "participating" | "declined",
    options: Page,
  ): Promise<S["ListParticipant"]> {
    return run(async (tx) => {
      await authorize(tx, actor);
      await lock(tx, id);
      const p = page(
        actor,
        [status === "participating" ? "participants" : "decliners", id],
        options,
      );
      const rows = await c(tx)
        .select({ memberId: eventResponses.memberId })
        .from(eventResponses)
        .where(
          and(
            eq(eventResponses.eventId, id),
            eq(eventResponses.status, status),
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
  async function notificationMaterial(tx: TxContext, change: CompanyEvent, prepare: boolean) {
    if (change.type !== "event.changed") throw new Error("NOTIFICATION_EVENT_REFERENCE_CONFLICT");
    const e = await lock(tx, change.data.eventId, false, prepare ? "update" : "share"),
      original = await revision(tx, change.data.eventRevisionId);
    if (
      change.aggregate.id !== e.id ||
      original.eventId !== e.id ||
      original.id !== change.data.revisionId ||
      original.version !== change.aggregate.version ||
      original.sequence !== change.data.changeSequence
    )
      throw new Error("NOTIFICATION_EVENT_REFERENCE_CONFLICT");
    if (prepare) return repairMaterial(tx, e);
    const state = materialState(e.notificationMaterial, e.version);
    return {
      complete: state?.throughVersion === e.version,
      throughVersion: state?.throughVersion ?? 0,
      currentVersion: e.version,
      scanned: 0,
    };
  }
  async function repairMaterial(tx: TxContext, e: Event) {
    let state = materialState(e.notificationMaterial, e.version),
      scanned = 0;
    if (state?.throughVersion !== e.version) {
      let prior: Revision | undefined;
      if (state) {
        [prior] = await c(tx)
          .select()
          .from(eventRevisions)
          .where(
            and(eq(eventRevisions.eventId, e.id), eq(eventRevisions.version, state.throughVersion)),
          )
          .for("share");
        if (!prior) throw new Error("EVENT_NOTIFICATION_MATERIAL_HISTORY_INVALID");
      }
      const rows = await c(tx)
        .select()
        .from(eventRevisions)
        .where(
          and(
            eq(eventRevisions.eventId, e.id),
            gt(eventRevisions.version, state?.throughVersion ?? 0),
            lte(eventRevisions.version, e.version),
          ),
        )
        .orderBy(asc(eventRevisions.version))
        .limit(25)
        .for("share");
      if (!rows.length) throw new Error("EVENT_NOTIFICATION_MATERIAL_HISTORY_INVALID");
      const details = await publishedRoutes?.detailsInTransaction(tx, [
        ...(prior ? [prior.id] : []),
        ...rows.map((row) => row.id),
      ]);
      for (const row of rows) {
        if (
          row.version !== (state?.throughVersion ?? 0) + 1 ||
          (!state
            ? !["created", "published"].includes(row.category) || row.status !== "scheduled"
            : row.status === "cancelled"
              ? row.category !== "cancelled"
              : row.category !== "updated")
        )
          throw new Error("EVENT_NOTIFICATION_MATERIAL_HISTORY_INVALID");
        state =
          state && prior
            ? advanceMaterial(
                state,
                prior,
                row,
                details?.get(prior.id) ?? null,
                details?.get(row.id) ?? null,
              )
            : {
                schemaVersion: 1,
                throughVersion: 1,
                startVersion: 1,
                routeVersion: 1,
                statusVersion: 1,
              };
        prior = row;
        scanned++;
      }
      await c(tx).update(events).set({ notificationMaterial: state }).where(eq(events.id, e.id));
    }
    return {
      complete: state?.throughVersion === e.version,
      throughVersion: state?.throughVersion ?? 0,
      currentVersion: e.version,
      scanned,
    };
  }
  /** A hidden row is only acceptable when the previous revision already references it. */
  async function validateReferences(
    tx: TxContext,
    r: Pick<
      S["EventInput"],
      | "game"
      | "originCityId"
      | "destinationCityId"
      | "prescribedCargoId"
      | "prescribedTrailerTypeId"
    >,
    previous: Pick<
      Revision,
      "originCityId" | "destinationCityId" | "prescribedCargoId" | "prescribedTrailerId"
    > | null,
  ) {
    const selections = [
      { kind: "city", id: r.originCityId, current: previous?.originCityId },
      { kind: "city", id: r.destinationCityId, current: previous?.destinationCityId },
      { kind: "cargo", id: r.prescribedCargoId, current: previous?.prescribedCargoId },
      { kind: "trailer", id: r.prescribedTrailerTypeId, current: previous?.prescribedTrailerId },
    ].filter(
      (
        s,
      ): s is {
        kind: "city" | "cargo" | "trailer";
        id: string;
        current: string | null | undefined;
      } => s.id !== null,
    );
    if (!selections.length) return;
    if (!ports.catalogs) throw identityError(503);
    const found = await ports.catalogs.selectionsInTransaction(
      tx,
      selections.map(({ kind, id }) => ({ kind, id })),
    );
    for (const selection of selections) {
      const row = found.get(selection.id);
      if (!row || row.game !== r.game || row.kind !== selection.kind) throw identityError(422);
      if (row.hidden && selection.current !== selection.id)
        throw identityError(422, "CATALOG_SELECTION_HIDDEN");
    }
  }
  async function routeLabels(tx: TxContext, revisions: readonly PublicRevision[]) {
    const refs = revisions.flatMap((r) =>
      [r.originCityId, r.destinationCityId].flatMap((id) =>
        id ? [{ kind: "city" as const, id }] : [],
      ),
    );
    if (!refs.length || !ports.catalogs) return new Map<string, S["CatalogLabel"]>();
    return ports.catalogs.labelsInTransaction(tx, refs, "en");
  }
  async function publicDto(
    tx: TxContext,
    r: PublicRevision,
    knownLabels?: Map<string, S["CatalogLabel"]>,
  ): Promise<S["EventPublic"]> {
    const labels = knownLabels ?? (await routeLabels(tx, [r]));
    return legacyPublicDto(r, labels);
  }
  function legacyPublicDto(
    r: PublicRevision,
    labels: Map<string, S["CatalogLabel"]>,
  ): S["EventPublic"] {
    return {
      id: r.eventId,
      version: r.version,
      title: r.title,
      description: r.description || blankLegacyText,
      game: r.game,
      server: r.server,
      organizer: r.organizer,
      meetingLocation: r.meetingLocation || blankLegacyText,
      route: r.route || blankLegacyText,
      meetingAt: r.meetingAt,
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      status: r.status,
      origin: r.originCityId ? (labels.get(r.originCityId) ?? null) : null,
      destination: r.destinationCityId ? (labels.get(r.destinationCityId) ?? null) : null,
    };
  }
  async function response(
    tx: TxContext,
    eventId: string,
    memberId: string,
    mode: "update" | "share" = "update",
  ) {
    const [row] = await c(tx)
      .select()
      .from(eventResponses)
      .where(and(eq(eventResponses.eventId, eventId), eq(eventResponses.memberId, memberId)))
      .for(mode);
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
  const responseDto = (
    r: Pick<ResponseRevision, "version" | "status" | "reason"> | null,
  ): S["Rsvp"] => ({
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
  async function ownEventState(tx: TxContext, r: Revision, actor: Actor, receipt?: Receipt) {
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
    return eventMemberFacts(r, ownResponse, ownAttendance?.status);
  }

  function eventMemberFacts(
    r: Pick<
      Revision,
      "visibility" | "prescribedCargoId" | "prescribedMassKg" | "prescribedTrailerId"
    >,
    ownResponse: Parameters<typeof responseDto>[0],
    attendanceStatus: AttendanceRevision["status"] | undefined,
  ) {
    return {
      visibility: r.visibility,
      myResponse: responseDto(ownResponse),
      myAttendance: attendanceStatus ?? ("unconfirmed" as const),
      prescribedCargoId: r.prescribedCargoId,
      prescribedMassKg: r.prescribedMassKg === null ? null : decimal(r.prescribedMassKg),
      prescribedTrailerTypeId: r.prescribedTrailerId,
    };
  }
  async function memberDto(
    tx: TxContext,
    r: Revision,
    actor: Actor,
    receipt?: Receipt,
  ): Promise<S["EventMember"]> {
    const facts = await ownEventState(tx, r, actor, receipt);
    return { event: await publicDto(tx, r), ...facts };
  }

  async function listRevisions(tx: TxContext, actor: Actor | null, options: ListOptions) {
    const period = options.period ?? "upcoming";
    if (!["upcoming", "past"].includes(period)) throw identityError(422);
    const p = page(actor, ["list", period, actor ? "member" : "public"], options);
    const rows = await c(tx)
      .select({ id: events.id, revisionId: events.currentRevisionId, startsAt: events.startsAt })
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
    const { items, nextCursor } = p.finish(rows, (r) => ({ id: r.id, time: r.startsAt }));
    if (!items.length) return { revisions: [], nextCursor };
    const revisions = await c(tx)
      .select(publicRevisionFields)
      .from(eventRevisions)
      .where(
        inArray(
          eventRevisions.id,
          items.map((e) => e.revisionId as string),
        ),
      );
    const byId = new Map(revisions.map((r) => [r.id, r]));
    return {
      nextCursor,
      revisions: items.map((e) => {
        const r = byId.get(e.revisionId as string);
        if (!r) throw new Error("EVENT_REVISION_MISSING");
        return r;
      }),
    };
  }

  async function nearestRevision(tx: TxContext) {
    const [e] = await c(tx)
      .select({ revisionId: events.currentRevisionId })
      .from(events)
      .where(and(eq(events.status, "scheduled"), gte(events.startsAt, at())))
      .orderBy(asc(events.startsAt), asc(events.id))
      .limit(1);
    if (!e) return null;
    const [r] = await c(tx)
      .select(publicRevisionFields)
      .from(eventRevisions)
      .where(eq(eventRevisions.id, applicationId(e.revisionId as string)))
      .for("share");
    if (!r) throw new Error("EVENT_REVISION_MISSING");
    return r;
  }

  async function responseCountsByEvent(tx: TxContext, ids: string[]) {
    const counts = new Map(
      ids.map((id): [string, S["EventResponseCounts"]] => [id, { participating: 0, declined: 0 }]),
    );
    if (!ids.length) return counts;
    const rows = await c(tx)
      .select({
        eventId: eventResponses.eventId,
        status: eventResponses.status,
        total: sql<number | string>`COUNT(*)`,
      })
      .from(eventResponses)
      .where(
        and(
          inArray(eventResponses.eventId, ids),
          inArray(eventResponses.status, ["participating", "declined"]),
        ),
      )
      .groupBy(eventResponses.eventId, eventResponses.status);
    for (const row of rows) {
      const count = counts.get(row.eventId);
      if (count && row.status !== "unanswered") count[row.status] = Number(row.total);
    }
    return counts;
  }

  async function ownResponses(tx: TxContext, actor: Actor, ids: string[]) {
    if (!actor.capabilities.includes("events.respond")) return null;
    const { response, version } = responseDto(null);
    const initial = { response, version };
    const responses = new Map<string, OwnResponse>(ids.map((id) => [id, initial]));
    if (!ids.length) return responses;
    const rows = await c(tx)
      .select({
        eventId: eventResponses.eventId,
        response: eventResponses.status,
        version: eventResponses.version,
      })
      .from(eventResponses)
      .where(and(inArray(eventResponses.eventId, ids), eq(eventResponses.memberId, actor.userId)));
    for (const { eventId, response, version } of rows)
      responses.set(eventId, { response, version });
    return responses;
  }

  async function publishedEventDtos(
    tx: TxContext,
    revisions: readonly PublicRevision[],
    locale: EventLocale,
    privateRefs: { kind: "cargo" | "trailer"; id: string }[] = [],
    includeCover = true,
  ) {
    if (!publishedRoutes || !routeCatalogs) throw identityError(422);
    const refs = revisions.flatMap((r) =>
      [r.originCityId, r.destinationCityId].flatMap((id) =>
        id ? [{ kind: "city" as const, id }] : [],
      ),
    );
    const labels = await routeCatalogs.labelsInTransaction(tx, [...refs, ...privateRefs], locale);
    const fields = await publishedRoutes.publicFieldsInTransaction(tx, revisions);
    const covers = includeCover
      ? await ports.media?.coverIdsInTransaction(
          tx,
          revisions.map((r) => r.eventId),
        )
      : undefined;
    const items = revisions.map((r) => {
      const route = fields.get(r.id);
      if (!route) throw new Error("EVENT_ROUTE_PROJECTION_MISSING");
      const event: S["EventStage2Public"] = {
        ...legacyPublicDto(r, labels),
        ...route.public,
        hasCover: covers?.has(r.eventId) ?? false,
        description: r.description || null,
        meetingLocation: r.meetingLocation || null,
        route: r.route || null,
      };
      return { event, organizerMemberId: route.organizerMemberId, visibility: r.visibility };
    });
    return { items, labels };
  }

  async function adminPublishedPage(
    tx: TxContext,
    actor: Actor,
    locale: EventLocale,
    options: Page,
  ): Promise<S["EventStage2AdminList"]> {
    if (!routeCatalogs || !publishedRoutes) throw identityError(422);
    const p = page(actor, ["admin", "published", locale], options);
    const rows = await c(tx)
      .select({ id: events.id, revisionId: events.currentRevisionId, startsAt: events.startsAt })
      .from(events)
      .where(
        p.after
          ? or(
              gt(events.startsAt, p.after.time as string),
              and(eq(events.startsAt, p.after.time as string), gt(events.id, p.after.id)),
            )
          : undefined,
      )
      .orderBy(asc(events.startsAt), asc(events.id))
      .limit(p.limit + 1);
    const { items, nextCursor } = p.finish(rows, (row) => ({ id: row.id, time: row.startsAt }));
    if (!items.length) return { items: [], nextCursor };
    const ids = items.map((row) => row.id);
    const revisions = await c(tx)
      .select({
        ...publicRevisionFields,
        prescribedCargoId: eventRevisions.prescribedCargoId,
        prescribedMassKg: eventRevisions.prescribedMassKg,
        prescribedTrailerId: eventRevisions.prescribedTrailerId,
      })
      .from(eventRevisions)
      .where(
        inArray(
          eventRevisions.id,
          items.map((row) => applicationId(row.revisionId as string)),
        ),
      );
    const revisionById = new Map(revisions.map((row) => [row.id, row]));
    const responses = await c(tx)
      .select({
        eventId: eventResponses.eventId,
        version: eventResponseRevisions.version,
        status: eventResponseRevisions.status,
        reason: eventResponseRevisions.reason,
      })
      .from(eventResponses)
      .innerJoin(
        eventResponseRevisions,
        and(
          eq(eventResponseRevisions.id, eventResponses.currentRevisionId),
          eq(eventResponseRevisions.eventId, eventResponses.eventId),
          eq(eventResponseRevisions.memberId, eventResponses.memberId),
        ),
      )
      .where(and(inArray(eventResponses.eventId, ids), eq(eventResponses.memberId, actor.userId)));
    const attendances = await c(tx)
      .select({ eventId: eventAttendances.eventId, status: eventAttendanceRevisions.status })
      .from(eventAttendances)
      .innerJoin(
        eventAttendanceRevisions,
        and(
          eq(eventAttendanceRevisions.id, eventAttendances.currentRevisionId),
          eq(eventAttendanceRevisions.eventId, eventAttendances.eventId),
          eq(eventAttendanceRevisions.memberId, eventAttendances.memberId),
        ),
      )
      .where(
        and(inArray(eventAttendances.eventId, ids), eq(eventAttendances.memberId, actor.userId)),
      );
    const ownResponse = new Map(responses.map((row) => [row.eventId, row]));
    const ownAttendance = new Map(attendances.map((row) => [row.eventId, row.status]));
    const privateRefs = revisions.flatMap((row) => [
      ...(row.prescribedCargoId ? [{ kind: "cargo" as const, id: row.prescribedCargoId }] : []),
      ...(row.prescribedTrailerId
        ? [{ kind: "trailer" as const, id: row.prescribedTrailerId }]
        : []),
    ]);
    const privateLabels = await routeCatalogs.labelsInTransaction(tx, privateRefs, locale);
    const { items: projections } = await publishedEventDtos(tx, revisions, locale);
    const byEvent = new Map(projections.map((row) => [row.event.id, row]));
    const counts = await responseCountsByEvent(tx, ids);
    return {
      nextCursor,
      items: items.map(({ id, revisionId }) => {
        const row = revisionById.get(revisionId as string);
        const projection = byEvent.get(id);
        const responseCounts = counts.get(id);
        if (!row || !projection || !responseCounts || row.eventId !== id)
          throw new Error("EVENT_ADMIN_PROJECTION_MISSING");
        return {
          id,
          lifecycle: "published",
          definition: {
            ...projection,
            ...eventMemberFacts(row, ownResponse.get(id) ?? null, ownAttendance.get(id)),
            prescribedCargo: privateLabels.get(row.prescribedCargoId ?? "") ?? null,
            prescribedTrailerType: privateLabels.get(row.prescribedTrailerId ?? "") ?? null,
            responseCounts,
          },
        };
      }),
    };
  }

  function quickResponse(own: OwnResponse | undefined) {
    return own
      ? { myResponse: own.response, myResponseVersion: own.version }
      : { myResponse: null, myResponseVersion: null };
  }

  async function attendancePage(tx: TxContext, actor: Actor, event: Event, options: Page) {
    const id = event.id;
    const p = page(actor, ["attendance", id, event.attendanceVersion], options);
    const rows = await ports.identity.eventRosterInTransaction(
      tx,
      p.after?.id ?? null,
      p.limit + 1,
    );
    const { items, nextCursor } = p.finish(rows, (r) => ({ id: r.id, time: null }));
    const ids = items.map((r) => r.id);
    if (!ids.length) return { items: [], nextCursor };
    const summaries = await ports.identity.memberSummariesInTransaction(tx, ids);
    const responses = await c(tx)
      .select({ memberId: eventResponses.memberId, revision: eventResponseRevisions })
      .from(eventResponses)
      .innerJoin(
        eventResponseRevisions,
        eq(eventResponseRevisions.id, eventResponses.currentRevisionId),
      )
      .where(and(eq(eventResponses.eventId, id), inArray(eventResponses.memberId, ids)));
    const attendances = await c(tx)
      .select({ memberId: eventAttendances.memberId, revision: eventAttendanceRevisions })
      .from(eventAttendances)
      .innerJoin(
        eventAttendanceRevisions,
        eq(eventAttendanceRevisions.id, eventAttendances.currentRevisionId),
      )
      .where(and(eq(eventAttendances.eventId, id), inArray(eventAttendances.memberId, ids)));
    const responseByMember = new Map(
      responses.map(({ memberId, revision }) => [memberId, revision]),
    );
    const attendanceByMember = new Map(
      attendances.map(({ memberId, revision }) => [memberId, revision]),
    );
    return {
      items: items.map(({ id }) => {
        const a = attendanceByMember.get(id);
        return {
          member: summaries.get(id) as S["MemberSummary"],
          response: responseDto(responseByMember.get(id) ?? null),
          attendance: a?.status ?? ("unconfirmed" as const),
          note: a?.note ?? null,
        };
      }),
      nextCursor,
    };
  }

  async function attendanceTotals(tx: TxContext, id: string) {
    // Current attendance rows reference the same all-member roster as the page.
    const total = await ports.identity.eventRosterCountInTransaction(tx);
    const rows = await c(tx)
      .select({ status: eventAttendanceRevisions.status, count: sql<number | string>`COUNT(*)` })
      .from(eventAttendances)
      .innerJoin(
        eventAttendanceRevisions,
        eq(eventAttendanceRevisions.id, eventAttendances.currentRevisionId),
      )
      .where(eq(eventAttendances.eventId, id))
      .groupBy(eventAttendanceRevisions.status);
    const attended = Number(rows.find((row) => row.status === "attended")?.count ?? 0);
    const notAttended = Number(rows.find((row) => row.status === "not_attended")?.count ?? 0);
    return { total, attended, notAttended, unconfirmed: total - attended - notAttended };
  }

  async function readResponseCounts(
    tx: TxContext,
    eventId: string,
  ): Promise<S["EventResponseCounts"]> {
    return (await responseCountsByEvent(tx, [eventId])).get(eventId) as S["EventResponseCounts"];
  }
  async function publishedDto(
    tx: TxContext,
    r: Revision,
    locale: EventLocale,
    actor: Actor | null,
    receipt?: Receipt,
    includeCover = receipt === undefined,
  ): Promise<S["EventStage2Public"] | S["EventStage2Member"]> {
    const refs: { kind: "cargo" | "trailer"; id: string }[] = [];
    if (actor && r.prescribedCargoId) refs.push({ kind: "cargo", id: r.prescribedCargoId });
    if (actor && r.prescribedTrailerId) refs.push({ kind: "trailer", id: r.prescribedTrailerId });
    const {
      items: [projection],
      labels,
    } = await publishedEventDtos(tx, [r], locale, refs, includeCover);
    if (!projection) throw new Error("EVENT_ROUTE_PROJECTION_MISSING");
    if (!actor) return projection.event;
    return {
      ...projection,
      ...(await ownEventState(tx, r, actor, receipt)),
      prescribedCargo: labels.get(r.prescribedCargoId ?? "") ?? null,
      prescribedTrailerType: labels.get(r.prescribedTrailerId ?? "") ?? null,
      responseCounts: receipt?.responseCounts ?? (await readResponseCounts(tx, r.eventId)),
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
    captureCounts = false,
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
            ...(captureCounts
              ? { responseCounts: await readResponseCounts(tx, rawResult.eventId) }
              : {}),
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
    invalidateReminder = true,
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
      if (invalidateReminder)
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
    category: Revision["category"],
    previous: Revision | null,
    details: RouteDetails | null,
    priorDetails: RouteDetails | null,
    reason: string | null = null,
  ) {
    const id = newId();
    if (category !== "cancelled") await validateReferences(tx, value, previous);
    const first = category === "created" || category === "published";
    const version = first ? 1 : e.version + 1,
      sequence = first ? 1 : e.changeSequence + 1;
    let notificationMaterial = first
      ? {
          schemaVersion: 1 as const,
          throughVersion: 1,
          startVersion: 1,
          routeVersion: 1,
          statusVersion: 1,
        }
      : materialState(e.notificationMaterial, e.version);
    if (previous && notificationMaterial?.throughVersion === e.version)
      notificationMaterial = advanceMaterial(
        notificationMaterial,
        previous,
        { ...value, version, status: category === "cancelled" ? "cancelled" : "scheduled" },
        priorDetails,
        details,
      );
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
        originCityId: value.originCityId,
        destinationCityId: value.destinationCityId,
        prescribedCargoId: value.prescribedCargoId,
        prescribedTrailerId: value.prescribedTrailerTypeId,
        privateReason: reason,
      });
    if (details) await publishedRoutes?.insert(tx, id, value.game, details);
    const next = {
      ...e,
      version,
      changeSequence: sequence,
      currentRevisionId: id,
      notificationMaterial,
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
        notificationMaterial,
        game: next.game,
        visibility: next.visibility,
        status: next.status,
        startsAt: next.startsAt,
      })
      .where(eq(events.id, e.id));
    await emit(
      tx,
      actor,
      next,
      "event.changed",
      id,
      version,
      category === "published" ? "created" : category,
      null,
      e.startsAt !== next.startsAt || e.status !== next.status,
    );
    return { eventId: e.id, revisionId: id, version };
  }
  function revisionInput(r: Revision): S["EventInput"] {
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
      originCityId: r.originCityId,
      destinationCityId: r.destinationCityId,
      prescribedCargoId: r.prescribedCargoId,
      prescribedTrailerTypeId: r.prescribedTrailerId,
      prescribedMassKg: r.prescribedMassKg === null ? null : decimal(r.prescribedMassKg),
    };
  }
  const checkVersion = (actual: number, expected: number) => {
    if (actual !== expected) throw identityError(412, "VERSION_CONFLICT");
  };
  function stagedProjection(locale: EventLocale): MemberProjection<S["EventStage2Member"]> {
    if (!publishedRoutes) throw identityError(422);
    return async (tx, r, actor, receipt) => {
      const data = await publishedDto(tx, r, locale, actor, receipt);
      if (!("event" in data)) throw new Error("EVENT_MEMBER_PROJECTION_MISSING");
      return data;
    };
  }
  async function writeDefinition(
    tx: TxContext,
    actor: Actor,
    e: Event,
    command: DefinitionCommand,
    organizer: string | null,
    prior: Revision | null,
    category: "created" | "updated" | "published" = prior ? "updated" : "created",
  ) {
    const priorDetails = prior ? ((await publishedRoutes?.get(tx, prior.id)) ?? null) : null;
    if ("legacy" in command) {
      const value = { ...command.legacy };
      if (prior && publishedRoutes) {
        for (const field of legacyTextFields)
          if (prior[field] === "" && value[field] === blankLegacyText) value[field] = "";
      }
      const details = publishedRoutes ? legacyRouteDetails(value, prior, priorDetails) : null;
      return writeRevision(tx, actor, e, value, category, prior, details, priorDetails);
    }
    if (!publishedRoutes || organizer === null) throw identityError(422);
    text(organizer, 256);
    const {
      platform,
      organizerMemberId,
      originDepotId,
      destinationDepotId,
      distanceKm,
      requiredDlcIds,
      ...input
    } = command.published;
    const details = {
      platform,
      organizerMemberId,
      originDepotId,
      destinationDepotId,
      distanceKm,
      requiredDlcIds,
    };
    await publishedRoutes.validate(tx, input, details, priorDetails);
    const value = {
      ...input,
      organizer,
      description:
        input.description === undefined ? (prior?.description ?? "") : (input.description ?? ""),
      meetingLocation:
        input.meetingLocation === undefined
          ? (prior?.meetingLocation ?? "")
          : (input.meetingLocation ?? ""),
      route: input.route === undefined ? (prior?.route ?? "") : (input.route ?? ""),
    };
    return writeRevision(tx, actor, e, value, category, prior, details, priorDetails);
  }
  function definitionFingerprint(command: DefinitionCommand) {
    return "legacy" in command ? command.legacy : ["published_route", command.published];
  }
  async function insertDefinition(
    tx: TxContext,
    id: string,
    input: Pick<S["EventInput"], "game" | "visibility" | "startsAt">,
  ) {
    const event: Event = {
      id,
      version: 1,
      changeSequence: 1,
      tripAssessmentPending: false,
      notificationPending: true,
      notificationMaterial: null,
      tripAssessmentGeneration: 0,
      attendanceVersion: 1,
      currentRevisionId: null,
      game: input.game,
      visibility: input.visibility,
      status: "scheduled",
      startsAt: input.startsAt,
      createdAt: at(),
    };
    await c(tx).insert(events).values(event);
    return event;
  }
  const drafts =
    config.draftsEnabled && publishedRoutes
      ? createEventDrafts(unit, config.cursorKey, now, {
          run,
          authorize: (tx, actor, organizerId) =>
            authorize(tx, actor, "events.manage", [], organizerId),
          ...(ports.media ? { discardMedia: ports.media.discardInTransaction } : {}),
          async validate(tx, next, prior) {
            if (!next.row.game) return;
            const route = { ...next.row, game: next.row.game };
            await validateReferences(
              tx,
              route,
              prior
                ? {
                    ...prior.row,
                    prescribedTrailerId: prior.row.prescribedTrailerTypeId,
                  }
                : null,
            );
            await publishedRoutes.validate(
              tx,
              route,
              {
                ...next.row,
                requiredDlcIds: next.requiredDlcIds,
              },
              prior ? { ...prior.row, requiredDlcIds: prior.requiredDlcIds } : null,
            );
          },
          async publish(tx, actor, id, raw, organizer, locale) {
            const command = { published: input(publishedRouteInput(raw)) };
            const event = await insertDefinition(tx, id, command.published);
            const receipt = await writeDefinition(
              tx,
              actor,
              event,
              command,
              organizer,
              null,
              "published",
            );
            // The draft publication receipt stores the full response, including the current cover.
            const data = await publishedDto(
              tx,
              await revision(tx, receipt.revisionId),
              locale,
              actor,
              { ...receipt, responseCounts: { participating: 0, declined: 0 } },
              true,
            );
            if (!("event" in data)) throw new Error("EVENT_MEMBER_PROJECTION_MISSING");
            return { revisionId: receipt.revisionId, data };
          },
        })
      : null;
  function createDefinition<T>(
    actor: Actor,
    key: string,
    command: DefinitionCommand,
    project: MemberProjection<T>,
  ) {
    const input = "legacy" in command ? command.legacy : command.published;
    return run(async (tx) => {
      const { organizer } = await authorize(
        tx,
        actor,
        "events.manage",
        [],
        "published" in command ? command.published.organizerMemberId : undefined,
      );
      // The command key is the stable target for a create before the event ID exists.
      const target = applicationId(key);
      await drafts?.rejectDraftCreateKey(tx, actor, key);
      const result = await once(
        tx,
        actor,
        "create",
        target,
        key,
        definitionFingerprint(command),
        async () => {
          const e = await insertDefinition(tx, newId(), input);
          return writeDefinition(tx, actor, e, command, organizer, null);
        },
        "published" in command,
      );
      return {
        data: await project(tx, await revision(tx, result.revisionId), actor, result),
        version: result.version,
      };
    });
  }
  function updateDefinition<T>(
    actor: Actor,
    id: string,
    key: string,
    expected: number,
    command: DefinitionCommand,
    project: MemberProjection<T>,
  ) {
    return run(async (tx) => {
      const { organizer } = await authorize(
        tx,
        actor,
        "events.manage",
        [],
        "published" in command ? command.published.organizerMemberId : undefined,
      );
      const e = await lock(tx, id);
      const result = await once(
        tx,
        actor,
        "update",
        id,
        key,
        [expected, definitionFingerprint(command)],
        async () => {
          checkVersion(e.version, expected);
          if (e.status === "cancelled") throw identityError(409);
          const prior = await revision(tx, e.currentRevisionId as string);
          return writeDefinition(tx, actor, e, command, organizer, prior);
        },
        "published" in command,
      );
      return {
        data: await project(tx, await revision(tx, result.revisionId), actor, result),
        version: result.version,
      };
    });
  }
  function cancelDefinition<T>(
    actor: Actor,
    id: string,
    key: string,
    expected: number,
    reason: string,
    project: MemberProjection<T>,
  ) {
    text(reason, 2048);
    return run(async (tx) => {
      await authorize(tx, actor, "events.manage");
      const e = await lock(tx, id);
      const result = await once(
        tx,
        actor,
        "cancel",
        id,
        key,
        [expected, reason],
        async () => {
          checkVersion(e.version, expected);
          if (e.status === "cancelled") throw identityError(409);
          const prior = await revision(tx, e.currentRevisionId as string);
          const priorDetails = (await publishedRoutes?.get(tx, prior.id)) ?? null;
          const value = revisionInput(prior);
          const details = publishedRoutes
            ? (priorDetails ?? legacyRouteDetails(value, prior, null))
            : null;
          return writeRevision(
            tx,
            actor,
            e,
            value,
            "cancelled",
            prior,
            details,
            priorDetails,
            reason,
          );
        },
        publishedRoutes !== null,
      );
      return {
        data: await project(tx, await revision(tx, result.revisionId), actor, result),
        version: result.version,
      };
    });
  }
  function readDefinition<T>(
    actor: Actor | null,
    id: string,
    project: (tx: TxContext, r: Revision) => Promise<T>,
  ) {
    return run(async (tx) => {
      if (actor) await authorize(tx, actor);
      const e = await lock(tx, id, !actor);
      const r = await revision(tx, e.currentRevisionId as string);
      return { data: await project(tx, r), version: e.version };
    });
  }
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
            prescribedCargoId: r.prescribedCargoId,
            prescribedMassKg: r.prescribedMassKg === null ? null : decimal(r.prescribedMassKg),
            prescribedTrailerTypeId: r.prescribedTrailerId,
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
        JOIN ${eventRevisions} ON ${eventRevisions.id}=${fields.revisionId}
          AND ${eventRevisions.eventId}=${events.id}
        WHERE ${events.id}=${fields.eventId} AND ${eventRevisions.startsAt}=${events.startsAt}
          AND ${eventRevisions.status}='scheduled'
          AND ${eventResponses.currentRevisionId}=${fields.responseRevisionId}
          AND ${eventResponses.status}='participating' AND ${events.status}='scheduled'
          AND ${events.startsAt}>${utcDateTime(fields.now)})`;
    },
    authorize: (actor: Actor, manage = false) =>
      run(async (tx) => {
        await authorize(tx, actor, manage ? "events.manage" : "company.read");
      }),
    publishedRoutesEnabled: publishedRoutes !== null,
    drafts,
    async create(actor: Actor, key: string, raw: S["EventInput"]) {
      return createDefinition(actor, key, { legacy: legacyInput(raw) }, memberDto);
    },
    async createPublished(
      actor: Actor,
      key: string,
      raw: S["EventStage2Input"],
      locale: EventLocale,
    ) {
      return createDefinition(
        actor,
        key,
        { published: input(publishedRouteInput(raw)) },
        stagedProjection(locale),
      );
    },
    async update(actor: Actor, id: string, key: string, expected: number, raw: S["EventInput"]) {
      return updateDefinition(actor, id, key, expected, { legacy: legacyInput(raw) }, memberDto);
    },
    async updatePublished(
      actor: Actor,
      id: string,
      key: string,
      expected: number,
      raw: S["EventStage2Input"],
      locale: EventLocale,
    ) {
      return updateDefinition(
        actor,
        id,
        key,
        expected,
        { published: input(publishedRouteInput(raw)) },
        stagedProjection(locale),
      );
    },
    async cancel(actor: Actor, id: string, key: string, expected: number, reason: string) {
      return cancelDefinition(actor, id, key, expected, reason, memberDto);
    },
    async cancelPublished(
      actor: Actor,
      id: string,
      key: string,
      expected: number,
      reason: string,
      locale: EventLocale,
    ) {
      return cancelDefinition(actor, id, key, expected, reason, stagedProjection(locale));
    },
    async get(actor: Actor | null, id: string) {
      return readDefinition<S["EventMember"] | S["EventPublic"]>(actor, id, (tx, r) =>
        actor ? memberDto(tx, r, actor) : publicDto(tx, r),
      );
    },
    async getPublished(actor: Actor | null, id: string, locale: EventLocale) {
      return readDefinition(actor, id, (tx, r) => publishedDto(tx, r, locale, actor));
    },
    async list(actor: Actor | null, options: ListOptions = {}) {
      return run(async (tx) => {
        if (actor) await authorize(tx, actor);
        const { revisions, nextCursor } = await listRevisions(tx, actor, options);
        const labels = await routeLabels(tx, revisions);
        return {
          items: await Promise.all(revisions.map((r) => publicDto(tx, r, labels))),
          nextCursor,
        };
      });
    },
    async listPublishedPublic(
      locale: EventLocale,
      options: ListOptions = {},
    ): Promise<S["EventStage2PublicList"]> {
      return run(async (tx) => {
        const { revisions, nextCursor } = await listRevisions(tx, null, options);
        const { items } = await publishedEventDtos(tx, revisions, locale);
        return { items: items.map(({ event }) => event), nextCursor };
      });
    },
    async nearest(actor: Actor) {
      return run(async (tx) => {
        await authorize(tx, actor);
        const r = await nearestRevision(tx);
        return r ? publicDto(tx, r) : null;
      });
    },
    async listAdmin(
      actor: Actor,
      options: Page & { period?: "published" | "drafts"; locale?: EventLocale } = {},
    ): Promise<S["EventStage2AdminList"]> {
      if (options.period === "drafts") {
        if (!drafts) throw identityError(404);
        return drafts.list(actor, options);
      }
      return run(async (tx) => {
        await authorize(tx, actor, "events.manage");
        return adminPublishedPage(tx, actor, options.locale ?? "en", options);
      });
    },
    async listStage2(
      actor: Actor,
      locale: EventLocale,
      options: ListOptions = {},
    ): Promise<S["EventStage2MemberList"]> {
      return run(async (tx) => {
        await authorize(tx, actor);
        const { revisions, nextCursor } = await listRevisions(tx, actor, options);
        const ids = revisions.map((r) => r.eventId);
        const counts = await responseCountsByEvent(tx, ids);
        const own = await ownResponses(tx, actor, ids);
        const { items } = await publishedEventDtos(tx, revisions, locale);
        return {
          items: items.map((item) => ({
            ...item,
            ...quickResponse(own?.get(item.event.id)),
            responseCounts: counts.get(item.event.id) as S["EventResponseCounts"],
          })),
          nextCursor,
        };
      });
    },
    async nearestStage2(
      actor: Actor,
      locale: EventLocale,
    ): Promise<S["EventStage2Upcoming"] | null> {
      return run(async (tx) => {
        await authorize(tx, actor);
        const r = await nearestRevision(tx);
        if (!r) return null;
        const {
          items: [projection],
        } = await publishedEventDtos(tx, [r], locale);
        if (!projection) throw new Error("EVENT_ROUTE_PROJECTION_MISSING");
        const own = (await ownResponses(tx, actor, [r.eventId]))?.get(r.eventId);
        return { event: projection.event, ...quickResponse(own) };
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
    participants(actor: Actor, id: string, options: Page = {}) {
      return responders(actor, id, "participating", options);
    },
    decliners(actor: Actor, id: string, options: Page = {}) {
      return responders(actor, id, "declined", options);
    },
    async responseCounts(actor: Actor, id: string): Promise<S["EventResponseCounts"]> {
      return run(async (tx) => {
        await authorize(tx, actor);
        await lock(tx, id);
        // Counts only: no unanswered total, identities or reasons leave this read.
        return (await responseCountsByEvent(tx, [id])).get(id) as S["EventResponseCounts"];
      });
    },
    async nonresponders(
      actor: Actor,
      id: string,
      options: Page = {},
    ): Promise<S["EventStage2Nonresponders"]> {
      return run(async (tx) => {
        await authorize(tx, actor, "events.manage");
        await lock(tx, id, false, "share");
        const p = page(actor, ["nonresponders", id], options);
        const rows = await ports.identity.eventEligibleMembersInTransaction(
          tx,
          p.after?.id ?? null,
          p.limit + 1,
          (memberId) =>
            notExists(
              c(tx)
                .select({ id: eventResponses.id })
                .from(eventResponses)
                .where(
                  and(
                    eq(eventResponses.eventId, id),
                    eq(eventResponses.memberId, memberId),
                    inArray(eventResponses.status, ["participating", "declined"]),
                  ),
                ),
            ),
        );
        const { items, nextCursor } = p.finish(rows, (r) => ({ id: r.id, time: null }));
        const summaries = await ports.identity.memberSummariesInTransaction(
          tx,
          items.map((r) => r.id),
        );
        return {
          items: items.map((r) => summaries.get(r.id) as S["MemberSummary"]),
          nextCursor,
        };
      });
    },
    async attendance(actor: Actor, id: string, options: Page = {}) {
      return run(async (tx) => {
        await authorize(tx, actor, "events.manage");
        const e = await lock(tx, id);
        return { data: await attendancePage(tx, actor, e, options), version: e.attendanceVersion };
      });
    },
    async attendanceStage2(
      actor: Actor,
      id: string,
      options: Page = {},
    ): Promise<{ data: S["EventStage2Attendance"]; version: number }> {
      return run(async (tx) => {
        await authorize(tx, actor, "events.manage");
        const e = await lock(tx, id, false, "share");
        const { items, nextCursor } = await attendancePage(tx, actor, e, options);
        const totals = await attendanceTotals(tx, e.id);
        const trips = await ports.attendanceTripIds?.(
          tx,
          actor,
          e.id,
          e.game,
          items.map((item) => item.member.id),
        );
        return {
          data: {
            items: items.map((item) => ({ ...item, tripId: trips?.get(item.member.id) ?? null })),
            nextCursor,
            totals,
          },
          version: e.attendanceVersion,
        };
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
    async repairNotificationScheduleInTransaction(tx: TxContext, change: CompanyEvent) {
      if (change.type !== "event.changed" && change.type !== "event.response_changed")
        throw new Error("NOTIFICATION_EVENT_REFERENCE_CONFLICT");
      // Own the mutable marker before taking shared immutable-history locks.
      const e = await lock(tx, change.data.eventId),
        r = await revision(tx, change.data.eventRevisionId);
      let valid = r.eventId === e.id && change.data.changeSequence <= e.changeSequence;
      if (change.type === "event.changed") {
        valid &&=
          change.aggregate.id === e.id &&
          r.id === change.data.revisionId &&
          r.version === change.aggregate.version &&
          r.sequence === change.data.changeSequence;
      } else {
        const [responseRevision] = await c(tx)
          .select({
            eventId: eventResponseRevisions.eventId,
            responseId: eventResponseRevisions.responseId,
            memberId: eventResponseRevisions.memberId,
            version: eventResponseRevisions.version,
            sequence: eventResponseRevisions.sequence,
          })
          .from(eventResponseRevisions)
          .where(eq(eventResponseRevisions.id, change.data.revisionId))
          .for("share");
        valid &&=
          responseRevision !== undefined &&
          responseRevision.eventId === e.id &&
          responseRevision.responseId === change.aggregate.id &&
          responseRevision.memberId === change.data.memberId &&
          responseRevision.version === change.aggregate.version &&
          responseRevision.sequence === change.data.changeSequence &&
          r.sequence < responseRevision.sequence;
      }
      if (!valid) throw new Error("NOTIFICATION_EVENT_REFERENCE_CONFLICT");
      await c(tx).update(events).set({ notificationPending: true }).where(eq(events.id, e.id));
    },
    // Safe future-consumer seam: immutable change order reconstructs RSVP recipients at that change.
    notificationMaterialInTransaction: (tx: TxContext, change: CompanyEvent) =>
      notificationMaterial(tx, change, false),
    prepareNotificationMaterialInTransaction: (tx: TxContext, change: CompanyEvent) =>
      notificationMaterial(tx, change, true),
    async repairPendingNotificationMaterialInTransaction(tx: TxContext) {
      // One indexed Event and at most 25 forward definitions; this phase never locks recipients.
      const [e] = await c(tx)
        .select()
        .from(events)
        .where(eq(events.notificationMaterialPending, true))
        .orderBy(asc(events.id))
        .limit(1)
        .for("update", { skipLocked: true });
      return e ? { eventId: e.id, ...(await repairMaterial(tx, e)) } : null;
    },
    async notificationChangeInTransaction(tx: TxContext, change: CompanyEvent) {
      const e = await lock(tx, change.data.eventId, false, "share");
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
      const details =
        prior && r.status !== "cancelled" && prior.startsAt === r.startsAt
          ? await publishedRoutes?.detailsInTransaction(tx, [prior.id, r.id])
          : undefined;
      const changed =
        r.status === "cancelled"
          ? "event.cancelled"
          : prior && prior.startsAt !== r.startsAt
            ? "event.start_changed"
            : prior &&
                routeChanged(prior, r, details?.get(prior.id) ?? null, details?.get(r.id) ?? null)
              ? "event.route_changed"
              : null;
      const current =
        e.currentRevisionId === r.id ? r : await revision(tx, e.currentRevisionId as string);
      return {
        eventId: e.id,
        revisionId: r.id,
        version: r.version,
        effective:
          changed !== null &&
          materialChangeCurrent(
            changed,
            r.version,
            current,
            materialState(e.notificationMaterial, e.version),
          ),
        category: changed,
        title: current.title,
        game: current.game,
        startsAt: r.startsAt,
      };
    },
    /** Uses the same public/member visibility as event details. The game validates the trip reference. */
    async tripTitlesInTransaction(
      tx: TxContext,
      ids: string[],
      actor: Actor,
    ): Promise<Map<string, { id: string; title: string; game: Event["game"] }>> {
      if (ids.length > 100) throw new Error("EVENT_TITLE_BATCH_BOUND_EXCEEDED");
      if (!ids.length) return new Map();
      await authorize(tx, actor);
      const rows = await c(tx)
        .select({ id: events.id, title: eventRevisions.title, game: events.game })
        .from(events)
        .innerJoin(
          eventRevisions,
          and(
            eq(eventRevisions.id, events.currentRevisionId),
            eq(eventRevisions.eventId, events.id),
            eq(eventRevisions.game, events.game),
          ),
        )
        .where(inArray(events.id, ids))
        .for("share");
      return new Map(rows.map((row) => [row.id, row]));
    },
    async notificationChangeProjectionsInTransaction(
      tx: TxContext,
      requests: { eventId: string; version: number; category: string }[],
    ) {
      // This is the existing HTTP page bound, not a new event or company policy.
      if (requests.length > 100) throw new Error("NOTIFICATION_PROJECTION_BOUND_EXCEEDED");
      if (!requests.length)
        return new Map<string, { title: string; game: "ets2" | "ats"; effective: boolean }>();
      const current = alias(eventRevisions, "notification_current_definition");
      const rows = await c(tx)
        .select({
          eventId: events.id,
          material: events.notificationMaterial,
          version: eventRevisions.version,
          status: current.status,
          currentVersion: current.version,
          startsAt: current.startsAt,
          route: current.route,
          meetingLocation: current.meetingLocation,
          title: current.title,
          game: current.game,
        })
        .from(events)
        .innerJoin(eventRevisions, eq(eventRevisions.eventId, events.id))
        .innerJoin(current, eq(current.id, events.currentRevisionId))
        .where(
          or(
            ...requests.map((request) =>
              and(
                eq(events.id, applicationId(request.eventId)),
                eq(eventRevisions.version, request.version),
              ),
            ),
          ),
        )
        .orderBy(asc(events.id), asc(eventRevisions.version))
        .for("share");
      const definitions = new Map(rows.map((row) => [`${row.eventId}:${row.version}`, row]));
      return new Map(
        requests.flatMap((request) => {
          const row = definitions.get(`${request.eventId}:${request.version}`);
          if (!row) return [];
          return [
            [
              `${request.eventId}:${request.version}:${request.category}`,
              {
                title: row.title,
                game: row.game,
                effective: materialChangeCurrent(
                  request.category,
                  request.version,
                  { status: row.status, version: row.currentVersion },
                  materialState(row.material, row.currentVersion),
                ),
              },
            ] as const,
          ];
        }),
      );
    },
    async notificationScheduleInTransaction(
      tx: TxContext,
      id: string,
      after: string | null = null,
      limit = 25,
    ) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 25)
        throw new Error("NOTIFICATION_REMINDER_BOUND_EXCEEDED");
      const e = await lock(tx, id, false, "share"),
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
      const e = await lock(tx, eventId, false, "share");
      const r = await response(tx, eventId, memberId, "share"),
        original = await revision(tx, revisionId);
      return (
        e.status === "scheduled" &&
        original.eventId === e.id &&
        original.status === "scheduled" &&
        original.startsAt === e.startsAt &&
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
        .for("update", { skipLocked: true });
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
