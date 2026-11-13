import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { components } from "@vtc/contracts";
import { applicationId, newId, type TxContext, type UnitOfWork } from "@vtc/db";
import { eventMedia, eventMetadata, eventStage2Commands } from "@vtc/db/events-schema";
import { and, eq, inArray, ne } from "drizzle-orm";
import {
  type BlobConfig,
  BlobFailure,
  createPrivateFilesystem,
  type PrivateImages,
} from "../../platform/blob-storage/filesystem.js";
import { assertSeparateRoots } from "../../platform/blob-storage/roots.js";
import { createSchemaValidator } from "../../platform/http/schemas.js";
import { causes, retryTransaction, unknownCommit } from "../../platform/jobs/queue.js";
import { closed, fingerprint } from "../../platform/outbox/events.js";
import { type Actor, type Identity, identityError } from "../identity/service.js";
import { canonicalJson } from "../sources/contracts/canonical.js";
import { createMediaJobs } from "./media-jobs.js";
import {
  adminItem,
  createMediaStore,
  currentStates,
  readyItem,
  slots,
  visibleStates,
} from "./media-store.js";

type S = components["schemas"];
type ImageMime = S["EventStage2Media"]["contentType"];
type Edit = S["EventStage2MediaEditInput"];
type EditRoute = "media_edit" | "media_delete";
type Command = { key: string; expected: number };
export type EventMediaConfig = BlobConfig & { separateFrom: string[]; draftsEnabled?: boolean };
const validate = createSchemaValidator();
const ref = (name: string) => ({ $ref: `urn:vtc:browser:v1#/$defs/${name}` });
const validateEdit = validate.compile<Edit>(ref("EventStage2MediaEditInput"));
const validateGallery = validate.compile<S["EventStage2AdminMediaList"]>(
  ref("EventStage2AdminMediaList"),
);
const dependency = () => identityError(503, "DEPENDENCY_UNAVAILABLE");
const conflict = () => identityError(409, "IDEMPOTENCY_CONFLICT");
const version = (actual: number, expected: number) => {
  if (actual !== expected) throw identityError(412, "VERSION_CONFLICT");
};
const acceptedFingerprint = (expected: number, mime: ImageMime, digest: Buffer) =>
  fingerprint(["event-media-upload/v1", expected, mime, digest.toString("hex")]);

function imageError(error: unknown): never {
  if (error instanceof BlobFailure) {
    if (error.category === "oversized") throw identityError(413);
    if (error.category === "invalid") throw identityError(422);
    throw dependency();
  }
  throw error;
}

export function createEventMedia(
  unit: UnitOfWork,
  config: EventMediaConfig,
  cursorKey: string,
  identity: Pick<Identity, "eventContextInTransaction">,
  blobs: PrivateImages = createPrivateFilesystem(config),
  now = () => new Date(),
) {
  const c = (tx: TxContext) => unit.client(tx);
  const store = createMediaStore(unit, config.draftsEnabled === true);
  const jobs = createMediaJobs(unit, store, blobs, now);
  const run = <T>(fn: (tx: TxContext) => Promise<T>) =>
    retryTransaction(unit, fn).catch((error) => {
      if (
        !unknownCommit(error) &&
        causes(error).some(
          (cause) =>
            "code" in cause &&
            [
              "ER_LOCK_WAIT_TIMEOUT",
              "ER_LOCK_DEADLOCK",
              "ECONNREFUSED",
              "ECONNRESET",
              "PROTOCOL_CONNECTION_LOST",
              "ETIMEDOUT",
              "PROTOCOL_SEQUENCE_TIMEOUT",
            ].includes(String(cause.code)),
        )
      )
        throw dependency();
      throw error;
    });
  const at = () => now().toISOString();
  const later = (ms: number) => new Date(now().getTime() + ms).toISOString();
  const authorize = (tx: TxContext, actor: Actor, manage = false) =>
    identity.eventContextInTransaction(tx, actor, [], manage ? "events.manage" : "company.read");
  async function eventForManager(
    tx: TxContext,
    actor: Actor,
    id: string,
    mode: "share" | "update",
  ) {
    await authorize(tx, actor, true);
    const event = await store.lifecycle(tx, id, mode);
    if (event.kind !== "draft" && event.kind !== "published") throw identityError(404);
    return event;
  }

  function editOrRemove(
    actor: Actor,
    eventId: string,
    mediaId: string,
    command: Command,
    route: EditRoute,
    patch?: Edit,
  ) {
    if (route === "media_edit" && !validateEdit(patch)) throw identityError(422);
    applicationId(command.key);
    applicationId(mediaId);
    const hash = createHmac("sha256", Buffer.from(cursorKey, "hex"))
      .update("event-media-command/v1\0")
      .update(
        canonicalJson([
          actor.userId,
          route,
          eventId,
          mediaId,
          command.key,
          command.expected,
          patch ?? null,
        ]),
      )
      .digest();
    return run(async (tx) => {
      const { metadata } = await eventForManager(tx, actor, eventId, "update");
      const receiptKey = and(
        eq(eventStage2Commands.actorId, actor.userId),
        eq(eventStage2Commands.route, route),
        eq(eventStage2Commands.targetId, mediaId),
        eq(eventStage2Commands.key, command.key),
      );
      const [saved] = await c(tx).select().from(eventStage2Commands).where(receiptKey).for("share");
      const row = await store.media(tx, eventId, mediaId);
      if (saved) {
        if (!row) throw identityError(404);
        if (!timingSafeEqual(saved.fingerprint, hash)) throw conflict();
        const receipt = closed(saved.result, ["schemaVersion", "route", "data"]);
        if (
          receipt.schemaVersion !== 1 ||
          receipt.route !== route ||
          !validateGallery(receipt.data)
        )
          throw new Error("INVALID_EVENT_MEDIA_RECEIPT");
        return receipt.data;
      }
      version(metadata?.mediaVersion ?? 1, command.expected);
      if (!metadata || !row?.fingerprint || !visibleStates.some((state) => state === row.state))
        throw identityError(404);
      const ordered = await store.ready(tx, eventId);
      if (patch) {
        if (row.state !== "ready") throw identityError(409);
        if (patch.position !== undefined) {
          if (patch.position >= ordered.length) throw identityError(422);
          const previous = ordered.findIndex((item) => item.id === mediaId);
          if (previous < 0) throw new Error("EVENT_MEDIA_ORDER_INCONSISTENT");
          ordered.splice(previous, 1);
          ordered.splice(patch.position, 0, row);
          await store.savePositions(tx, ordered);
        }
        if (patch.isCover === true && !row.isCover)
          await c(tx)
            .update(eventMedia)
            .set({ isCover: false })
            .where(eq(eventMedia.coverEventId, eventId));
        await c(tx)
          .update(eventMedia)
          .set({
            ...(patch.caption === undefined ? {} : { caption: patch.caption }),
            ...(patch.isCover === undefined ? {} : { isCover: patch.isCover }),
            updatedAt: at(),
          })
          .where(eq(eventMedia.id, mediaId));
      } else {
        await jobs.retire(tx, row, "deleting");
        if (row.state === "ready")
          await store.savePositions(
            tx,
            ordered.filter((item) => item.id !== mediaId),
          );
      }
      await store.increment(tx, eventId);
      const data = await store.adminList(tx, eventId, metadata.mediaVersion + 1);
      if (!validateGallery(data)) throw new Error("INVALID_EVENT_MEDIA_RESULT");
      await c(tx)
        .insert(eventStage2Commands)
        .values({
          actorId: actor.userId,
          route,
          targetId: mediaId,
          key: command.key,
          fingerprint: hash,
          result: { schemaVersion: 1, route, data },
          recordedAt: at(),
        });
      return data;
    });
  }

  return {
    config,
    handlers: jobs.handlers,
    maintenance: jobs.maintenance,
    discardInTransaction: jobs.discardInTransaction,
    coverIdsInTransaction: store.coverIdsInTransaction,
    async initialize(...additionalRoots: string[]) {
      await blobs.ready?.();
      try {
        for (const root of new Set([...config.separateFrom, ...additionalRoots]))
          await assertSeparateRoots(config.root, root);
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          (error.code === "EACCES" || error.code === "EPERM")
        )
          throw new BlobFailure("unavailable");
        throw error;
      }
    },
    authorize: (actor: Actor, manage: boolean) => run((tx) => authorize(tx, actor, manage)),
    adminList(actor: Actor, eventId: string) {
      return run(async (tx) => {
        const { metadata } = await eventForManager(tx, actor, eventId, "share");
        return store.adminList(tx, eventId, metadata?.mediaVersion ?? 1);
      });
    },
    memberList(actor: Actor, eventId: string) {
      return run(async (tx): Promise<S["EventStage2MediaList"]> => {
        await authorize(tx, actor);
        const event = await store.lifecycle(tx, eventId, "share");
        if (event.kind !== "published") throw identityError(404);
        return {
          version: event.metadata?.mediaVersion ?? 1,
          items: (await store.ready(tx, eventId)).map(readyItem),
        };
      });
    },
    async content(
      actor: Actor | null,
      eventId: string,
      mediaId: string | null,
      size: "thumb" | "full",
    ) {
      const row = await run(async (tx) => {
        if (actor) await authorize(tx, actor);
        const event = await store.lifecycle(tx, eventId, "share");
        if (!actor) {
          if (
            event.kind !== "published" ||
            event.visibility !== "public" ||
            size !== "thumb" ||
            mediaId !== null
          )
            throw identityError(404);
        } else if (event.kind === "draft") {
          if (!actor.capabilities.includes("events.manage")) throw identityError(404);
        } else if (event.kind !== "published") throw identityError(404);
        if (!event.metadata) throw identityError(404);
        const [ready] = await c(tx)
          .select()
          .from(eventMedia)
          .where(
            and(
              eq(eventMedia.eventId, eventId),
              eq(eventMedia.state, "ready"),
              actor && mediaId ? eq(eventMedia.id, mediaId) : eq(eventMedia.coverEventId, eventId),
            ),
          )
          .limit(1)
          .for("share");
        if (!ready) throw identityError(404);
        return ready;
      });
      try {
        const key = { id: row.id, generation: row.generation };
        return size === "thumb"
          ? {
              stream: await blobs.readThumbnail(key),
              contentType: "image/jpeg" as const,
              byteLength: null,
            }
          : {
              stream: await blobs.read(key),
              contentType: row.contentType,
              byteLength: row.byteLength,
            };
      } catch {
        throw dependency();
      }
    },
    edit: (actor: Actor, eventId: string, mediaId: string, command: Command, patch: Edit) =>
      editOrRemove(actor, eventId, mediaId, command, "media_edit", patch),
    remove: (actor: Actor, eventId: string, mediaId: string, command: Command) =>
      editOrRemove(actor, eventId, mediaId, command, "media_delete"),

    async upload(
      actor: Actor,
      eventId: string,
      command: Command,
      contentType: string,
      bytes: AsyncIterable<Uint8Array>,
      signal: AbortSignal,
    ): Promise<S["EventStage2MediaUpload"]> {
      if (contentType !== "image/png" && contentType !== "image/jpeg") throw identityError(415);
      applicationId(command.key);
      const token = newId();
      const reservation = await run(async (tx) => {
        const event = await eventForManager(tx, actor, eventId, "update");
        const where = and(
          eq(eventMedia.eventId, eventId),
          eq(eventMedia.uploaderId, actor.userId),
          eq(eventMedia.uploadKey, command.key),
        );
        const [existing] = await c(tx).select().from(eventMedia).where(where).for("update");
        if (existing?.fingerprint) return { replay: true as const, id: existing.id };
        if (existing?.state === "processing" && existing.leaseUntil && existing.leaseUntil > at())
          throw conflict();
        version(event.metadata?.mediaVersion ?? 1, command.expected);
        const active = await c(tx)
          .select({ id: eventMedia.id })
          .from(eventMedia)
          .where(
            and(
              eq(eventMedia.eventId, eventId),
              inArray(eventMedia.state, currentStates),
              existing ? ne(eventMedia.id, existing.id) : undefined,
            ),
          )
          .limit(slots)
          .for("share");
        if (active.length >= slots) throw identityError(409);
        signal.throwIfAborted();
        if (!event.metadata)
          await c(tx).insert(eventMetadata).values({
            id: eventId,
            publishedEventId: eventId,
            createdAt: at(),
          });
        const id = existing?.id ?? newId();
        const generation = newId();
        const leaseUntil = later(config.timeoutMs + 15_000);
        const fields = {
          generation,
          leaseToken: token,
          leaseUntil,
          state: "processing" as const,
          contentType: contentType as ImageMime,
          nextCheckAt: leaseUntil,
          updatedAt: at(),
        };
        if (existing) await c(tx).update(eventMedia).set(fields).where(eq(eventMedia.id, id));
        else
          await c(tx)
            .insert(eventMedia)
            .values({
              ...fields,
              id,
              eventId,
              uploaderId: actor.userId,
              uploadKey: command.key,
              originalName: "",
              createdAt: at(),
            });
        await jobs.trackGeneration(tx, id, generation, leaseUntil);
        return { replay: false as const, id, generation };
      });

      if (reservation.replay) {
        const hash = createHash("sha256");
        let byteLength = 0;
        try {
          for await (const chunk of bytes) {
            signal.throwIfAborted();
            byteLength += chunk.length;
            if (byteLength > config.maxFileBytes) throw new BlobFailure("oversized");
            hash.update(chunk);
          }
          signal.throwIfAborted();
        } catch (error) {
          if (signal.aborted) throw dependency();
          imageError(error);
        }
        const digest = acceptedFingerprint(command.expected, contentType, hash.digest());
        return run(async (tx) => {
          const { metadata } = await eventForManager(tx, actor, eventId, "share");
          const row = await store.media(tx, eventId, reservation.id);
          if (!metadata || !row?.fingerprint) throw identityError(404);
          if (!timingSafeEqual(row.fingerprint, digest)) throw conflict();
          return { version: metadata.mediaVersion, item: adminItem(row) };
        });
      }

      try {
        const image = await blobs.putImage(reservation, bytes, contentType, signal);
        return await run(async (tx) => {
          const { metadata } = await eventForManager(tx, actor, eventId, "update");
          const row = await store.media(tx, eventId, reservation.id);
          if (
            !metadata ||
            row?.state !== "processing" ||
            row.generation !== reservation.generation ||
            row.leaseToken !== token ||
            row.fingerprint ||
            !row.leaseUntil ||
            row.leaseUntil <= at()
          )
            throw dependency();
          version(metadata.mediaVersion, command.expected);
          signal.throwIfAborted();
          const updated = {
            ...image,
            fingerprint: acceptedFingerprint(command.expected, contentType, image.sha256),
            leaseToken: null,
            leaseUntil: null,
            updatedAt: at(),
            nextCheckAt: later(60_000),
          };
          await c(tx).update(eventMedia).set(updated).where(eq(eventMedia.id, row.id));
          await store.increment(tx, eventId);
          await jobs.enqueueThumbnail(tx, eventId, row.id, row.generation);
          return { version: metadata.mediaVersion + 1, item: adminItem({ ...row, ...updated }) };
        });
      } catch (error) {
        if (!unknownCommit(error)) {
          try {
            await run(async (tx) => {
              const event = await store.lifecycle(tx, eventId, "update");
              const row = await store.media(tx, eventId, reservation.id);
              if (
                row?.state === "processing" &&
                !row.fingerprint &&
                row.generation === reservation.generation &&
                row.leaseToken === token
              )
                await jobs.retire(tx, row, event.kind === "discarded" ? "deleting" : "rejected");
            });
          } catch {
            // The durable lease and generation scan recover an interrupted release.
          }
        }
        if (signal.aborted && !unknownCommit(error)) throw dependency();
        imageError(error);
      }
    },
  };
}
export type EventMedia = ReturnType<typeof createEventMedia>;
