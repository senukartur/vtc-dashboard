import { applicationId, type TxContext, type UnitOfWork } from "@vtc/db";
import { eventMedia, eventMediaGenerations } from "@vtc/db/events-schema";
import { and, asc, eq, inArray, lte } from "drizzle-orm";
import type { PrivateImages } from "../../platform/blob-storage/filesystem.js";
import {
  bounds,
  type Claim,
  createQueue,
  type Handler,
  RetryableJobError,
  retryTransaction,
} from "../../platform/jobs/queue.js";
import { closed } from "../../platform/outbox/events.js";
import {
  currentStates,
  type Generation,
  generationFilter,
  type Media,
  type MediaStore,
} from "./media-store.js";

export const mediaJobKinds = ["events.media-thumbnail", "events.media-cleanup"] as const;
const batchSize = 10;
const checkDelayMs = 60_000;
const retiredDelayMs = 86_400_000;

function reference(value: unknown) {
  const data = closed(value, ["eventId", "mediaId", "generation"]);
  return {
    eventId: applicationId(data.eventId as string),
    mediaId: applicationId(data.mediaId as string),
    generation: applicationId(data.generation as string),
  };
}

export function createMediaJobs(
  unit: UnitOfWork,
  store: MediaStore,
  blobs: PrivateImages,
  now: () => Date,
) {
  const c = (tx: TxContext) => unit.client(tx);
  const run = <T>(fn: (tx: TxContext) => Promise<T>) => retryTransaction(unit, fn);
  const at = () => now().toISOString();
  const later = (ms: number) => new Date(now().getTime() + ms).toISOString();
  const thumbnailKey = (id: string, generation: string) => `thumb:${id}:${generation}`;
  const cleanupKey = (id: string, generation: string, attempt: number) =>
    `cleanup:${id}:${generation}:${attempt}`;

  async function retire(tx: TxContext, row: Media, state: "rejected" | "deleting") {
    await c(tx)
      .update(eventMedia)
      .set({
        state,
        isCover: false,
        position: null,
        leaseToken: null,
        leaseUntil: null,
        nextCheckAt: at(),
        updatedAt: at(),
        ...(state === "deleting" ? { deletedAt: at() } : {}),
      })
      .where(eq(eventMedia.id, row.id));
    await c(tx)
      .update(eventMediaGenerations)
      .set({ nextCheckAt: at(), updatedAt: at() })
      .where(generationFilter(row.id, row.generation));
  }

  // The caller holds the lifecycle/metadata lock. The discard marker and
  // inaccessibility of every current image commit together.
  async function discardInTransaction(tx: TxContext, eventId: string) {
    const rows = await c(tx)
      .select()
      .from(eventMedia)
      .where(and(eq(eventMedia.eventId, eventId), inArray(eventMedia.state, currentStates)))
      .for("update");
    for (const row of rows) await retire(tx, row, "deleting");
    if (rows.some((row) => row.fingerprint)) await store.increment(tx, eventId);
  }

  async function trackGeneration(
    tx: TxContext,
    id: string,
    generation: string,
    leaseUntil: string,
  ) {
    await c(tx).insert(eventMediaGenerations).values({
      mediaId: id,
      generation,
      leaseUntil,
      createdAt: at(),
      updatedAt: at(),
      nextCheckAt: leaseUntil,
    });
  }

  function protectedGeneration(row: Media, generation: string) {
    return (
      (row.generation === generation && (row.state === "processing" || row.state === "ready")) ||
      (row.state === "processing" && row.leaseToken === generation)
    );
  }

  const thumbnail: Handler = {
    kind: mediaJobKinds[0],
    consumer: "events-media-thumbnail-v1",
    version: 1,
    mode: "local",
    validate: reference,
    async prepare(value, claim, signal) {
      const ref = reference(value);
      const permitted = await run(async (tx) => {
        await queue.checkLease(tx, claim);
        const event = await store.lifecycle(tx, ref.eventId, "update");
        if (event.kind !== "draft" && event.kind !== "published") return false;
        const row = await store.media(tx, ref.eventId, ref.mediaId);
        if (row?.state !== "processing" || !row.fingerprint || row.generation !== ref.generation)
          return false;
        const generation = await store.generation(tx, row.id, row.generation);
        if (generation?.state !== "tracked") return false;
        const leaseUntil = later(bounds.jobLeaseMs);
        await trackGeneration(tx, row.id, claim.leaseToken, leaseUntil);
        await c(tx)
          .update(eventMediaGenerations)
          .set({ leaseUntil, updatedAt: at() })
          .where(generationFilter(row.id, row.generation));
        await c(tx)
          .update(eventMedia)
          .set({ leaseToken: claim.leaseToken, leaseUntil, updatedAt: at() })
          .where(eq(eventMedia.id, row.id));
        return true;
      });
      if (!permitted) return false;
      try {
        signal.throwIfAborted();
        await blobs.makeThumbnail(
          { id: ref.mediaId, generation: ref.generation },
          { id: ref.mediaId, generation: claim.leaseToken },
          signal,
        );
        return true;
      } catch {
        throw new RetryableJobError();
      }
    },
    async local(tx, value, claim, prepared) {
      if (prepared !== true) return;
      const ref = reference(value);
      const event = await store.lifecycle(tx, ref.eventId, "update");
      if (event.kind !== "draft" && event.kind !== "published") return;
      const row = await store.media(tx, ref.eventId, ref.mediaId);
      if (
        row?.state !== "processing" ||
        !row.fingerprint ||
        row.generation !== ref.generation ||
        row.leaseToken !== claim.leaseToken
      )
        return;
      await c(tx)
        .update(eventMedia)
        .set({
          state: "ready",
          position: (await store.ready(tx, ref.eventId)).length,
          leaseToken: null,
          leaseUntil: null,
          updatedAt: at(),
        })
        .where(eq(eventMedia.id, row.id));
      await store.increment(tx, ref.eventId);
    },
  };

  async function cleanupFence(tx: TxContext, value: unknown, claim: Claim) {
    const ref = reference(value);
    await store.lifecycle(tx, ref.eventId, "update");
    const row = await store.media(tx, ref.eventId, ref.mediaId);
    if (!row || protectedGeneration(row, ref.generation)) return null;
    const generation = await store.generation(tx, row.id, ref.generation);
    if (
      generation?.state !== "deleting" ||
      generation.deletionJobId !== claim.id ||
      generation.leaseUntil > at()
    )
      return null;
    return { row, generation };
  }
  const cleanup: Handler = {
    kind: mediaJobKinds[1],
    consumer: "events-media-cleanup-v1",
    version: 1,
    mode: "local",
    validate: reference,
    async prepare(value, claim, signal) {
      const saved = await run(async (tx) => {
        await queue.checkLease(tx, claim);
        return cleanupFence(tx, value, claim);
      });
      if (!saved) return false;
      try {
        signal.throwIfAborted();
        await blobs.removeImages({ id: saved.row.id, generation: saved.generation.generation });
        return true;
      } catch {
        throw new RetryableJobError();
      }
    },
    async local(tx, value, claim, prepared) {
      if (prepared !== true) return;
      const saved = await cleanupFence(tx, value, claim);
      if (!saved) return;
      const { row, generation } = saved;
      await c(tx)
        .update(eventMediaGenerations)
        .set({
          state: "tracked",
          deletionJobId: null,
          nextCheckAt: later(retiredDelayMs),
          updatedAt: at(),
        })
        .where(generationFilter(row.id, generation.generation));
      if (row.state === "deleting" && row.generation === generation.generation)
        await c(tx)
          .update(eventMedia)
          .set({ state: "deleted", updatedAt: at() })
          .where(eq(eventMedia.id, row.id));
    },
  };

  const queue = createQueue(unit, [thumbnail, cleanup]);
  async function enqueueThumbnail(tx: TxContext, eventId: string, id: string, generation: string) {
    await queue.enqueue(tx, {
      kind: thumbnail.kind,
      consumer: thumbnail.consumer,
      schemaVersion: 1,
      eventId: null,
      effectKey: thumbnailKey(id, generation),
      reference: { eventId, mediaId: id, generation },
      availableAt: at(),
      maxAttempts: bounds.maxAttempts,
    });
  }
  async function enqueueCleanup(tx: TxContext, row: Media, generation: Generation) {
    const attempt = generation.deleteAttempt + 1;
    const jobId = await queue.enqueue(tx, {
      kind: cleanup.kind,
      consumer: cleanup.consumer,
      schemaVersion: 1,
      eventId: null,
      effectKey: cleanupKey(row.id, generation.generation, attempt),
      reference: { eventId: row.eventId, mediaId: row.id, generation: generation.generation },
      availableAt: at(),
      maxAttempts: bounds.maxAttempts,
    });
    await c(tx)
      .update(eventMediaGenerations)
      .set({
        state: "deleting",
        deleteAttempt: attempt,
        deletionJobId: jobId,
        nextCheckAt: later(checkDelayMs),
        updatedAt: at(),
      })
      .where(generationFilter(row.id, generation.generation));
  }

  async function checkProcessing(signal: AbortSignal) {
    const due = await run((tx) =>
      c(tx)
        .select()
        .from(eventMedia)
        .where(and(eq(eventMedia.state, "processing"), lte(eventMedia.nextCheckAt, at())))
        .orderBy(asc(eventMedia.nextCheckAt), asc(eventMedia.id))
        .limit(batchSize),
    );
    for (const candidate of due) {
      signal.throwIfAborted();
      const effect = candidate.fingerprint
        ? await run((tx) =>
            queue.effectState(
              tx,
              thumbnail.consumer,
              thumbnailKey(candidate.id, candidate.generation),
            ),
          )
        : null;
      await run(async (tx) => {
        const event = await store.lifecycle(tx, candidate.eventId, "update");
        const row = await store.media(tx, candidate.eventId, candidate.id);
        if (
          row?.state !== "processing" ||
          row.generation !== candidate.generation ||
          !!row.fingerprint !== !!candidate.fingerprint ||
          row.nextCheckAt > at()
        )
          return;
        if (event.kind === "discarded") {
          await discardInTransaction(tx, row.eventId);
          return;
        }
        if (
          (!row.leaseUntil || row.leaseUntil <= at()) &&
          (!row.fingerprint || !effect || effect.state === "failed" || effect.state === "completed")
        ) {
          await retire(tx, row, "rejected");
          if (row.fingerprint) await store.increment(tx, row.eventId);
          return;
        }
        await c(tx)
          .update(eventMedia)
          .set({ nextCheckAt: later(checkDelayMs) })
          .where(eq(eventMedia.id, row.id));
      });
    }
  }

  async function checkGenerations(signal: AbortSignal) {
    for (const state of ["tracked", "deleting"] as const) {
      const due = await run((tx) =>
        c(tx)
          .select({
            generation: eventMediaGenerations,
            eventId: eventMedia.eventId,
          })
          .from(eventMediaGenerations)
          .innerJoin(eventMedia, eq(eventMedia.id, eventMediaGenerations.mediaId))
          .where(
            and(
              eq(eventMediaGenerations.state, state),
              lte(eventMediaGenerations.nextCheckAt, at()),
            ),
          )
          .orderBy(
            asc(eventMediaGenerations.nextCheckAt),
            asc(eventMediaGenerations.mediaId),
            asc(eventMediaGenerations.generation),
          )
          .limit(batchSize),
      );
      for (const { generation: candidate, eventId } of due) {
        signal.throwIfAborted();
        const effect =
          candidate.state === "deleting"
            ? await run((tx) =>
                queue.effectState(
                  tx,
                  cleanup.consumer,
                  cleanupKey(candidate.mediaId, candidate.generation, candidate.deleteAttempt),
                ),
              )
            : null;
        const observed = await run(async (tx) => {
          const event = await store.lifecycle(tx, eventId, "update");
          const row = await store.media(tx, eventId, candidate.mediaId);
          const generation = await store.generation(tx, candidate.mediaId, candidate.generation);
          if (
            !row ||
            !generation ||
            generation.state !== candidate.state ||
            generation.deleteAttempt !== candidate.deleteAttempt ||
            generation.nextCheckAt > at()
          )
            return false;
          if (event.kind === "discarded" && (row.state === "ready" || row.state === "processing")) {
            await discardInTransaction(tx, eventId);
            return false;
          }
          if (protectedGeneration(row, generation.generation) || generation.leaseUntil > at()) {
            await c(tx)
              .update(eventMediaGenerations)
              .set({
                nextCheckAt:
                  generation.leaseUntil > at() ? generation.leaseUntil : later(retiredDelayMs),
              })
              .where(generationFilter(row.id, generation.generation));
            return false;
          }
          if (
            generation.state === "deleting" ||
            generation.deleteAttempt === 0 ||
            row.state === "deleting"
          ) {
            if (!effect || effect.state === "failed" || effect.state === "completed")
              await enqueueCleanup(tx, row, generation);
            else
              await c(tx)
                .update(eventMediaGenerations)
                .set({ nextCheckAt: later(checkDelayMs) })
                .where(generationFilter(row.id, generation.generation));
            return false;
          }
          return true;
        });
        if (!observed) continue;
        const present = await blobs.imagesPresent({
          id: candidate.mediaId,
          generation: candidate.generation,
        });
        await run(async (tx) => {
          await store.lifecycle(tx, eventId, "update");
          const row = await store.media(tx, eventId, candidate.mediaId);
          const generation = await store.generation(tx, candidate.mediaId, candidate.generation);
          if (
            !row ||
            generation?.state !== "tracked" ||
            generation.deleteAttempt !== candidate.deleteAttempt ||
            generation.nextCheckAt > at() ||
            generation.leaseUntil > at() ||
            protectedGeneration(row, generation.generation)
          )
            return;
          if (present) await enqueueCleanup(tx, row, generation);
          else
            await c(tx)
              .update(eventMediaGenerations)
              .set({ nextCheckAt: later(retiredDelayMs) })
              .where(generationFilter(row.id, generation.generation));
        });
      }
    }
  }

  return {
    handlers: [thumbnail, cleanup],
    enqueueThumbnail,
    retire,
    trackGeneration,
    discardInTransaction,
    async maintenance(signal: AbortSignal) {
      await checkProcessing(signal);
      await checkGenerations(signal);
    },
  };
}
