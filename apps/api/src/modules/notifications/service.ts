import { createHmac, timingSafeEqual } from "node:crypto";
import type { components } from "@vtc/contracts";
import { applicationId, newId, opaqueUtf8, type TxContext, type UnitOfWork } from "@vtc/db";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  lte,
  type notificationAccess,
  notificationCommands,
  notifications,
  or,
  preferenceNames,
  recipientStates,
  sql,
} from "@vtc/db/notifications-schema";
import {
  createQueue,
  type Handler,
  type PendingSubscription,
  retryTransaction,
} from "../../platform/jobs/queue.js";
import {
  closed,
  createOutbox,
  type DomainEvent,
  notificationEventTypes,
  positive,
} from "../../platform/outbox/events.js";
import { notificationAdmissionState } from "../admissions/service.js";
import type { Events } from "../events/service.js";
import { type Actor, type Identity, identityError } from "../identity/service.js";
import type { ManualReports } from "../manual-reports/service.js";
import type { Qualifications } from "../qualifications/service.js";
import { canonicalJson } from "../sources/contracts/canonical.js";
import type { TripDecisions } from "../trip-decisions/service.js";
import type { Trips } from "../trips/service.js";
import { notificationCursors } from "./cursor.js";
import { freshnessMs, reminderWindow, sourceLiveUntil } from "./policy.js";

type S = components["schemas"];
type Row = typeof notifications.$inferSelect;
type State = typeof recipientStates.$inferSelect;
type Access = (typeof notificationAccess)[number];
type Preference = (typeof preferenceNames)[number];
type Route = typeof notificationCommands.$inferSelect.route;
type Result = typeof notificationCommands.$inferSelect.result;
export interface NotificationsConfig {
  cursorKey: string;
}
export function validateNotificationsConfig(c: NotificationsConfig) {
  if (!/^[0-9a-f]{64}$/.test(c.cursorKey)) throw new Error("INVALID_NOTIFICATIONS_CONFIG");
}
interface Ports {
  manual: Pick<ManualReports, "notificationReviewInTransaction">;
  identity: Pick<
    Identity,
    | "authorizeInTransaction"
    | "notificationMembersInTransaction"
    | "notificationRosterInTransaction"
    | "qualificationContextInTransaction"
  >;
  trips: Pick<
    Trips,
    | "eventContextInTransaction"
    | "notificationStateInTransaction"
    | "notificationTargetsInTransaction"
  >;
  events: Pick<
    Events,
    | "notificationChangeInTransaction"
    | "recipientsInTransaction"
    | "notificationScheduleInTransaction"
    | "reminderEligibleInTransaction"
    | "pendingNotificationsInTransaction"
    | "acknowledgeNotificationsInTransaction"
    | "notificationReminderCondition"
  >;
  qualifications: Pick<
    Qualifications,
    "notificationAssignmentInTransaction" | "notificationPromotionReviewInTransaction"
  >;
  decisions: Pick<TripDecisions, "notificationDecisionInTransaction">;
}
export function eventReference(raw: unknown) {
  const v = closed(raw, ["eventId", "after"]);
  return {
    eventId: applicationId(v.eventId as string),
    after: v.after === null ? null : applicationId(v.after as string),
  };
}
export function reminderReference(raw: unknown) {
  const v = closed(raw, ["eventId", "generation", "after"]);
  return {
    eventId: applicationId(v.eventId as string),
    generation: positive(v.generation),
    after: v.after === null ? null : applicationId(v.after as string),
  };
}
// Enabled composition installs this facade in Events. Definitions invalidate all generations;
// RSVP invalidates only that member. No decline reason crosses this boundary.
export async function invalidateEventNotifications(
  unit: UnitOfWork,
  tx: TxContext,
  eventId: string,
  memberId: string | null,
) {
  await unit
    .client(tx)
    .update(notifications)
    .set({ invalidatedAt: sql`UTC_TIMESTAMP(3)` })
    .where(
      and(
        eq(notifications.subjectKind, "event"),
        eq(notifications.subjectId, applicationId(eventId)),
        eq(notifications.category, "event.reminder"),
        isNull(notifications.invalidatedAt),
        memberId ? eq(notifications.recipientId, applicationId(memberId)) : undefined,
      ),
    );
}
export function createNotifications(
  unit: UnitOfWork,
  config: NotificationsConfig,
  ports: Ports,
  now = () => new Date(),
) {
  validateNotificationsConfig(config);
  const c = (tx: TxContext) => unit.client(tx),
    run = <T>(fn: (tx: TxContext) => Promise<T>) => retryTransaction(unit, fn),
    at = () => now().toISOString(),
    cursor = notificationCursors(config.cursorKey),
    outbox = createOutbox(unit);
  const authorize = (tx: TxContext, a: Actor) =>
    ports.identity.authorizeInTransaction(tx, a, "company.read");
  async function state(tx: TxContext, id: string): Promise<State> {
    await c(tx)
      .insert(recipientStates)
      .values({ recipientId: applicationId(id) })
      .onDuplicateKeyUpdate({ set: { recipientId: applicationId(id) } });
    const [row] = await c(tx)
      .select()
      .from(recipientStates)
      .where(eq(recipientStates.recipientId, id))
      .for("update");
    if (!row) throw new Error("NOTIFICATION_RECIPIENT_MISSING");
    return row;
  }
  const preferences = (r: State): S["NotificationPreferences"] => ({
    tripStarted: r.tripStarted,
    tripFinished: r.tripFinished,
    tripRejected: r.tripRejected,
    eventChanges: r.eventChanges,
    eventReminders: r.eventReminders,
    qualificationChanges: r.qualificationChanges,
  });
  function visible(a: Actor) {
    const access: Access[] = [
      "company",
      ...(
        ["trips.review", "applications.manage", "qualifications.manage", "members.manage"] as const
      ).filter((cap) => a.capabilities.includes(cap)),
    ];
    return and(
      eq(notifications.recipientId, a.userId),
      isNull(notifications.invalidatedAt),
      or(isNull(notifications.expiresAt), gt(notifications.expiresAt, at())),
      or(
        sql`${notifications.category}<>'event.reminder'`,
        and(
          eq(notifications.recipientAccessEpoch, a.accessEpoch),
          a.capabilities.includes("events.respond") ? sql`TRUE` : sql`FALSE`,
          ports.events.notificationReminderCondition({
            eventId: notifications.subjectId,
            memberId: notifications.recipientId,
            revisionId: notifications.reminderRevisionId,
            responseRevisionId: notifications.reminderResponseId,
            now: at(),
          }),
        ),
      ),
      or(inArray(notifications.access, access), eq(notifications.ownerId, a.userId)),
    );
  }
  async function once(
    tx: TxContext,
    a: Actor,
    route: Route,
    key: string,
    value: unknown,
    command: () => Promise<Result>,
  ) {
    applicationId(key);
    const fingerprint = createHmac("sha256", Buffer.from(config.cursorKey, "hex"))
      .update("notifications/command/v1\0")
      .update(canonicalJson([a.userId, route, key, value]))
      .digest();
    const [saved] = await c(tx)
      .select()
      .from(notificationCommands)
      .where(
        and(
          eq(notificationCommands.recipientId, a.userId),
          eq(notificationCommands.route, route),
          eq(notificationCommands.key, key),
        ),
      )
      .for("share");
    if (saved) {
      if (!timingSafeEqual(saved.fingerprint, fingerprint))
        throw identityError(409, "IDEMPOTENCY_CONFLICT");
      return saved.result;
    }
    const result = await command();
    await c(tx)
      .insert(notificationCommands)
      .values({ recipientId: a.userId, route, key, fingerprint, result });
    return result;
  }
  async function project(
    tx: TxContext,
    a: Actor,
    rows: Row[],
    history: boolean,
  ): Promise<S["Notification"][]> {
    const targets = await ports.trips.notificationTargetsInTransaction(
        tx,
        rows.filter((r) => r.subjectKind === "trip").map((r) => r.subjectId),
        a,
      ),
      items: S["Notification"][] = [];
    for (const r of rows) {
      if (
        r.category === "event.reminder" &&
        (!r.reminderRevisionId ||
          !r.reminderResponseId ||
          !(await ports.events.reminderEligibleInTransaction(
            tx,
            r.subjectId,
            a.userId,
            r.reminderRevisionId,
            r.reminderResponseId,
          )))
      ) {
        await c(tx)
          .update(notifications)
          .set({ invalidatedAt: at() })
          .where(eq(notifications.id, r.id));
        continue;
      }
      const trip = r.subjectKind === "trip" ? targets.get(r.subjectId) : null;
      const targetId = r.subjectKind === "trip" ? trip?.target : r.subjectId;
      items.push({
        id: r.id,
        category: r.category,
        messageKey: `notifications.${r.category}`,
        display: { actorNickname: r.actorNickname, game: r.game, eventTitle: r.eventTitle },
        target: targetId ? { kind: r.subjectKind, id: targetId } : null,
        occurredAt: r.occurredAt,
        readAt: r.readAt,
        liveToastEligible:
          !(r.category === "trip.started" && trip?.outcome !== "open") &&
          !history &&
          r.readAt === null &&
          r.liveUntil !== null &&
          r.liveUntil >= at(),
      });
    }
    return items;
  }
  interface Delivery {
    category: string;
    preference: Preference;
    access: Access;
    ownerId: string | null;
    subjectKind: Row["subjectKind"];
    subjectId: string;
    subjectVersion: number;
    effectKey: string;
    occurredAt: string;
    liveUntil: string | null;
    nickname?: string | null;
    game?: "ets2" | "ats" | null;
    title?: string | null;
    groupIds?: string[];
    lifecycle?: "start" | "end";
    reminderRevisionId?: string;
    reminderResponseId?: string;
    expiresAt?: string;
  }
  async function insert(
    tx: TxContext,
    recipient: Awaited<
      ReturnType<Ports["identity"]["notificationMembersInTransaction"]>
    > extends Map<string, infer V>
      ? V
      : never,
    d: Delivery,
  ) {
    if (
      !recipient.active ||
      (d.access !== "company" &&
        d.ownerId !== recipient.id &&
        !recipient.capabilities.includes(d.access))
    )
      return;
    const s = await state(tx, recipient.id);
    if (!s[d.preference]) return;
    const [existing] = await c(tx)
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientId, recipient.id),
          or(
            eq(notifications.effectKey, opaqueUtf8(d.effectKey, 128)),
            d.lifecycle
              ? and(
                  eq(notifications.subjectKind, "trip"),
                  inArray(notifications.subjectId, d.groupIds ?? [d.subjectId]),
                  inArray(
                    notifications.category,
                    d.lifecycle === "start"
                      ? ["trip.started"]
                      : ["trip.finished", "trip.cancelled"],
                  ),
                )
              : undefined,
          ),
        ),
      )
      .limit(1)
      .for("share");
    if (existing) return;
    const sequence = (BigInt(s.sequence) + 1n).toString();
    await c(tx)
      .insert(notifications)
      .values({
        id: newId(),
        recipientId: recipient.id,
        sequence,
        effectKey: opaqueUtf8(d.effectKey, 128),
        category: d.category,
        access: d.access,
        ownerId: d.ownerId,
        subjectKind: d.subjectKind,
        subjectId: d.subjectId,
        subjectVersion: d.subjectVersion,
        actorNickname: d.nickname ?? null,
        game: d.game ?? null,
        eventTitle: d.title ?? null,
        occurredAt: d.occurredAt,
        liveUntil: d.liveUntil,
        reminderRevisionId: d.reminderRevisionId ?? null,
        reminderResponseId: d.reminderResponseId ?? null,
        expiresAt: d.expiresAt ?? null,
        recipientAccessEpoch: recipient.accessEpoch,
      });
    await c(tx)
      .update(recipientStates)
      .set({ sequence })
      .where(eq(recipientStates.recipientId, recipient.id));
  }
  async function description(tx: TxContext, e: DomainEvent): Promise<Delivery | null> {
    const base = {
      subjectVersion: e.aggregate.version,
      occurredAt: e.occurredAt,
      liveUntil: new Date(Date.parse(e.occurredAt) + freshnessMs).toISOString(),
    };
    if (e.type === "trip.lifecycle_changed") {
      const source = await ports.trips.eventContextInTransaction(tx, e.data.sourceRecordId);
      if (!source || source.factRevisionId !== e.data.factRevisionId)
        throw new Error("NOTIFICATION_SOURCE_REFERENCE_CONFLICT");
      if (source.provider !== "ets2telemetry") return null;
      const trip = await ports.trips.notificationStateInTransaction(tx, e.data.tripId);
      if (trip.id !== source.tripId) throw new Error("NOTIFICATION_TRIP_REFERENCE_CONFLICT");
      const start = source.outcome === "open",
        time = start ? source.start : source.end;
      if (!["open", "delivered", "cancelled"].includes(source.outcome)) return null;
      const members = await ports.identity.notificationMembersInTransaction(tx, [trip.ownerId]);
      return {
        ...base,
        category: start
          ? "trip.started"
          : source.outcome === "cancelled"
            ? "trip.cancelled"
            : "trip.finished",
        preference: start ? "tripStarted" : "tripFinished",
        access: "company",
        ownerId: trip.ownerId,
        subjectKind: "trip",
        subjectId: trip.id,
        subjectVersion: trip.version,
        effectKey: `trip:${trip.id}:${start ? "start" : "end"}`,
        occurredAt: time.utc ?? e.occurredAt,
        liveUntil: start && trip.outcome !== "open" ? null : sourceLiveUntil(source, time),
        nickname: members.get(trip.ownerId)?.nickname ?? null,
        game: trip.game,
        groupIds: trip.groupIds,
        lifecycle: start ? "start" : "end",
      };
    }
    if (e.type === "trip.decision_changed") {
      const decision = await ports.decisions.notificationDecisionInTransaction(
        tx,
        e.data.decisionId,
      );
      if (decision.tripId !== e.aggregate.id)
        throw new Error("NOTIFICATION_DECISION_REFERENCE_CONFLICT");
      if (!decision.current || decision.outcome !== "rejected") return null;
      const trip = await ports.trips.notificationStateInTransaction(tx, decision.tripId);
      return {
        ...base,
        category: "trip.rejected",
        preference: "tripRejected",
        access: "trips.review",
        ownerId: trip.ownerId,
        subjectKind: "trip",
        subjectId: trip.id,
        effectKey: `rejected:${e.data.decisionId}`,
        game: trip.game,
      };
    }
    if (e.type === "manual.report_submitted" || e.type === "manual.correction_requested") {
      if (
        !(await ports.manual.notificationReviewInTransaction(
          tx,
          e.type,
          e.aggregate.id,
          e.data.resourceId,
          e.data.tripId as string,
        ))
      )
        return null;
      const trip = await ports.trips.notificationStateInTransaction(tx, e.data.tripId as string);
      if (e.type === "manual.report_submitted" && trip.decision !== "pending_review") return null;
      return {
        ...base,
        category:
          e.type === "manual.report_submitted"
            ? "trip.review_required"
            : "trip.correction_requested",
        preference: "tripRejected",
        access: "trips.review",
        ownerId: trip.ownerId,
        subjectKind: "trip",
        subjectId: trip.id,
        effectKey: `review:${e.data.resourceId}`,
        game: trip.game,
      };
    }
    if (
      e.type === "qualification.assigned" ||
      e.type === "qualification.promoted" ||
      e.type === "qualification.progress_changed" ||
      e.type === "promotion.review_required"
    ) {
      const assignment = await ports.qualifications.notificationAssignmentInTransaction(
        tx,
        e.data.assignmentId as string,
      );
      if (assignment.userId !== e.data.userId)
        throw new Error("NOTIFICATION_ASSIGNMENT_REFERENCE_CONFLICT");
      if (
        e.type !== "promotion.review_required" &&
        (assignment.endedAt !== null || assignment.purpose === "historical_resolution")
      )
        return null;
      if (e.type === "qualification.assigned" && assignment.purpose === "promotion") return null;
      if (
        e.type === "qualification.progress_changed" &&
        (e.aggregate.version !== assignment.revision || !assignment.eligible)
      )
        return null;
      if (
        e.type === "promotion.review_required" &&
        !(await ports.qualifications.notificationPromotionReviewInTransaction(
          tx,
          e.aggregate.id,
          e.aggregate.version,
          assignment.id,
        ))
      )
        return null;
      return {
        ...base,
        category: e.type === "qualification.progress_changed" ? "promotion.eligible" : e.type,
        preference: "qualificationChanges",
        access: "qualifications.manage",
        ownerId: assignment.userId,
        subjectKind: "qualification",
        subjectId: assignment.id,
        effectKey:
          e.type === "qualification.progress_changed"
            ? `eligible:${assignment.id}`
            : `${e.type}:${e.aggregate.id}:${e.aggregate.version}`,
        game: assignment.game,
      };
    }
    if (e.type === "application.submitted" || e.type === "application.decided") {
      const current = await notificationAdmissionState(unit, tx, e.data.applicationId);
      if (
        current.version !== e.aggregate.version ||
        (e.type === "application.submitted"
          ? current.status !== "submitted"
          : current.status === "submitted")
      )
        return null;
      return {
        ...base,
        category: e.type,
        preference: "eventChanges",
        access: "applications.manage",
        ownerId: null,
        subjectKind: "application",
        subjectId: e.data.applicationId,
        effectKey: `${e.type}:${e.data.applicationId}:${e.aggregate.version}`,
      };
    }
    if (e.type === "member.access_changed") {
      const member = (
        await ports.identity.notificationMembersInTransaction(tx, [e.data.userId])
      ).get(e.data.userId);
      if (!member || member.accessEpoch !== e.data.accessEpoch) return null;
      return {
        ...base,
        category: e.type,
        preference: "eventChanges",
        access: "members.manage",
        ownerId: null,
        subjectKind: "member",
        subjectId: e.data.userId,
        effectKey: `access:${e.data.userId}:${e.data.accessEpoch}`,
        nickname: member.nickname,
      };
    }
    if (e.type === "event.changed") {
      const change = await ports.events.notificationChangeInTransaction(tx, e);
      if (!change.current || !change.category) return null;
      return {
        ...base,
        category: change.category,
        preference: "eventChanges",
        access: "company",
        ownerId: null,
        subjectKind: "event",
        subjectId: change.eventId,
        effectKey: `event:${change.eventId}:${change.version}`,
        title: change.title,
        game: change.game,
      };
    }
    return null;
  }
  const handler: Handler = {
    kind: "notifications.deliver",
    version: 1,
    consumer: "notifications.v1",
    mode: "local",
    validate: eventReference,
    local: async (tx, raw) => {
      const ref = eventReference(raw);
      await ports.identity.qualificationContextInTransaction(tx, []);
      const e = await outbox.readInTransaction(tx, ref.eventId),
        d = await description(tx, e);
      if (!d) return;
      const ids =
        e.type === "event.changed"
          ? await ports.events.recipientsInTransaction(
              tx,
              e.data.eventId,
              e.data.changeSequence,
              ref.after,
              25,
            )
          : (await ports.identity.notificationRosterInTransaction(tx, ref.after, 25)).map(
              (r) => r.id,
            );
      const recipients = await ports.identity.notificationMembersInTransaction(tx, ids);
      for (const id of ids) {
        const recipient = recipients.get(id);
        if (recipient) await insert(tx, recipient, d);
      }
      if (ids.length === 25)
        await enqueueEvent(tx, ref.eventId, ids.at(-1) as string, e.occurredAt);
    },
  };
  const reminderHandler: Handler = {
    kind: "notifications.remind",
    version: 1,
    consumer: "notifications.reminders.v1",
    mode: "local",
    validate: reminderReference,
    local: async (tx, raw) => {
      const ref = reminderReference(raw);
      await ports.identity.qualificationContextInTransaction(tx, []);
      const event = await ports.events.notificationScheduleInTransaction(
          tx,
          ref.eventId,
          ref.after,
        ),
        window = reminderWindow(event.startsAt, at());
      if (event.status !== "scheduled" || event.generation !== ref.generation || !window.eligible)
        return;
      const recipients = await ports.identity.notificationMembersInTransaction(
        tx,
        event.members.map((m) => m.id),
      );
      for (const m of event.members) {
        const recipient = recipients.get(m.id);
        if (!recipient?.capabilities.includes("events.respond")) continue;
        if (
          !(await ports.events.reminderEligibleInTransaction(
            tx,
            event.eventId,
            m.id,
            event.revisionId,
            m.responseRevisionId,
          ))
        )
          continue;
        await insert(tx, recipient, {
          category: "event.reminder",
          preference: "eventReminders",
          access: "company",
          ownerId: null,
          subjectKind: "event",
          subjectId: event.eventId,
          subjectVersion: ref.generation,
          effectKey: `reminder:${event.revisionId}:${m.responseRevisionId}`,
          occurredAt: window.due,
          liveUntil: new Date(Date.parse(window.due) + freshnessMs).toISOString(),
          title: event.title,
          game: event.game,
          reminderRevisionId: event.revisionId,
          reminderResponseId: m.responseRevisionId,
          expiresAt: event.startsAt,
        });
      }
      if (event.members.length === 25)
        await enqueueReminder(tx, { ...ref, after: event.members.at(-1)?.id ?? null }, window.due);
    },
  };
  const queue = createQueue(unit, [handler, reminderHandler]);
  async function enqueueEvent(tx: TxContext, eventId: string, after: string, availableAt: string) {
    await queue.enqueue(tx, {
      kind: handler.kind,
      schemaVersion: 1,
      consumer: handler.consumer,
      effectKey: `${eventId}:${after}`,
      eventId: null,
      reference: { eventId, after },
      availableAt,
      maxAttempts: 5,
    });
  }
  async function enqueueReminder(
    tx: TxContext,
    reference: ReturnType<typeof reminderReference>,
    availableAt: string,
  ) {
    await queue.enqueue(tx, {
      kind: reminderHandler.kind,
      schemaVersion: 1,
      consumer: reminderHandler.consumer,
      effectKey: `${reference.eventId}:${reference.generation}:${reference.after ?? "first"}`,
      eventId: null,
      reference,
      availableAt,
      maxAttempts: 5,
    });
  }
  const subscription: PendingSubscription = {
    consumer: handler.consumer,
    kind: handler.kind,
    eventTypes: notificationEventTypes,
    reference: (e) => ({ eventId: e.eventId, after: null }),
    invalidReference: (eventId) => ({ eventId: applicationId(eventId), after: null }),
  };
  return {
    config,
    handler,
    reminderHandler,
    subscription,
    async authorize(a: Actor) {
      return run((tx) => authorize(tx, a));
    },
    async maintenance() {
      return run(async (tx) => {
        await ports.identity.qualificationContextInTransaction(tx, []);
        const rows = await ports.events.pendingNotificationsInTransaction(tx);
        for (const row of rows) {
          const event = await ports.events.notificationScheduleInTransaction(tx, row.id),
            window = reminderWindow(event.startsAt, at());
          if (event.status === "scheduled" && window.schedulable)
            await enqueueReminder(
              tx,
              { eventId: row.id, generation: event.generation, after: null },
              window.due,
            );
          await ports.events.acknowledgeNotificationsInTransaction(tx, row.id, event.generation);
        }
        return rows.length;
      });
    },
    async poll(a: Actor, options: { cursor?: string; limit?: number } = {}) {
      return run(async (tx) => {
        await authorize(tx, a);
        const s = await state(tx, a.userId),
          limit = options.limit ?? 25;
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw identityError(422);
        const after = options.cursor ? cursor.decode(a, "poll", options.cursor) : null;
        if (after && BigInt(after) > BigInt(s.sequence))
          throw identityError(409, "VERSION_CONFLICT");
        const rows = await c(tx)
          .select()
          .from(notifications)
          .where(and(visible(a), after ? gt(notifications.sequence, after) : undefined))
          .orderBy(after ? asc(notifications.sequence) : desc(notifications.sequence))
          .limit(limit + 1)
          .for("share");
        const hasMore = after !== null && rows.length > limit,
          selected = rows.slice(0, limit);
        if (after === null) selected.reverse();
        const items = await project(tx, a, selected, false);
        const [counts] = await c(tx)
          .select({ count: sql<string>`CAST(COUNT(*) AS CHAR)` })
          .from(notifications)
          .where(and(visible(a), isNull(notifications.readAt)));
        const unreadCount = Number(counts?.count ?? 0);
        if (!Number.isSafeInteger(unreadCount)) throw new Error("NOTIFICATION_COUNT_OUT_OF_RANGE");
        return {
          items,
          nextCursor: cursor.encode(
            a,
            "poll",
            hasMore ? (selected.at(-1)?.sequence ?? s.sequence) : s.sequence,
          ),
          hasMore,
          unreadCount,
          serverTime: at(),
        };
      });
    },
    async history(a: Actor, options: { cursor?: string; limit?: number } = {}) {
      return run(async (tx) => {
        await authorize(tx, a);
        await state(tx, a.userId);
        const limit = options.limit ?? 25;
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw identityError(422);
        const before = options.cursor ? cursor.decode(a, "history", options.cursor) : null;
        const rows = await c(tx)
          .select()
          .from(notifications)
          .where(and(visible(a), before ? lt(notifications.sequence, before) : undefined))
          .orderBy(desc(notifications.sequence))
          .limit(limit + 1)
          .for("share");
        const selected = rows.slice(0, limit);
        return {
          items: await project(tx, a, selected, true),
          nextCursor:
            rows.length > limit
              ? cursor.encode(a, "history", selected.at(-1)?.sequence as string)
              : null,
        };
      });
    },
    async getPreferences(a: Actor) {
      return run(async (tx) => {
        await authorize(tx, a);
        const s = await state(tx, a.userId);
        return { data: preferences(s), version: s.version };
      });
    },
    async setPreferences(
      a: Actor,
      key: string,
      expected: number,
      value: S["NotificationPreferences"],
    ) {
      try {
        closed(value, preferenceNames);
        if (preferenceNames.some((p) => typeof value[p] !== "boolean")) throw new Error();
      } catch {
        throw identityError(422);
      }
      return run(async (tx) => {
        await authorize(tx, a);
        const s = await state(tx, a.userId);
        const result = await once(tx, a, "preferences", key, [expected, value], async () => {
          if (s.version !== expected) throw identityError(412, "VERSION_CONFLICT");
          await c(tx)
            .update(recipientStates)
            .set({ ...value, version: s.version + 1 })
            .where(eq(recipientStates.recipientId, a.userId));
          return { id: a.userId, version: s.version + 1, preferences: value };
        });
        if (!result.preferences) throw new Error("NOTIFICATION_PREFERENCE_RECEIPT_MISSING");
        return { data: result.preferences, version: result.version };
      });
    },
    async read(a: Actor, id: string, key: string) {
      return run(async (tx) => {
        await authorize(tx, a);
        await state(tx, a.userId);
        const [row] = await c(tx)
          .select()
          .from(notifications)
          .where(and(eq(notifications.id, applicationId(id)), visible(a)))
          .for("update");
        if (!row || !(await project(tx, a, [row], true)).length) throw identityError(404);
        return once(tx, a, "read", key, id, async () => {
          if (row.readAt === null)
            await c(tx).update(notifications).set({ readAt: at() }).where(eq(notifications.id, id));
          return { id, version: 1 };
        });
      });
    },
    async readThrough(a: Actor, key: string, throughCursor: string) {
      return run(async (tx) => {
        await authorize(tx, a);
        const s = await state(tx, a.userId),
          through = cursor.decode(a, "read-through", throughCursor);
        if (BigInt(through) > BigInt(s.sequence)) throw identityError(409, "VERSION_CONFLICT");
        return once(tx, a, "read-all", key, throughCursor, async () => {
          await c(tx)
            .update(notifications)
            .set({ readAt: at() })
            .where(
              and(visible(a), isNull(notifications.readAt), lte(notifications.sequence, through)),
            );
          return { id: a.userId, version: 1 };
        });
      });
    },
  };
}
export type Notifications = ReturnType<typeof createNotifications>;
