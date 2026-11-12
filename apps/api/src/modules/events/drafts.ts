import { createHmac, timingSafeEqual } from "node:crypto";
import type { components } from "@vtc/contracts";
import {
  applicationId,
  createAudit,
  decimal38_18,
  newId,
  type TxContext,
  type UnitOfWork,
} from "@vtc/db";
import {
  and,
  asc,
  desc,
  eq,
  eventCommands,
  eventDraftDlcs,
  eventDrafts,
  eventMetadata,
  eventStage2Commands,
  inArray,
  isNull,
  lt,
  or,
} from "@vtc/db/events-schema";
import { createSchemaValidator } from "../../platform/http/schemas.js";
import { closed } from "../../platform/outbox/events.js";
import { type Actor, identityError } from "../identity/service.js";
import { canonicalJson, decimal } from "../sources/contracts/canonical.js";
import { type Page, pagination } from "./pagination.js";
import { type EventLocale, eventDate, eventText } from "./published-route.js";

type S = components["schemas"];
type DraftFields = S["EventStage2DraftInput"];
type DraftRow = typeof eventDrafts.$inferSelect;
type StoredResult = typeof eventStage2Commands.$inferSelect.result;
type DraftResult = Extract<
  StoredResult,
  { route: "draft_create" | "draft_update" | "draft_delete" | "publish" }
>;
type DraftRoute = DraftResult["route"];
type Publication = Extract<DraftResult, { route: "publish" }>;
type PublicationCandidate = Omit<Publication, "data"> & { data: S["EventStage2Member"] };
type ReceiptCandidate = Exclude<DraftResult, Publication> | PublicationCandidate;

function createDraftSchemas() {
  const validator = createSchemaValidator();
  const schema = <T>(name: string) =>
    validator.compile<T>({ $ref: `urn:vtc:browser:v1#/$defs/${name}` });
  return {
    input: schema<DraftFields>("EventStage2DraftInput"),
    draft: schema<S["EventStage2Draft"]>("EventStage2Draft"),
    deletion: schema<S["EventStage2DraftDeletion"]>("EventStage2DraftDeletion"),
    publicationInput: schema<S["EventStage2Input"]>("EventStage2Input"),
    publication: schema<S["EventStage2Member"]>("EventStage2Member"),
  };
}
let draftSchemas: ReturnType<typeof createDraftSchemas> | undefined;
const schemas = () => (draftSchemas ??= createDraftSchemas());

type DraftColumns = Required<Omit<DraftFields, "requiredDlcIds">>;
const draftDefaults = {
  title: null,
  server: null,
  description: null,
  game: null,
  platform: null,
  organizerMemberId: null,
  meetingLocation: null,
  route: null,
  meetingAt: null,
  startsAt: null,
  endsAt: null,
  visibility: null,
  originCityId: null,
  destinationCityId: null,
  originDepotId: null,
  destinationDepotId: null,
  distanceKm: null,
  prescribedCargoId: null,
  prescribedTrailerTypeId: null,
  prescribedMassKg: null,
} satisfies DraftColumns;
const draftFields = Object.keys(draftDefaults) as (keyof DraftColumns)[];
type DraftDefinition = { row: DraftColumns; requiredDlcIds: string[] };

function fields(raw: DraftFields): DraftColumns {
  return Object.fromEntries(
    draftFields.map((field) => [field, raw[field] ?? null]),
  ) as DraftColumns;
}

function normalize(raw: DraftFields) {
  if (!schemas().input(raw)) throw identityError(422);
  const row = fields(raw);
  const requiredDlcIds = [...(raw.requiredDlcIds ?? [])].sort();
  const draft = { row, requiredDlcIds };
  for (const [value, max] of [
    [row.title, 256],
    [row.server, 256],
    [row.description, 8000],
    [row.meetingLocation, 2048],
    [row.route, 2048],
  ] as const)
    if (value !== null) eventText(value, max);
  for (const time of [row.meetingAt, row.startsAt, row.endsAt]) if (time !== null) eventDate(time);
  if (
    (row.meetingAt !== null && row.startsAt !== null && row.meetingAt > row.startsAt) ||
    (row.startsAt !== null && row.endsAt !== null && row.startsAt > row.endsAt) ||
    (row.meetingAt !== null && row.endsAt !== null && row.meetingAt > row.endsAt)
  )
    throw identityError(422);
  if (
    (!row.game &&
      (row.originCityId ||
        row.destinationCityId ||
        row.originDepotId ||
        row.destinationDepotId ||
        row.prescribedCargoId ||
        row.prescribedTrailerTypeId ||
        requiredDlcIds.length)) ||
    (row.originDepotId && !row.originCityId) ||
    (row.destinationDepotId && !row.destinationCityId)
  )
    throw identityError(422);
  try {
    for (const amount of [row.distanceKm, row.prescribedMassKg])
      if (amount !== null && decimal(decimal38_18(amount)) !== amount) throw new Error();
    // Canonical serialization also rejects strings that cannot round-trip through MySQL UTF-8.
    canonicalJson(draft);
  } catch {
    throw identityError(422);
  }
  return draft;
}

function definition(row: DraftRow, requiredDlcIds: string[]): DraftDefinition {
  return {
    row: fields({
      ...row,
      prescribedMassKg: row.prescribedMassKg === null ? null : decimal(row.prescribedMassKg),
      distanceKm: row.distanceKm === null ? null : decimal(row.distanceKm),
    }),
    requiredDlcIds,
  };
}

function dto(
  id: string,
  version: number,
  updatedAt: string,
  value: DraftDefinition,
): S["EventStage2Draft"] {
  return {
    id,
    version,
    updatedAt,
    lifecycle: "draft",
    fields: {
      ...Object.fromEntries(Object.entries(value.row).filter(([, field]) => field !== null)),
      ...(value.requiredDlcIds.length ? { requiredDlcIds: value.requiredDlcIds } : {}),
    },
  };
}

interface Ports {
  run<T>(command: (tx: TxContext) => Promise<T>): Promise<T>;
  authorize(
    tx: TxContext,
    actor: Actor,
    organizerId?: string,
  ): Promise<{ organizer: string | null }>;
  validate(tx: TxContext, next: DraftDefinition, prior: DraftDefinition | null): Promise<void>;
  publish(
    tx: TxContext,
    actor: Actor,
    id: string,
    input: S["EventStage2Input"],
    organizer: string,
    locale: EventLocale,
  ): Promise<Omit<PublicationCandidate, "schemaVersion" | "route">>;
}

function checkedReceipt<R extends DraftRoute>(
  raw: unknown,
  route: R,
  target: string,
  expected: number,
): DraftResult & { route: R } {
  try {
    const result = closed(raw, [
      "schemaVersion",
      "route",
      "data",
      ...(route === "publish" ? ["revisionId"] : []),
    ]);
    if (result.schemaVersion !== 1 || result.route !== route) throw new Error();
    const data = result.data;
    if (route === "publish") {
      applicationId(result.revisionId as string);
      if (
        !schemas().publication(data) ||
        data.event.id !== target ||
        data.event.version !== 1 ||
        data.event.status !== "scheduled" ||
        data.event.platform === null ||
        data.organizerMemberId === null ||
        data.myAttendance !== "unconfirmed" ||
        data.myResponse.version !== 1 ||
        data.myResponse.response !== "unanswered" ||
        data.myResponse.declineReason !== null ||
        data.responseCounts.participating !== 0 ||
        data.responseCounts.declined !== 0
      )
        throw new Error();
    } else if (route === "draft_delete") {
      if (!schemas().deletion(data) || data.id !== target || data.version !== expected + 1)
        throw new Error();
    } else {
      if (
        !schemas().draft(data) ||
        data.version !== expected + 1 ||
        (route !== "draft_create" && data.id !== target)
      )
        throw new Error();
      eventDate(data.updatedAt);
      normalize(data.fields);
    }
    return result as DraftResult & { route: R };
  } catch {
    throw new Error("EVENT_WORKFLOW_RECEIPT_INVALID");
  }
}

export function createEventDrafts(unit: UnitOfWork, key: string, now: () => Date, ports: Ports) {
  const c = (tx: TxContext) => unit.client(tx);
  const audit = createAudit(unit);
  const page = pagination(key, now);
  const at = () => now().toISOString();

  async function auditChange(tx: TxContext, actor: Actor, id: string, time: string) {
    await audit.append(tx, {
      actorKind: "user",
      actorId: actor.userId,
      operation: "configuration.changed",
      subjectKind: "event",
      subjectId: id,
      occurredAt: time,
      reason: "operator_request",
    });
  }

  async function once<R extends DraftRoute>(
    tx: TxContext,
    actor: Actor,
    route: R,
    target: string,
    commandKey: string,
    expected: number,
    value: unknown,
    command: () => Promise<ReceiptCandidate & { route: NoInfer<R> }>,
  ) {
    applicationId(commandKey);
    const fingerprint = createHmac("sha256", Buffer.from(key, "hex"))
      .update("events/draft-command/v1\0")
      .update(canonicalJson([actor.userId, route, target, commandKey, expected, value]))
      .digest();
    const [saved] = await c(tx)
      .select({
        fingerprint: eventStage2Commands.fingerprint,
        result: eventStage2Commands.result,
      })
      .from(eventStage2Commands)
      .where(
        and(
          eq(eventStage2Commands.actorId, actor.userId),
          eq(eventStage2Commands.route, route),
          eq(eventStage2Commands.targetId, target),
          eq(eventStage2Commands.key, commandKey),
        ),
      )
      .for("share");
    if (saved) {
      if (saved.fingerprint.length !== fingerprint.length)
        throw new Error("EVENT_WORKFLOW_RECEIPT_INVALID");
      if (!timingSafeEqual(saved.fingerprint, fingerprint))
        throw identityError(409, "IDEMPOTENCY_CONFLICT");
      return checkedReceipt<R>(saved.result, route, target, expected);
    }
    const result = checkedReceipt<R>(await command(), route, target, expected);
    await c(tx).insert(eventStage2Commands).values({
      actorId: actor.userId,
      route,
      targetId: target,
      key: commandKey,
      fingerprint,
      result,
      recordedAt: at(),
    });
    return result;
  }

  async function loadDlcs(tx: TxContext, ids: string[]) {
    const result = new Map<string, string[]>();
    if (!ids.length) return result;
    const rows = await c(tx)
      .select({ eventId: eventDraftDlcs.eventId, dlcId: eventDraftDlcs.dlcId })
      .from(eventDraftDlcs)
      .where(inArray(eventDraftDlcs.eventId, ids))
      .orderBy(asc(eventDraftDlcs.eventId), asc(eventDraftDlcs.dlcId))
      .for("share");
    for (const { eventId, dlcId } of rows) {
      let items = result.get(eventId);
      if (!items) {
        items = [];
        result.set(eventId, items);
      }
      items.push(dlcId);
    }
    return result;
  }

  async function storeDlcs(tx: TxContext, eventId: string, value: DraftDefinition) {
    const {
      row: { game },
      requiredDlcIds,
    } = value;
    if (!game) return;
    for (let start = 0; start < requiredDlcIds.length; start += 1000)
      await c(tx)
        .insert(eventDraftDlcs)
        .values(
          requiredDlcIds.slice(start, start + 1000).map((dlcId) => ({ eventId, game, dlcId })),
        );
  }

  async function lock(tx: TxContext, id: string, expected: number | null) {
    const mode = expected === null ? "share" : "update";
    const [metadata] = await c(tx)
      .select({ publishedEventId: eventMetadata.publishedEventId })
      .from(eventMetadata)
      .where(eq(eventMetadata.id, id))
      .for(mode);
    if (!metadata) throw identityError(404);
    const [row] = await c(tx)
      .select()
      .from(eventDrafts)
      .where(eq(eventDrafts.eventId, id))
      .for(mode);
    if (!row) throw identityError(404);
    if (metadata.publishedEventId !== null || row.discardedAt !== null)
      throw expected === null ? identityError(404) : identityError(409, "VERSION_CONFLICT");
    if (expected !== null && row.version !== expected) throw identityError(412, "VERSION_CONFLICT");
    return row;
  }

  async function readDefinition(tx: TxContext, row: DraftRow) {
    return definition(row, (await loadDlcs(tx, [row.eventId])).get(row.eventId) ?? []);
  }

  return {
    async rejectDraftCreateKey(tx: TxContext, actor: Actor, key: string) {
      const [draft] = await c(tx)
        .select({ key: eventStage2Commands.key })
        .from(eventStage2Commands)
        .where(
          and(
            eq(eventStage2Commands.actorId, actor.userId),
            eq(eventStage2Commands.route, "draft_create"),
            eq(eventStage2Commands.targetId, key),
            eq(eventStage2Commands.key, key),
          ),
        )
        .for("share");
      if (draft) throw identityError(409, "IDEMPOTENCY_CONFLICT");
    },
    create(actor: Actor, key: string, raw: DraftFields) {
      const value = normalize(raw);
      return ports.run(async (tx) => {
        const { organizer } = await ports.authorize(
          tx,
          actor,
          value.row.organizerMemberId ?? undefined,
        );
        const [existing] = await c(tx)
          .select({ key: eventCommands.key })
          .from(eventCommands)
          .where(
            and(
              eq(eventCommands.actorId, actor.userId),
              eq(eventCommands.route, "create"),
              eq(eventCommands.targetId, key),
              eq(eventCommands.key, key),
            ),
          )
          .for("share");
        if (existing) throw identityError(409, "IDEMPOTENCY_CONFLICT");
        const { data } = await once(tx, actor, "draft_create", key, key, 0, value, async () => {
          if (value.row.organizerMemberId && organizer === null) throw identityError(422);
          await ports.validate(tx, value, null);
          const id = newId(),
            time = at(),
            version = 1;
          await c(tx).insert(eventMetadata).values({ id, createdAt: time });
          await c(tx)
            .insert(eventDrafts)
            .values({
              ...value.row,
              eventId: id,
              version,
              updatedAt: time,
              updatedBy: actor.userId,
            });
          await storeDlcs(tx, id, value);
          await auditChange(tx, actor, id, time);
          return {
            schemaVersion: 1 as const,
            route: "draft_create" as const,
            data: dto(id, version, time, value),
          };
        });
        return { data, version: data.version };
      });
    },
    get(actor: Actor, id: string) {
      return ports.run(async (tx) => {
        await ports.authorize(tx, actor);
        const row = await lock(tx, id, null);
        const data = dto(id, row.version, row.updatedAt, await readDefinition(tx, row));
        return { data, version: row.version };
      });
    },
    update(actor: Actor, id: string, key: string, expected: number, raw: DraftFields) {
      const value = normalize(raw);
      return ports.run(async (tx) => {
        const { organizer } = await ports.authorize(
          tx,
          actor,
          value.row.organizerMemberId ?? undefined,
        );
        const { data } = await once(
          tx,
          actor,
          "draft_update",
          id,
          key,
          expected,
          value,
          async () => {
            const row = await lock(tx, id, expected);
            if (value.row.organizerMemberId && organizer === null) throw identityError(422);
            await ports.validate(tx, value, await readDefinition(tx, row));
            const time = at(),
              version = row.version + 1;
            // The DLC foreign key includes the parent game, so clear old children first.
            await c(tx).delete(eventDraftDlcs).where(eq(eventDraftDlcs.eventId, id));
            await c(tx)
              .update(eventDrafts)
              .set({ ...value.row, version, updatedAt: time, updatedBy: actor.userId })
              .where(eq(eventDrafts.eventId, id));
            await storeDlcs(tx, id, value);
            await auditChange(tx, actor, id, time);
            return {
              schemaVersion: 1 as const,
              route: "draft_update" as const,
              data: dto(id, version, time, value),
            };
          },
        );
        return { data, version: data.version };
      });
    },
    discard(actor: Actor, id: string, key: string, expected: number) {
      return ports.run(async (tx) => {
        await ports.authorize(tx, actor);
        const { data } = await once(
          tx,
          actor,
          "draft_delete",
          id,
          key,
          expected,
          null,
          async () => {
            const row = await lock(tx, id, expected);
            const time = at(),
              version = row.version + 1;
            await c(tx)
              .update(eventDrafts)
              .set({ version, updatedAt: time, updatedBy: actor.userId, discardedAt: time })
              .where(eq(eventDrafts.eventId, id));
            await auditChange(tx, actor, id, time);
            return {
              schemaVersion: 1 as const,
              route: "draft_delete" as const,
              data: { id, version, lifecycle: "discarded" as const },
            };
          },
        );
        return { data, version: data.version };
      });
    },
    publish(actor: Actor, id: string, key: string, expected: number, locale: EventLocale) {
      return ports.run(async (tx) => {
        // Discover the organizer before the sorted Identity locks. Recheck after locking the draft.
        const [candidate] = await c(tx)
          .select({ organizerId: eventDrafts.organizerMemberId })
          .from(eventDrafts)
          .where(eq(eventDrafts.eventId, id))
          .limit(1);
        const { organizer } = await ports.authorize(tx, actor, candidate?.organizerId ?? undefined);
        const { data } = await once(tx, actor, "publish", id, key, expected, locale, async () => {
          const row = await lock(tx, id, expected);
          if (row.organizerMemberId !== candidate?.organizerId)
            throw identityError(409, "VERSION_CONFLICT");
          const value = await readDefinition(tx, row);
          const input = { ...value.row, requiredDlcIds: value.requiredDlcIds };
          if (!schemas().publicationInput(input) || organizer === null) throw identityError(422);
          const result = await ports.publish(tx, actor, id, input, organizer, locale);
          // The reserved identity already owns the gallery. Only attach the published pointer.
          await c(tx)
            .update(eventMetadata)
            .set({ publishedEventId: id })
            .where(eq(eventMetadata.id, id));
          return { ...result, schemaVersion: 1 as const, route: "publish" as const };
        });
        return { data, version: data.event.version };
      });
    },
    list(actor: Actor, options: Page & { locale?: EventLocale }) {
      return ports.run(async (tx) => {
        await ports.authorize(tx, actor);
        const p = page(actor, ["admin", "drafts", options.locale ?? "en"], options);
        const rows = await c(tx)
          .select({ draft: eventDrafts })
          .from(eventDrafts)
          .innerJoin(eventMetadata, eq(eventMetadata.id, eventDrafts.eventId))
          .where(
            and(
              isNull(eventDrafts.discardedAt),
              isNull(eventMetadata.publishedEventId),
              p.after
                ? or(
                    lt(eventDrafts.updatedAt, p.after.time as string),
                    and(
                      eq(eventDrafts.updatedAt, p.after.time as string),
                      lt(eventDrafts.eventId, p.after.id),
                    ),
                  )
                : undefined,
            ),
          )
          .orderBy(desc(eventDrafts.updatedAt), desc(eventDrafts.eventId))
          .limit(p.limit + 1)
          .for("share");
        const result = p.finish(
          rows.map(({ draft }) => draft),
          (row) => ({ id: row.eventId, time: row.updatedAt }),
        );
        const dlcs = await loadDlcs(
          tx,
          result.items.map((row) => row.eventId),
        );
        return {
          ...result,
          items: result.items.map((row) =>
            dto(
              row.eventId,
              row.version,
              row.updatedAt,
              definition(row, dlcs.get(row.eventId) ?? []),
            ),
          ),
        };
      });
    },
  };
}
