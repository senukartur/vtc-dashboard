import type { components } from "@vtc/contracts";
import type { TxContext, UnitOfWork } from "@vtc/db";
import {
  eventDrafts,
  eventMedia,
  eventMediaGenerations,
  eventMetadata,
  events,
} from "@vtc/db/events-schema";
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { identityError } from "../identity/service.js";

type S = components["schemas"];
export type Media = typeof eventMedia.$inferSelect;
export type Generation = typeof eventMediaGenerations.$inferSelect;
export const slots = 10;
export const currentStates = ["ready", "processing"] as const;
export const visibleStates = [...currentStates, "rejected"] as const;
export const generationFilter = (id: string, generation: string) =>
  and(eq(eventMediaGenerations.mediaId, id), eq(eventMediaGenerations.generation, generation));

export function readyItem(row: Media): S["EventStage2Media"] {
  if (row.state !== "ready" || row.width === null || row.height === null || row.position === null)
    throw new Error("EVENT_MEDIA_READY_SHAPE");
  return {
    id: row.id,
    contentType: row.contentType,
    byteLength: row.byteLength,
    width: row.width,
    height: row.height,
    caption: row.caption,
    position: row.position,
    isCover: row.isCover,
  };
}
export function adminItem(row: Media) {
  if (!row.fingerprint) throw new Error("EVENT_MEDIA_TENTATIVE");
  switch (row.state) {
    case "ready":
      return { id: row.id, state: row.state, media: readyItem(row) } as const;
    case "processing":
    case "rejected":
      return { id: row.id, state: row.state, media: null } as const;
    default:
      throw identityError(404);
  }
}

export function createMediaStore(unit: UnitOfWork, draftsEnabled: boolean) {
  const c = (tx: TxContext) => unit.client(tx);
  // The metadata row fences publication, discard and all media writes. Take
  // it before reading the draft or published row so a draft read cannot hold
  // a gap lock on the not-yet-inserted published identity.
  async function lifecycle(
    tx: TxContext,
    eventId: string,
    mode: "share" | "update",
    background = false,
  ) {
    const [metadata] = await c(tx)
      .select()
      .from(eventMetadata)
      .where(eq(eventMetadata.id, eventId))
      .for(mode);
    if (!metadata || metadata.publishedEventId) {
      const [event] = await c(tx)
        .select({ visibility: events.visibility })
        .from(events)
        .where(eq(events.id, eventId))
        .for("share");
      if (event) return { kind: "published" as const, visibility: event.visibility, metadata };
    }
    if (metadata && !metadata.publishedEventId) {
      // HTTP draft access follows the draft rollout. Media jobs also read the
      // discard marker to recover drafts discarded while media was disabled.
      if (!draftsEnabled && !background) return { kind: "missing" as const, metadata };
      const [draft] = await c(tx)
        .select({ discardedAt: eventDrafts.discardedAt })
        .from(eventDrafts)
        .where(eq(eventDrafts.eventId, eventId))
        .for("share");
      if (draft)
        return { kind: draft.discardedAt ? ("discarded" as const) : ("draft" as const), metadata };
    }
    return { kind: "missing" as const, metadata };
  }
  async function ready(tx: TxContext, eventId: string) {
    return c(tx)
      .select()
      .from(eventMedia)
      .where(and(eq(eventMedia.eventId, eventId), eq(eventMedia.state, "ready")))
      .orderBy(asc(eventMedia.position), asc(eventMedia.id))
      .limit(slots)
      .for("share");
  }
  async function adminList(tx: TxContext, eventId: string, version: number) {
    const live = await ready(tx, eventId);
    const pending = await c(tx)
      .select()
      .from(eventMedia)
      .where(
        and(
          eq(eventMedia.eventId, eventId),
          eq(eventMedia.state, "processing"),
          isNotNull(eventMedia.fingerprint),
        ),
      )
      .orderBy(asc(eventMedia.createdAt), asc(eventMedia.id))
      .limit(slots)
      .for("share");
    const available = slots - live.length - pending.length;
    const rejected =
      available > 0
        ? await c(tx)
            .select()
            .from(eventMedia)
            .where(
              and(
                eq(eventMedia.eventId, eventId),
                eq(eventMedia.state, "rejected"),
                isNotNull(eventMedia.fingerprint),
              ),
            )
            .orderBy(desc(eventMedia.updatedAt), asc(eventMedia.id))
            .limit(available)
            .for("share")
        : [];
    return { version, items: [...live, ...pending, ...rejected].map(adminItem) };
  }
  async function media(tx: TxContext, eventId: string, mediaId: string) {
    const [row] = await c(tx)
      .select()
      .from(eventMedia)
      .where(and(eq(eventMedia.id, mediaId), eq(eventMedia.eventId, eventId)))
      .for("update");
    return row;
  }
  async function generation(tx: TxContext, id: string, value: string) {
    const [row] = await c(tx)
      .select()
      .from(eventMediaGenerations)
      .where(generationFilter(id, value))
      .for("update");
    return row;
  }
  async function increment(tx: TxContext, eventId: string) {
    await c(tx)
      .update(eventMetadata)
      .set({ mediaVersion: sql`${eventMetadata.mediaVersion}+1` })
      .where(eq(eventMetadata.id, eventId));
  }
  async function savePositions(tx: TxContext, ordered: Media[]) {
    for (const [position, row] of ordered.entries()) {
      if (row.position !== position)
        await c(tx).update(eventMedia).set({ position }).where(eq(eventMedia.id, row.id));
    }
  }
  async function coverIdsInTransaction(tx: TxContext, eventIds: string[]) {
    if (!eventIds.length) return new Set<string>();
    const rows = await c(tx)
      .select({ eventId: eventMedia.eventId })
      .from(eventMedia)
      .where(and(inArray(eventMedia.coverEventId, eventIds), eq(eventMedia.state, "ready")));
    return new Set(rows.map((row) => row.eventId));
  }
  return {
    lifecycle,
    ready,
    adminList,
    media,
    generation,
    increment,
    savePositions,
    coverIdsInTransaction,
  };
}
export type MediaStore = ReturnType<typeof createMediaStore>;
