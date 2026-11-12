import { withReadSlot } from "../../shared/read-scheduler.js";
import { AccountFailure, read } from "../account/transport.js";
import { csrfEnvelope } from "../admissions/schema.js";
import type { DTO } from "./model.js";
import { fail, schema } from "./transport.js";

type Stage2Schema = Extract<keyof DTO, `EventStage2${string}`>;
export type EventStage2Envelope = Extract<Stage2Schema, `EventStage2Envelope${string}`>;
export type EventStage2Access = "public" | "company.read" | "events.manage";
export type EventStage2Locale = "en" | "ru";

type Page = { limit?: number; cursor?: string };
type Localized = { locale?: EventStage2Locale | undefined };
type PublishedFilter = Page & Localized & { period?: "upcoming" | "past" };
type AdminFilter = Page & Localized & { period?: "published" | "drafts" };

export type EventStage2Read<K extends EventStage2Envelope> = Readonly<{
  path: string;
  schema: K;
  access: EventStage2Access;
}>;

export type EventStage2Content = Readonly<{
  path: string;
  access: EventStage2Access;
}>;

type CommandBody =
  | { encoding: "json"; value: string }
  | { encoding: "multipart"; file: File }
  | { encoding: "empty" };

export type EventStage2Command<K extends EventStage2Envelope> = Readonly<{
  path: string;
  method: "POST" | "PATCH" | "DELETE";
  schema: K;
  status: 200 | 201 | 202;
  body: CommandBody;
  key: string;
  etag: string | null;
}>;

const event = (id: string) => `/events/${encodeURIComponent(id)}`;
const admin = (id: string) => `/admin${event(id)}`;
const draft = (id: string) => `/admin/events/drafts/${encodeURIComponent(id)}`;
const mediaItem = (path: string, id: string) => `${path}/media/${encodeURIComponent(id)}`;
const localPath = (
  path: string,
  params: PublishedFilter | AdminFilter | Localized | (Page & { view: "stage2" }),
) => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, String(value));
  }
  return query.size ? `${path}?${query}` : path;
};

const readSpec = <K extends EventStage2Envelope>(
  path: string,
  schema: K,
  access: EventStage2Access,
): EventStage2Read<K> => ({ path, schema, access });

export const eventStage2Reads = {
  publicList: (filter: PublishedFilter = {}) =>
    readSpec(localPath("/public/events", filter), "EventStage2EnvelopePublicList", "public"),
  publicDetail: (id: string, locale: EventStage2Locale = "en") =>
    readSpec(localPath(`/public${event(id)}`, { locale }), "EventStage2EnvelopePublic", "public"),
  memberList: (filter: PublishedFilter = {}) =>
    readSpec(
      localPath("/events", { ...filter, locale: filter.locale ?? "en" }),
      "EventStage2EnvelopeMemberList",
      "company.read",
    ),
  memberDetail: (id: string, locale: EventStage2Locale = "en") =>
    readSpec(localPath(event(id), { locale }), "EventStage2EnvelopeMember", "company.read"),
  upcoming: (locale: EventStage2Locale = "en") =>
    readSpec(
      localPath("/me/upcoming-event", { locale }),
      "EventStage2EnvelopeUpcoming",
      "company.read",
    ),
  adminList: (filter: AdminFilter = {}) =>
    readSpec(localPath("/admin/events", filter), "EventStage2EnvelopeAdminList", "events.manage"),
  draft: (id: string) => readSpec(draft(id), "EventStage2EnvelopeDraft", "events.manage"),
  attendance: (id: string, page: Page = {}) =>
    readSpec(
      localPath(`${admin(id)}/attendance`, { ...page, view: "stage2" }),
      "EventStage2EnvelopeAttendance",
      "events.manage",
    ),
  nonresponders: (id: string, page: Page = {}) =>
    readSpec(
      localPath(`${admin(id)}/nonresponders`, page),
      "EventStage2EnvelopeNonresponders",
      "events.manage",
    ),
  memberMedia: (id: string) =>
    readSpec(`${event(id)}/media`, "EventStage2EnvelopeMediaList", "company.read"),
  adminMedia: (id: string) =>
    readSpec(`${admin(id)}/media`, "EventStage2EnvelopeAdminMediaList", "events.manage"),
};

export const eventStage2Content = {
  member: (eventId: string, mediaId: string, size: "thumb" | "full"): EventStage2Content => ({
    path: `${mediaItem(event(eventId), mediaId)}/content?size=${size}`,
    access: "company.read",
  }),
  publicCover: (id: string): EventStage2Content => ({
    path: `/public${event(id)}/cover`,
    access: "public",
  }),
};

function jsonBody<K extends Stage2Schema | "ReasonInput">(name: K, body: DTO[K]): CommandBody {
  const parsed = schema(name).safeParse(body);
  if (!parsed.success) throw new AccountFailure("invalid");
  return { encoding: "json", value: JSON.stringify(parsed.data) };
}

const empty: CommandBody = { encoding: "empty" };
function command<K extends EventStage2Envelope>(
  path: string,
  method: EventStage2Command<K>["method"],
  name: K,
  status: EventStage2Command<K>["status"],
  body: CommandBody,
  etag: string | null,
): EventStage2Command<K> {
  if (etag !== null && !/^"v[1-9][0-9]*"$/.test(etag)) throw new AccountFailure("conflict");
  return { path, method, schema: name, status, body, etag, key: crypto.randomUUID() };
}

// Keep the prepared command object for retries. Its key, precondition and
// payload belong to the same attempt, including multipart upload retries.
export const eventStage2Commands = {
  create: (input: DTO["EventStage2CreationInput"], locale?: EventStage2Locale) =>
    command(
      localPath("/admin/events", { locale }),
      "POST",
      "EventStage2EnvelopeCreation",
      201,
      jsonBody("EventStage2CreationInput", input),
      null,
    ),
  updatePublished: (
    id: string,
    input: DTO["EventStage2Input"],
    etag: string,
    locale?: EventStage2Locale,
  ) =>
    command(
      localPath(admin(id), { locale }),
      "PATCH",
      "EventStage2EnvelopeMember",
      200,
      jsonBody("EventStage2Input", input),
      etag,
    ),

  cancel: (id: string, input: DTO["ReasonInput"], etag: string, locale: EventStage2Locale = "en") =>
    command(
      localPath(`${admin(id)}/cancellation`, { locale }),
      "POST",
      "EventStage2EnvelopeMember",
      200,
      jsonBody("ReasonInput", input),
      etag,
    ),
  updateDraft: (id: string, input: DTO["EventStage2DraftInput"], etag: string) =>
    command(
      draft(id),
      "PATCH",
      "EventStage2EnvelopeDraft",
      200,
      jsonBody("EventStage2DraftInput", input),
      etag,
    ),
  discardDraft: (id: string, etag: string) =>
    command(admin(id), "DELETE", "EventStage2EnvelopeDraftDeletion", 200, empty, etag),
  publishDraft: (id: string, etag: string, locale?: EventStage2Locale) =>
    command(
      localPath(`${admin(id)}/publication`, { locale }),
      "POST",
      "EventStage2EnvelopeMember",
      200,
      jsonBody("EventStage2PublicationInput", {}),
      etag,
    ),
  upload: (id: string, file: File, etag: string) => {
    if (!isImage(file.type) || !file.size) throw new AccountFailure("invalid");
    return command(
      `${admin(id)}/media`,
      "POST",
      "EventStage2EnvelopeMediaUpload",
      202,
      { encoding: "multipart", file },
      etag,
    );
  },
  updateMedia: (
    id: string,
    mediaId: string,
    input: DTO["EventStage2MediaEditInput"],
    etag: string,
  ) =>
    command(
      mediaItem(admin(id), mediaId),
      "PATCH",
      "EventStage2EnvelopeAdminMediaList",
      200,
      jsonBody("EventStage2MediaEditInput", input),
      etag,
    ),
  deleteMedia: (id: string, mediaId: string, etag: string) =>
    command(
      mediaItem(admin(id), mediaId),
      "DELETE",
      "EventStage2EnvelopeAdminMediaList",
      200,
      empty,
      etag,
    ),
};

async function stage2Read<T>(
  spec: EventStage2Content,
  signal: AbortSignal,
  accept: string,
  consume: (response: Response) => Promise<T>,
) {
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
  try {
    return await withReadSlot(bounded, async () => {
      const response = await fetch(`/api/v1${spec.path}`, {
        credentials: spec.access === "public" ? "omit" : "same-origin",
        cache: "no-store",
        signal: bounded,
        headers: { Accept: accept },
      });
      try {
        if (response.status !== 200) fail(response);
        const data = await consume(response);
        bounded.throwIfAborted();
        return data;
      } finally {
        if (!response.bodyUsed) await response.body?.cancel().catch(() => undefined);
      }
    });
  } catch (error) {
    if (error instanceof AccountFailure) throw error;
    throw new AccountFailure("unavailable");
  }
}

export function readEventStage2<K extends EventStage2Envelope>(
  spec: EventStage2Read<K>,
  signal: AbortSignal,
) {
  return stage2Read(spec, signal, "application/json", async (response) => {
    const parsed = schema(spec.schema).safeParse(await response.json());
    if (!parsed.success) throw new AccountFailure("unavailable");
    return { data: parsed.data, etag: response.headers.get("ETag") };
  });
}

function isImage(type: string | null): type is "image/jpeg" | "image/png" {
  return type === "image/jpeg" || type === "image/png";
}

export function readEventStage2Content(spec: EventStage2Content, signal: AbortSignal) {
  return stage2Read(spec, signal, "image/png, image/jpeg", async (response) => {
    if (!isImage(response.headers.get("Content-Type"))) throw new AccountFailure("unavailable");
    return response.blob();
  });
}

export async function sendEventStage2<K extends EventStage2Envelope>(
  spec: EventStage2Command<K>,
  signal: AbortSignal,
) {
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
  try {
    const csrf = await read("/auth/csrf", csrfEnvelope, bounded);
    const headers = new Headers({
      Accept: "application/json",
      "X-CSRF-Token": csrf.data.data.token,
      "Idempotency-Key": spec.key,
    });
    if (spec.etag) headers.set("If-Match", spec.etag);
    let body: BodyInit | undefined;
    switch (spec.body.encoding) {
      case "json":
        headers.set("Content-Type", "application/json");
        body = spec.body.value;
        break;
      case "multipart": {
        const form = new FormData();
        form.set("file", spec.body.file);
        body = form;
        break;
      }
      case "empty":
        break;
    }
    const response = await fetch(`/api/v1${spec.path}`, {
      method: spec.method,
      headers,
      credentials: "same-origin",
      cache: "no-store",
      signal: bounded,
      ...(body !== undefined && { body }),
    });
    if (response.status === 413 || response.status === 415) throw new AccountFailure("invalid");
    if (response.status !== spec.status) fail(response);
    const parsed = schema(spec.schema).safeParse(await response.json());
    const etag = response.headers.get("ETag");
    if (!parsed.success || !etag || !/^"v[1-9][0-9]*"$/.test(etag))
      throw new AccountFailure("uncertain");
    bounded.throwIfAborted();
    return { data: parsed.data, etag };
  } catch (error) {
    if (error instanceof AccountFailure) throw error;
    throw new AccountFailure("uncertain");
  }
}
