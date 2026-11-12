import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readdir, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { components } from "@vtc/contracts";
import { createUnitOfWork, newId, runMigrations, type UnitOfWork } from "@vtc/db";
import {
  eventDrafts,
  eventMedia,
  eventMediaGenerations,
  eventMetadata,
} from "@vtc/db/events-schema";
import { mailDeliveries } from "@vtc/db/messaging-schema";
import { durableJobs, eq } from "@vtc/db/platform-schema";
import type { Connection } from "mysql2/promise";
import {
  afterAll as after,
  afterEach,
  beforeAll as before,
  beforeEach,
  expect,
  test,
} from "vitest";
import { createApp } from "../../apps/api/src/app.ts";
import {
  createEventMedia,
  type EventMedia,
  type EventMediaConfig,
} from "../../apps/api/src/modules/events/media.ts";
import { createEvents, type Events } from "../../apps/api/src/modules/events/service.ts";
import { csrfProtection } from "../../apps/api/src/modules/identity/http.ts";
import {
  type Actor,
  createIdentity,
  type Identity,
} from "../../apps/api/src/modules/identity/service.ts";
import {
  BlobFailure,
  createPrivateFilesystem,
  type PrivateImages,
} from "../../apps/api/src/platform/blob-storage/filesystem.ts";
import { createQueue } from "../../apps/api/src/platform/jobs/queue.ts";
import { identityAccessEvents } from "../../apps/api/src/platform/outbox/events.ts";
import { composeIdentity } from "../../apps/api/src/use-cases/identity-messaging.ts";
import { pngBytes } from "../fixtures/manual-images.ts";
import {
  guardedSettings,
  reset,
  SCHEMA_SETUP_TIMEOUT_MS,
  testConnection,
} from "../persistence/support.ts";
import { bounded, deferred } from "../support/concurrency.ts";
import { safeChildEnvironment } from "../support/environment.ts";
import { childClose } from "../support/fixture-settlement.ts";
import { schemaLifecycleHooks } from "../support/schema-lifecycle.ts";

const { beforeAll, afterAll } = schemaLifecycleHooks(before, after);
const origin = "http://127.0.0.1:4173";
const password = "Fictional-event-media-passphrase";
const config = { cursorKey: randomBytes(32).toString("hex") };
const signal = new AbortController().signal;
const image = pngBytes(600, 320);
type User = { actor: Actor; cookie: string; email: string };
let control: Connection;
let unit: UnitOfWork;
let identity: Identity;
let events: Events;
let director: User;
let member: User;
let directory: string;
let storage: EventMediaConfig;
let blobs: PrivateImages;
let media: EventMedia;
let clock: number;
const now = () => new Date(clock);

async function signIn(email: string): Promise<User> {
  const login = await identity.login(email, password);
  const cookie = login.cookies.map((value) => value.split(";", 1)[0]).join("; ");
  return { actor: await identity.authenticate(new Headers({ cookie })), cookie, email };
}
async function createMember(role: "trainee" | "deputy_director") {
  const id = newId();
  const email = `${id}@example.invalid`;
  const credential = await identity.prepareCredential(password);
  await unit.run((tx) =>
    identity.insertWithCredential(tx, {
      userId: id,
      email,
      name: "Fictional Gallery Member",
      roles: [role],
      ...credential,
    }),
  );
  return signIn(email);
}
function definition(visibility: "public" | "members"): components["schemas"]["EventInput"] {
  return {
    title: "Fictional gallery convoy",
    description: "Fictional event description",
    game: "ets2",
    server: "Fictional simulation server",
    organizer: "Fictional company",
    route: "Fictional route",
    meetingLocation: "Fictional meeting point",
    meetingAt: new Date(clock + 120_000).toISOString(),
    startsAt: new Date(clock + 180_000).toISOString(),
    endsAt: null,
    visibility,
    originCityId: null,
    destinationCityId: null,
    prescribedCargoId: null,
    prescribedMassKg: null,
    prescribedTrailerTypeId: null,
  };
}
async function event(visibility: "public" | "members" = "public") {
  return (await events.create(director.actor, newId(), definition(visibility))).data.event.id;
}
async function draft() {
  const id = newId();
  await unit.run(async (tx) => {
    const c = unit.client(tx);
    await c.insert(eventMetadata).values({ id, createdAt: now().toISOString() });
    await c.insert(eventDrafts).values({
      eventId: id,
      version: 1,
      updatedBy: director.actor.userId,
      updatedAt: now().toISOString(),
    });
  });
  return id;
}
async function* chunks(bytes = image) {
  yield bytes;
}
const command = (expected: number, key = newId()) => ({ expected, key });
const upload = (eventId: string, expected: number) =>
  media.upload(director.actor, eventId, command(expected), "image/png", chunks(), signal);
const queue = () => createQueue(unit, media.handlers);
async function runNext(kind = "events.media-thumbnail") {
  const jobs = queue();
  const claim = await jobs.claim();
  expect(claim?.kind.toString()).toBe(kind);
  if (!claim) throw new Error("EXPECTED_MEDIA_JOB");
  await jobs.execute(claim);
  return claim;
}
async function cleanup() {
  clock += 120_000;
  await media.maintenance(signal);
  const jobs = queue();
  for (let n = 0; n < 20; n++) {
    const claim = await jobs.claim();
    if (!claim) return;
    expect(claim.kind.toString()).toBe("events.media-cleanup");
    await jobs.execute(claim);
  }
  throw new Error("UNSETTLED_MEDIA_CLEANUP");
}
async function state(id: string) {
  return unit.run(async (tx) => {
    const [row] = await unit.client(tx).select().from(eventMedia).where(eq(eventMedia.id, id));
    return row;
  });
}
async function jobState(id: string) {
  return unit.run(async (tx) => {
    const [row] = await unit.client(tx).select().from(durableJobs).where(eq(durableJobs.id, id));
    return row;
  });
}
async function dueJob(id: string) {
  await unit.run((tx) =>
    unit
      .client(tx)
      .update(durableJobs)
      .set({ availableAt: now().toISOString() })
      .where(eq(durableJobs.id, id)),
  );
}
async function runWorker(env: NodeJS.ProcessEnv) {
  const child = spawn(process.execPath, ["apps/api/dist/jobs.js", "run"], {
    env: { ...safeChildEnvironment(), ...env },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const completion = childClose(child);
  let storageUnavailable = false;
  let result = false;
  createInterface({ input: child.stdout }).on("line", (line) => {
    if (line.includes('"event":"jobs_result"')) result = true;
  });
  createInterface({ input: child.stderr }).on("line", (line) => {
    if (line.includes('"event":"event_media_root_unavailable"')) storageUnavailable = true;
  });
  try {
    const outcome = await bounded(completion, "event-media-worker", 8_000);
    expect(outcome).toMatchObject({ signal: null, spawnFailed: false, streamFailed: false });
    return { code: outcome.code, storageUnavailable, result };
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    await completion;
  }
}
function useStorage(adapter: PrivateImages) {
  media = createEventMedia(unit, storage, config.cursorKey, identity, adapter, now);
}
function headers(user: User, expected: number, key = newId()) {
  const csrf = csrfProtection(identity.config).issue({}, user.actor);
  return {
    origin,
    cookie: `${user.cookie}; ${csrf.cookie.split(";", 1)[0]}`,
    "x-csrf-token": csrf.token,
    "idempotency-key": key,
    "if-match": `"v${expected}"`,
  };
}
function multipart(bytes: Buffer, type = "image/png", extra = false) {
  const boundary = "synthetic-event-media-boundary";
  return {
    type: `multipart/form-data; boundary=${boundary}`,
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="fictional-private-name.png"\r\nContent-Type: ${type}\r\n\r\n`,
      ),
      bytes,
      Buffer.from(
        extra
          ? `\r\n--${boundary}\r\nContent-Disposition: form-data; name="extra"\r\n\r\nforbidden\r\n--${boundary}--\r\n`
          : `\r\n--${boundary}--\r\n`,
      ),
    ]),
  };
}

beforeAll(async () => {
  control = await testConnection();
  unit = createUnitOfWork(guardedSettings());
  await reset(control);
  await runMigrations(guardedSettings());
  clock = Date.now() - 3_600_000;
  identity = createIdentity(
    unit,
    { secret: randomBytes(32).toString("hex"), origin, production: false },
    { accessEvents: identityAccessEvents(unit) },
    now,
  );
  const email = "event-media-director@example.invalid";
  await identity.bootstrap({ email, name: "Fictional Gallery Director", password });
  director = await signIn(email);
  member = await createMember("trainee");
  events = createEvents(unit, config, { identity }, now);
}, SCHEMA_SETUP_TIMEOUT_MS);
beforeEach(async () => {
  clock = Date.now() - 3_600_000;
  await control.query("DELETE FROM job_effect_receipts");
  await control.query("DELETE FROM durable_jobs");
  await control.query("DELETE FROM event_media_generations");
  await control.query("DELETE FROM event_media");
  await control.query("DELETE FROM event_workflow_commands");
  await control.query("DELETE FROM event_drafts");
  await control.query("DELETE FROM event_metadata");
  directory = await mkdtemp(join(tmpdir(), "vtc-event-gallery-"));
  storage = {
    root: directory,
    maxFileBytes: 4096,
    maxPixels: 500_000,
    timeoutMs: 8000,
    separateFrom: [],
  };
  blobs = createPrivateFilesystem(storage);
  useStorage(blobs);
});
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});
afterAll(async () => {
  await unit?.close();
  await control?.end();
}, SCHEMA_SETUP_TIMEOUT_MS);

test("staged multipart, closed gallery, full image and public-cover access use current visibility", async () => {
  const id = await event();
  const app = await createApp({
    checkReadiness: async () => true,
    identity,
    events,
    eventMedia: media,
  });
  const base = `/api/v1/admin/events/${id}/media`;
  const key = newId();
  try {
    const body = multipart(image);
    const post = (h: Record<string, string>, b = body) =>
      app.inject({
        method: "POST",
        url: base,
        headers: { ...h, "content-type": b.type },
        payload: b.payload,
      });
    expect(
      (await app.inject({ method: "GET", url: base, headers: { cookie: member.cookie } }))
        .statusCode,
    ).toBe(403);
    expect((await post({ cookie: director.cookie })).statusCode).toBe(403);
    const { "if-match": _expected, ...missingVersion } = headers(director, 1);
    expect((await post(missingVersion)).statusCode).toBe(428);
    expect((await post(headers(director, 1), multipart(image, "image/jpeg"))).statusCode).toBe(422);
    const empty = await app.inject({ url: base, headers: { cookie: director.cookie } });
    expect(empty.headers.etag).toBe('"v1"');
    expect(empty.json().data).toEqual({ version: 1, items: [] });
    expect(await readdir(directory)).toEqual([]);
    expect(
      (await post(headers(director, 1), multipart(Buffer.from("not an image")))).statusCode,
    ).toBe(422);
    expect((await post(headers(director, 1), multipart(pngBytes(800, 800)))).statusCode).toBe(422);
    expect((await post(headers(director, 1), multipart(Buffer.alloc(4097)))).statusCode).toBe(413);
    expect([413, 422]).toContain(
      (await post(headers(director, 1), multipart(image, "image/png", true))).statusCode,
    );

    const initial = await post(headers(director, 1, key));
    expect(initial.statusCode).toBe(202);
    expect(initial.headers.etag).toBe('"v2"');
    const mediaId = initial.json().data.item.id;
    expect(initial.json().data).toEqual({
      version: 2,
      item: { id: mediaId, state: "processing", media: null },
    });
    const content = `/api/v1/events/${id}/media/${mediaId}/content`;
    const cover = `/api/v1/public/events/${id}/cover`;
    expect((await app.inject({ url: cover })).statusCode).toBe(404);
    expect(
      (await app.inject({ url: `${content}?size=full`, headers: { cookie: member.cookie } }))
        .statusCode,
    ).toBe(404);
    await runNext();
    const edit = await app.inject({
      method: "PATCH",
      url: `${base}/${mediaId}`,
      headers: headers(director, 3),
      payload: { caption: "Fictional caption", isCover: true },
    });
    expect(edit.statusCode).toBe(200);
    expect(edit.headers.etag).toBe('"v4"');
    const safe = {
      id: mediaId,
      contentType: "image/png",
      byteLength: image.length,
      width: 600,
      height: 320,
      caption: "Fictional caption",
      position: 0,
      isCover: true,
    };
    expect(edit.json().data).toEqual({
      version: 4,
      items: [{ id: mediaId, state: "ready", media: safe }],
    });
    const listing = await app.inject({
      url: `/api/v1/events/${id}/media`,
      headers: { cookie: member.cookie },
    });
    expect(listing.json().data).toEqual({ version: 4, items: [safe] });
    const replay = await post(headers(director, 1, key));
    expect(replay.statusCode).toBe(202);
    expect(replay.headers.etag).toBe('"v4"');
    expect(replay.json().data).toEqual({
      version: 4,
      item: { id: mediaId, state: "ready", media: safe },
    });
    expect((await post(headers(director, 2, key))).statusCode).toBe(409);
    expect((await post(headers(director, 1, key), multipart(pngBytes(2, 2)))).statusCode).toBe(409);
    expect((await app.inject({ url: `${content}?size=full` })).statusCode).toBe(401);
    const full = await app.inject({
      url: `${content}?size=full`,
      headers: { cookie: member.cookie },
    });
    expect(full.statusCode).toBe(200);
    expect(full.headers["content-type"]).toBe("image/png");
    expect(full.rawPayload).toEqual(image);
    const publicImage = await app.inject({ url: cover });
    expect(publicImage.statusCode).toBe(200);
    expect(publicImage.headers).toMatchObject({
      "content-type": "image/jpeg",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    expect(publicImage.rawPayload.readUInt16BE(0)).toBe(0xffd8);
    const thumbnail = await app.inject({
      url: `${content}?size=thumb`,
      headers: { cookie: member.cookie },
    });
    expect(thumbnail.rawPayload).toEqual(publicImage.rawPayload);
    expect((await events.get(member.actor, id)).version).toBe(1);
    await events.update(director.actor, id, newId(), 1, definition("members"));
    expect((await app.inject({ url: cover })).statusCode).toBe(404);
    expect(
      (await app.inject({ url: `${content}?size=full`, headers: { cookie: member.cookie } }))
        .statusCode,
    ).toBe(200);
    await events.cancel(director.actor, id, newId(), 2, "Fictional cancellation");
    expect(
      (await app.inject({ url: `${content}?size=full`, headers: { cookie: member.cookie } }))
        .statusCode,
    ).toBe(200);
  } finally {
    await app.close();
  }
});

test("the tenth slot and one key serialize across in-flight uploads", async () => {
  const id = await event();
  for (let v = 1; v <= 9; v++) await upload(id, v);
  const started = deferred<void>();
  const resume = deferred<void>();
  async function* held() {
    started.resolve();
    await resume.promise;
    yield image;
  }
  const tenth = command(10);
  const running = media.upload(director.actor, id, tenth, "image/png", held(), signal);
  try {
    await bounded(started.promise, "tenth-slot-reserved");
    expect((await media.adminList(director.actor, id)).items).toHaveLength(9);
    await expect(upload(id, 10)).rejects.toMatchObject({ statusCode: 409 });
    await expect(
      media.upload(director.actor, id, tenth, "image/png", chunks(), signal),
    ).rejects.toMatchObject({ statusCode: 409, publicCode: "IDEMPOTENCY_CONFLICT" });
  } finally {
    resume.resolve();
    await running;
  }
  const result = await running;
  expect(await media.upload(director.actor, id, tenth, "image/png", chunks(), signal)).toEqual(
    result,
  );
  expect((await media.adminList(director.actor, id)).items).toHaveLength(10);
  await expect(upload(id, 11)).rejects.toMatchObject({ statusCode: 409 });
}, 30_000);

test("cover replacement, position and delete receipts are atomic and exact upload replay stays tombstoned", async () => {
  const id = await event();
  const firstCommand = command(1);
  const first = await media.upload(director.actor, id, firstCommand, "image/png", chunks(), signal);
  await runNext();
  const second = await upload(id, 3);
  await runNext();
  const firstId = first.item.id;
  const secondId = second.item.id;
  const editCommand = command(5);
  const cover = await media.edit(director.actor, id, firstId, editCommand, { isCover: true });
  await expect(
    media.edit(director.actor, id, firstId, editCommand, { isCover: false }),
  ).rejects.toMatchObject({ statusCode: 409 });
  await expect(
    media.edit(director.actor, id, secondId, command(5), { isCover: true }),
  ).rejects.toMatchObject({ statusCode: 412 });
  const replaced = await media.edit(director.actor, id, secondId, command(6), {
    isCover: true,
    position: 0,
  });
  expect(
    replaced.items.map((item) => [item.id, item.media?.isCover, item.media?.position]),
  ).toEqual([
    [secondId, true, 0],
    [firstId, false, 1],
  ]);
  expect(await media.edit(director.actor, id, firstId, editCommand, { isCover: true })).toEqual(
    cover,
  );
  const remove = command(7);
  const removed = await media.remove(director.actor, id, secondId, remove);
  expect(removed.items.map((item) => [item.id, item.media?.position])).toEqual([[firstId, 0]]);
  expect(await media.remove(director.actor, id, secondId, remove)).toEqual(removed);
  await expect(media.content(null, id, null, "thumb")).rejects.toMatchObject({ statusCode: 404 });
  const removedFirst = await media.remove(director.actor, id, firstId, command(8));
  expect(removedFirst.items).toEqual([]);
  await expect(
    media.upload(director.actor, id, firstCommand, "image/png", chunks(), signal),
  ).rejects.toMatchObject({ statusCode: 404 });
  await cleanup();
  expect(await readdir(directory)).toEqual([]);
  expect((await state(firstId))?.state).toBe("deleted");
  expect((await state(secondId))?.state).toBe("deleted");
});

test("draft images are private, discarded storage is cleaned and revoked managers cannot replay", async () => {
  const id = await draft();
  const deputy = await createMember("deputy_director");
  const request = command(1);
  const uploaded = await media.upload(deputy.actor, id, request, "image/png", chunks(), signal);
  const mediaId = uploaded.item.id;
  await runNext();
  await media.edit(director.actor, id, mediaId, command(3), { isCover: true });
  const content = await media.content(deputy.actor, id, mediaId, "thumb");
  content.stream.destroy();
  await expect(media.content(member.actor, id, mediaId, "full")).rejects.toMatchObject({
    statusCode: 404,
  });
  await expect(media.memberList(member.actor, id)).rejects.toMatchObject({ statusCode: 404 });
  await expect(media.content(null, id, null, "thumb")).rejects.toMatchObject({ statusCode: 404 });
  await identity.administer(director.actor, deputy.actor.userId, newId(), 1, {
    kind: "roles",
    roles: ["dispatcher"],
  });
  await expect(
    media.upload(deputy.actor, id, request, "image/png", chunks(), signal),
  ).rejects.toMatchObject({ statusCode: 401 });
  const current = await signIn(deputy.email);
  await expect(
    media.upload(current.actor, id, request, "image/png", chunks(), signal),
  ).rejects.toMatchObject({ statusCode: 403 });
  await unit.run(async (tx) => {
    const c = unit.client(tx);
    await c.select().from(eventMetadata).where(eq(eventMetadata.id, id)).for("update");
    await c
      .update(eventDrafts)
      .set({ discardedAt: now().toISOString() })
      .where(eq(eventDrafts.eventId, id));
    await media.discardInTransaction(tx, id);
  });
  await expect(media.adminList(director.actor, id)).rejects.toMatchObject({ statusCode: 404 });
  await expect(media.content(director.actor, id, mediaId, "full")).rejects.toMatchObject({
    statusCode: 404,
  });
  await cleanup();
  expect(await readdir(directory)).toEqual([]);
});

test("thumbnail retry is fenced from deletion and terminal failures expose rejected state without files", async () => {
  const id = await event();
  const began = deferred<void>();
  const resume = deferred<void>();
  let calls = 0;
  useStorage({
    ...blobs,
    async makeThumbnail(...args) {
      calls++;
      if (calls === 1) throw new BlobFailure("unavailable");
      began.resolve();
      await resume.promise;
      await blobs.makeThumbnail(...args);
    },
  });
  const processing = await upload(id, 1);
  const first = await runNext();
  expect((await jobState(first.id))?.failure).toBe("retryable");
  await dueJob(first.id);
  const running = runNext();
  try {
    await bounded(began.promise, "retried-thumbnail-prepared");
    await media.remove(director.actor, id, processing.item.id, command(2));
  } finally {
    resume.resolve();
  }
  const second = await running;
  expect(second.id).toBe(first.id);
  expect(second.leaseToken).not.toBe(first.leaseToken);
  expect((await state(processing.item.id))?.state).toBe("deleting");
  await cleanup();
  expect(await readdir(directory)).toEqual([]);

  useStorage({
    ...blobs,
    async makeThumbnail() {
      throw new BlobFailure("unavailable");
    },
  });
  const key = command(3);
  const uploadResult = await media.upload(director.actor, id, key, "image/png", chunks(), signal);
  for (let n = 0; n < 5; n++) {
    const job = await runNext();
    if (n < 4) await dueJob(job.id);
    else expect((await jobState(job.id))?.state).toBe("failed");
  }
  await cleanup();
  expect(await media.upload(director.actor, id, key, "image/png", chunks(), signal)).toEqual({
    version: 5,
    item: { id: uploadResult.item.id, state: "rejected", media: null },
  });
  expect(await readdir(directory)).toEqual([]);
});

test("expired invisible reservations release capacity and old writes stay fenced from replacement", async () => {
  const id = await event();
  const key = command(1);
  const began = deferred<void>();
  const resume = deferred<void>();
  async function* held() {
    began.resolve();
    await resume.promise;
    yield image;
  }
  const original = media.upload(director.actor, id, key, "image/png", held(), signal);
  const first = expect(original).rejects.toMatchObject({ statusCode: 503 });
  try {
    await bounded(began.promise, "original-reservation");
    clock += 60_000;
    await media.maintenance(signal);
    expect(await media.adminList(director.actor, id)).toEqual({ version: 1, items: [] });
    clock++;
    const replacement = await media.upload(director.actor, id, key, "image/png", chunks(), signal);
    expect(replacement.version).toBe(2);
    const generations = await unit.run((tx) =>
      unit
        .client(tx)
        .select()
        .from(eventMediaGenerations)
        .where(eq(eventMediaGenerations.mediaId, replacement.item.id)),
    );
    expect(generations).toHaveLength(2);
    resume.resolve();
    await first;
    // Both generations are due, but only the replacement's thumbnail may become readable.
    await runNext("events.media-cleanup");
    await runNext();
    expect((await state(replacement.item.id))?.state).toBe("ready");
    expect(await readdir(directory)).toHaveLength(2);
  } finally {
    resume.resolve();
    await first;
  }
});

test("thumbnail and cleanup jobs use shared locks on published and draft lifecycle records", async () => {
  const publishedId = await event();
  const draftId = await draft();
  const publishedImage = await upload(publishedId, 1);
  const draftImage = await upload(draftId, 1);
  await control.beginTransaction();
  try {
    await control.execute("SELECT id FROM events WHERE id=? FOR SHARE", [Buffer.from(publishedId)]);
    await control.execute("SELECT event_id FROM event_drafts WHERE event_id=? FOR SHARE", [
      Buffer.from(draftId),
    ]);
    await runNext();
    await runNext();
    expect((await state(publishedImage.item.id))?.state).toBe("ready");
    expect((await state(draftImage.item.id))?.state).toBe("ready");
    await media.remove(director.actor, publishedId, publishedImage.item.id, command(3));
    await media.remove(director.actor, draftId, draftImage.item.id, command(3));
    await cleanup();
    expect((await state(publishedImage.item.id))?.state).toBe("deleted");
    expect((await state(draftImage.item.id))?.state).toBe("deleted");
    expect(await readdir(directory)).toEqual([]);
  } finally {
    await control.rollback();
  }
});

test("worker passes preserve media attempts during a root outage while local mail completes", async () => {
  const ancestor = join(directory, "ancestor");
  const activeRoot = join(ancestor, "active");
  const offlineRoot = join(directory, "offline");
  await mkdir(ancestor, { mode: 0o700 });
  await mkdir(activeRoot, { mode: 0o700 });
  storage = { ...storage, root: activeRoot };
  useStorage(createPrivateFilesystem(storage));
  const id = await event();
  const accepted = await upload(id, 1);
  const [thumbnail] = await unit.run((tx) =>
    unit
      .client(tx)
      .select({ id: durableJobs.id })
      .from(durableJobs)
      .where(eq(durableJobs.kind, Buffer.from("events.media-thumbnail"))),
  );
  if (!thumbnail) throw new Error("EXPECTED_MEDIA_THUMBNAIL");
  const thumbnailId = thumbnail.id;
  const mail = {
    mode: "local" as const,
    key: randomBytes(32).toString("hex"),
    sender: "event-media-notice@example.invalid",
    origin,
    production: false,
  };
  const messaging = composeIdentity(unit, identity.config, mail);
  async function queueLocalMail() {
    const recipient = await createMember("trainee");
    const challenge = await messaging.identity.requestChallenge(
      recipient.actor,
      newId(),
      "email_verification",
    );
    if (typeof challenge.id !== "string") throw new Error("EXPECTED_LOCAL_MAIL_CHALLENGE");
    return challenge.id;
  }
  async function expectMailDelivered(generation: string) {
    const [delivery] = await unit.run((tx) =>
      unit
        .client(tx)
        .select({ state: mailDeliveries.state, attempts: mailDeliveries.attempts })
        .from(mailDeliveries)
        .where(eq(mailDeliveries.generationId, generation)),
    );
    expect(delivery).toEqual({ state: "simulated", attempts: 1 });
  }
  const db = guardedSettings();
  const env = {
    MYSQL_HOST: db.host,
    MYSQL_PORT: String(db.port),
    MYSQL_DATABASE: db.database,
    MYSQL_USER: db.user,
    MYSQL_PASSWORD: db.password,
    IDENTITY_ENABLED: "true",
    IDENTITY_SECRET: identity.config.secret,
    IDENTITY_ORIGIN: origin,
    MAIL_MODE: mail.mode,
    MAIL_ENCRYPTION_KEY: mail.key,
    MAIL_SENDER: mail.sender,
    EVENTS_ENABLED: "true",
    EVENTS_CURSOR_KEY: config.cursorKey,
    EVENT_MEDIA_ROOT: activeRoot,
    MANUAL_MAX_FILE_BYTES: String(storage.maxFileBytes),
    MANUAL_MAX_PIXELS: String(storage.maxPixels),
    MANUAL_UPLOAD_TIMEOUT_MS: String(storage.timeoutMs),
  };
  async function expectPausedPass() {
    expect(await runWorker(env)).toEqual({ code: 1, storageUnavailable: true, result: true });
    expect(await jobState(thumbnailId)).toMatchObject({ state: "ready", attempts: 0 });
    expect((await state(accepted.item.id))?.state).toBe("processing");
  }
  const missingRootMail = await queueLocalMail();
  await rename(activeRoot, offlineRoot);
  try {
    await expectPausedPass();
    await expectPausedPass();
    await expectMailDelivered(missingRootMail);
  } finally {
    await rename(offlineRoot, activeRoot);
  }
  if ((process.getuid?.() ?? 0) > 0) {
    const inaccessibleRootMail = await queueLocalMail();
    await chmod(ancestor, 0o000);
    try {
      await expect(lstat(activeRoot)).rejects.toMatchObject({ code: "EACCES" });
      await expectPausedPass();
      await expectMailDelivered(inaccessibleRootMail);
    } finally {
      await chmod(ancestor, 0o700);
    }
  }
  expect(await runWorker(env)).toEqual({ code: 0, storageUnavailable: false, result: true });
  expect(await jobState(thumbnailId)).toMatchObject({ state: "completed", attempts: 1 });
  expect((await state(accepted.item.id))?.state).toBe("ready");
}, 30_000);
