import { expect, test, vi } from "vitest";
import {
  commandAttempt,
  eventTime,
  periodFrom,
  responseInput,
  utcInput,
} from "../../apps/web/src/features/events/model.ts";
import { EventFailure, eventRead, schema } from "../../apps/web/src/features/events/transport.ts";
import { eventTranslations } from "../../apps/web/src/features/events/translations.ts";
test("event periods default safely and UTC entry rejects invalid calendar and order source values", () => {
  expect(periodFrom("past")).toBe("past");
  expect(periodFrom("unknown")).toBe("upcoming");
  expect(utcInput("2026-02-29T12:00")).toBeUndefined();
  expect(utcInput("2026-10-25T01:30")).toBe("2026-10-25T01:30:00.000Z");
  expect(utcInput("2026-10-25T01:30:00.123")).toBe("2026-10-25T01:30:00.123Z");
  expect(utcInput("2026-10-25T01:30+01:00")).toBeUndefined();
  expect(eventTime("2026-10-25T00:30:00.000Z", "en", "Europe/Warsaw")).toContain("GMT+02:00");
  expect(eventTime("2026-10-25T01:30:00.000Z", "en", "Europe/Warsaw")).toContain("GMT+01:00");
});
test("RSVP requires a nonblank reason only for a decline and omits private input otherwise", () => {
  expect(responseInput("declined", "  ")).toBeUndefined();
  expect(responseInput("declined", " Fictional reason ")).toEqual({
    response: "declined",
    reason: "Fictional reason",
  });
  expect(responseInput("participating", "old private text")).toEqual({ response: "participating" });
  expect(responseInput("unanswered", "old private text")).toEqual({ response: "unanswered" });
});
test("uncertain unchanged commands reuse identity; changed input or independent precondition gets a new key", () => {
  const first = commandAttempt("PUT", "/response", { response: "participating" }, '"v1"', null);
  expect(commandAttempt("PUT", "/response", { response: "participating" }, '"v1"', first)).toBe(
    first,
  );
  expect(
    commandAttempt("PUT", "/response", { response: "participating" }, '"v2"', first).key,
  ).not.toBe(first.key);
  expect(
    commandAttempt("PUT", "/response", { response: "unanswered" }, '"v1"', first).key,
  ).not.toBe(first.key);
});
test("transport validates envelopes and keeps stale, unavailable, conflict and throttled states distinct", async () => {
  for (const status of [412, 409, 429, 503, 404]) {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status })));
    await expect(
      eventRead("/public/events", "EnvelopeListEventPublic", new AbortController().signal),
    ).rejects.toMatchObject({ status });
  }
  expect(new EventFailure(412).kind).toBe("conflict");
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: { items: [] }, meta: { requestId: "synthetic" } })),
      ),
  );
  await expect(
    eventRead("/public/events", "EnvelopeListEventPublic", new AbortController().signal),
  ).rejects.toMatchObject({ kind: "unavailable" });
  expect(
    schema("RsvpInput").safeParse({ response: "participating", reason: "not allowed" }).success,
  ).toBe(false);
});
test("event RU and EN key sets match", () => {
  expect(Object.keys(eventTranslations.ru).sort()).toEqual(
    Object.keys(eventTranslations.en).sort(),
  );
});
