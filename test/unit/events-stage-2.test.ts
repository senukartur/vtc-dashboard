import { afterEach, expect, test, vi } from "vitest";
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
