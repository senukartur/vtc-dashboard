import { afterEach, expect, test, vi } from "vitest";
import {
  eventStage2ImageQueryPolicy,
  visibleEventStage2Image,
} from "../../apps/web/src/features/events/stage-2-model.ts";
import {
  eventStage2Commands,
  eventStage2Content,
  eventStage2Reads,
  readEventStage2,
  readEventStage2Content,
  sendEventStage2,
} from "../../apps/web/src/features/events/stage-2-transport.ts";
import { stage2EventId, stage2Fixture } from "../fixtures/events-stage-2.ts";

afterEach(() => vi.unstubAllGlobals());

test("staged queries include effective filters and validate the new response shape", async () => {
  const example = stage2Fixture("listEvents", "own-response");
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json(example.response))
    .mockResolvedValueOnce(
      Response.json({
        data: { items: [{ title: "Fictional legacy row" }], nextCursor: null },
        meta: { requestId: "synthetic" },
      }),
    );
  vi.stubGlobal("fetch", fetch);
  const spec = eventStage2Reads.memberList({
    locale: "ru",
    period: "past",
    limit: 2,
    cursor: "fixture&next",
  });
  const signal = new AbortController().signal;
  await expect(readEventStage2(spec, signal)).resolves.toMatchObject({ data: example.response });
  expect(fetch).toHaveBeenCalledWith(
    "/api/v1/events?locale=ru&period=past&limit=2&cursor=fixture%26next",
    expect.objectContaining({ credentials: "same-origin", cache: "no-store" }),
  );
  await expect(readEventStage2(spec, signal)).rejects.toMatchObject({ kind: "unavailable" });
});

test("browser transport preserves own RSVP versions for member list and upcoming reads", async () => {
  const list = stage2Fixture("listEvents", "own-response");
  const upcoming = stage2Fixture("getUpcomingEvent", "own-response");
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json(list.response))
    .mockResolvedValueOnce(Response.json(upcoming.response));
  vi.stubGlobal("fetch", fetch);
  const signal = new AbortController().signal;
  const response = { myResponse: "participating", myResponseVersion: 2 };
  await expect(readEventStage2(eventStage2Reads.memberList({}), signal)).resolves.toMatchObject({
    data: { data: { items: [response] } },
  });
  await expect(readEventStage2(eventStage2Reads.upcoming(), signal)).resolves.toMatchObject({
    data: { data: response },
  });
});

test("staged attendance requests the leadership projection and reads its collection ETag", async () => {
  const example = stage2Fixture("getEventAttendance", "leadership");
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json(example.response, { headers: { ETag: '"v2"' } }));
  vi.stubGlobal("fetch", fetch);
  const spec = eventStage2Reads.attendance(stage2EventId, { limit: 2, cursor: "fixture&next" });
  await expect(readEventStage2(spec, new AbortController().signal)).resolves.toEqual({
    data: example.response,
    etag: '"v2"',
  });
  expect(fetch).toHaveBeenCalledWith(
    `/api/v1/admin/events/${stage2EventId}/attendance?limit=2&cursor=fixture%26next&view=stage2`,
    expect.objectContaining({ credentials: "same-origin", cache: "no-store" }),
  );
});

test("draft commands use the staged closed request schema and preserve prepared input", () => {
  expect(eventStage2Commands.create({ draft: true }).body).toEqual({
    encoding: "json",
    value: '{"draft":true}',
  });
  expect(() => eventStage2Commands.create({ draft: false } as never)).toThrow();
  const input = { title: "Fictional original" };
  const command = eventStage2Commands.updateDraft(stage2EventId, input, '"v1"');
  input.title = "Fictional replacement";
  expect(command.body).toEqual({ encoding: "json", value: '{"title":"Fictional original"}' });
  expect(eventStage2Commands.publishDraft(stage2EventId, '"v2"').path).toBe(
    `/admin/events/${stage2EventId}/publication`,
  );
});

test("a lost upload response keeps the multipart file, CSRF and idempotency key on explicit retry", async () => {
  const spec = eventStage2Commands.upload(
    stage2EventId,
    new File(["fictional"], "synthetic.png", {
      type: "image/png",
    }),
    '"v2"',
  );
  const example = stage2Fixture("uploadEventMedia", "processing");
  const csrf = () =>
    Response.json({
      data: { token: "synthetic-nonfunctional-csrf" },
      meta: { requestId: "synthetic" },
    });
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(csrf())
    .mockRejectedValueOnce(new TypeError("Fictional interrupted request"))
    .mockResolvedValueOnce(csrf())
    .mockResolvedValueOnce(
      Response.json(example.response, { status: 202, headers: { ETag: '"v3"' } }),
    );
  vi.stubGlobal("fetch", fetch);
  const signal = new AbortController().signal;
  await expect(sendEventStage2(spec, signal)).rejects.toMatchObject({ kind: "uncertain" });
  await expect(sendEventStage2(spec, signal)).resolves.toEqual({
    data: example.response,
    etag: '"v3"',
  });
  expect(fetch.mock.calls.map(([path]) => path)).toEqual([
    "/api/v1/auth/csrf",
    `/api/v1/admin/events/${stage2EventId}/media`,
    "/api/v1/auth/csrf",
    `/api/v1/admin/events/${stage2EventId}/media`,
  ]);
  for (const index of [1, 3]) {
    const init = fetch.mock.calls[index]?.[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("Idempotency-Key")).toBe(spec.key);
    expect(headers.get("If-Match")).toBe('"v2"');
    expect(headers.get("X-CSRF-Token")).toBe("synthetic-nonfunctional-csrf");
    expect(headers.get("Content-Type")).toBeNull();
    expect((init.body as FormData).get("file")).toMatchObject({
      name: "synthetic.png",
      type: "image/png",
    });
  }
  expect(
    eventStage2Commands.upload(
      stage2EventId,
      new File(["fictional"], "synthetic.png", {
        type: "image/png",
      }),
      '"v2"',
    ).key,
  ).not.toBe(spec.key);
});

test("a public cover requests image bytes without credentials and rejects non-image responses", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ fictional: true }))
    .mockResolvedValueOnce(new Response("synthetic", { headers: { "Content-Type": "image/png" } }));
  vi.stubGlobal("fetch", fetch);
  const spec = eventStage2Content.publicCover(stage2EventId);
  const signal = new AbortController().signal;
  await expect(readEventStage2Content(spec, signal)).rejects.toMatchObject({ kind: "unavailable" });
  await expect(readEventStage2Content(spec, signal)).resolves.toMatchObject({ type: "image/png" });
  expect(fetch).toHaveBeenCalledWith(
    `/api/v1/public/events/${stage2EventId}/cover`,
    expect.objectContaining({ credentials: "omit", cache: "no-store" }),
  );
});

test("cancellation accepts a staged event without legacy text and sends the definition precondition", async () => {
  const command = eventStage2Commands.cancel(
    stage2EventId,
    { reason: "Fictional weather cancellation" },
    '"v1"',
    "ru",
  );
  const example = stage2Fixture("cancelEvent", "cancelled");
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        data: { token: "synthetic-nonfunctional-csrf" },
        meta: { requestId: "synthetic" },
      }),
    )
    .mockResolvedValueOnce(Response.json(example.response, { headers: { ETag: '"v2"' } }));
  vi.stubGlobal("fetch", fetch);
  await expect(sendEventStage2(command, new AbortController().signal)).resolves.toEqual({
    data: example.response,
    etag: '"v2"',
  });
  const [path, init] = fetch.mock.calls[1] as [string, RequestInit];
  expect(path).toBe(`/api/v1/admin/events/${stage2EventId}/cancellation?locale=ru`);
  expect(init.method).toBe("POST");
  expect(JSON.parse(String(init.body))).toEqual({ reason: "Fictional weather cancellation" });
  const headers = new Headers(init.headers);
  expect(headers.get("If-Match")).toBe('"v1"');
  expect(headers.get("Idempotency-Key")).toBe(command.key);
});

test("image data is visible only after the mounted enabled observer completes its current read", () => {
  expect(eventStage2ImageQueryPolicy).toEqual({
    gcTime: 0,
    staleTime: 0,
    refetchOnMount: "always",
  });
  const image = new Blob(["synthetic"], { type: "image/png" });
  const prior = {
    data: image,
    isSuccess: true,
    fetchStatus: "idle",
    isFetchedAfterMount: false,
  } as const;
  const authorized = { ...prior, isFetchedAfterMount: true };
  expect(visibleEventStage2Image(prior, true)).toBeUndefined();
  expect(visibleEventStage2Image(authorized, false)).toBeUndefined();
  expect(visibleEventStage2Image({ ...authorized, fetchStatus: "fetching" }, true)).toBeUndefined();
  expect(visibleEventStage2Image({ ...authorized, fetchStatus: "paused" }, true)).toBeUndefined();
  expect(visibleEventStage2Image({ ...authorized, isSuccess: false }, true)).toBeUndefined();
  expect(visibleEventStage2Image(authorized, true)).toBe(image);
});

test("staged JSON and image streams hold their read slots until their bodies finish", async () => {
  const response = stage2Fixture("getEvent", "structured").response;
  const stagedResponse = (contentType: string) => {
    const { readable, writable } = new TransformStream<Uint8Array>();
    return {
      response: new Response(readable, { headers: { "Content-Type": contentType } }),
      writer: writable.getWriter(),
    };
  };
  const detail = stagedResponse("application/json");
  const cover = stagedResponse("image/png");
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(detail.response)
    .mockResolvedValueOnce(cover.response)
    .mockResolvedValueOnce(Response.json(response));
  vi.stubGlobal("fetch", fetch);
  const signal = new AbortController().signal;
  const detailSpec = eventStage2Reads.memberDetail(stage2EventId);
  const reads = [
    readEventStage2(detailSpec, signal),
    readEventStage2Content(eventStage2Content.publicCover(stage2EventId), signal),
    readEventStage2(detailSpec, signal),
  ];
  const completed = Promise.all(reads);
  void completed.catch(() => undefined);
  const encoder = new TextEncoder();
  try {
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(detail.response.bodyUsed).toBe(true);
    expect(cover.response.bodyUsed).toBe(true);
    await cover.writer.write(encoder.encode("synthetic"));
    await cover.writer.close();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    await detail.writer.write(encoder.encode(JSON.stringify(response)));
    await detail.writer.close();
    await expect(completed).resolves.toMatchObject([
      { data: response },
      { type: "image/png" },
      { data: response },
    ]);
  } finally {
    await Promise.allSettled([cover.writer.abort(), detail.writer.abort()]);
    await Promise.allSettled(reads);
  }
});
