import { afterEach, expect, test, vi } from "vitest";
import { claimToast } from "../../apps/web/src/features/notifications/claims.ts";
import {
  notificationFeed,
  notificationFixture,
  notificationId,
  notificationPreferences,
} from "../../apps/web/src/features/notifications/fixtures.ts";
import {
  commandAttempt,
  messageName,
  messages,
  notificationTarget,
  observeFeed,
  notificationAccountPath,
  preferenceNames,
} from "../../apps/web/src/features/notifications/model.ts";
import {
  notificationCommand,
  notificationRead,
  pollPage,
} from "../../apps/web/src/features/notifications/transport.ts";
import { schema } from "../../apps/web/src/features/dashboard/transport.ts";
import { safeBrowserFailure } from "../../scripts/browser-diagnostics.mjs";
const envelope = (data: unknown) => ({ data, meta: { requestId: "synthetic-notifications" } });
afterEach(() => vi.unstubAllGlobals());
test("notification fixtures use reviewed DTOs and exactly the existing six preferences", () => {
  expect(
    schema("EnvelopeNotificationFeed").safeParse(
      envelope(notificationFeed([notificationFixture()])),
    ).success,
  ).toBe(true);
  expect(
    schema("EnvelopeNotificationPreferences").safeParse(envelope(notificationPreferences)).success,
  ).toBe(true);
  expect(Object.keys(notificationPreferences).sort()).toEqual([...preferenceNames].sort());
});
test("notification scope matches account routes case-insensitively and excludes lookalike public prefixes", () => {
  for (const path of ["/account", "/account/notifications", "/ACCOUNT/notifications"])
    expect(notificationAccountPath(path)).toBe(true);
  for (const path of ["/accounting", "/en", "/foundation/member", "/events"])
    expect(notificationAccountPath(path)).toBe(false);
});
test("409 cursor invalidation recovers once without a cursor and marks a silent baseline", async () => {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    calls.push(url);
    return calls.length === 1
      ? new Response(null, { status: 409 })
      : Response.json(envelope(notificationFeed()));
  });
  const result = await pollPage("synthetic-invalidated-poll", new AbortController().signal);
  expect(calls).toEqual([
    "/api/v1/notifications?limit=50&cursor=synthetic-invalidated-poll",
    "/api/v1/notifications?limit=50",
  ]);
  expect(result.rebased).toBe(true);
});
test("an invalid fresh baseline never recursively retries and cancelled recovery never starts", async () => {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    calls.push(url);
    return new Response(null, { status: 409 });
  });
  await expect(
    pollPage("synthetic-invalidated-poll", new AbortController().signal),
  ).rejects.toMatchObject({ status: 409 });
  expect(calls).toHaveLength(2);
  calls.length = 0;
  await expect(pollPage(null, new AbortController().signal)).rejects.toMatchObject({ status: 409 });
  expect(calls).toHaveLength(1);
  const controller = new AbortController();
  calls.length = 0;
  vi.stubGlobal("fetch", async (url: string) => {
    calls.push(url);
    controller.abort();
    return new Response(null, { status: 409 });
  });
  await expect(pollPage("synthetic-invalidated-poll", controller.signal)).rejects.toBeTruthy();
  expect(calls).toHaveLength(1);
});
for (const status of [503, 429])
  test(`a rejected cursor is cleared before its recovery ${status} failure`, async () => {
    const calls: string[] = [];
    let cursor: string | null = "synthetic-invalidated-poll";
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(url);
      return new Response(null, {
        status: calls.length === 1 ? 409 : status,
        headers: { "Retry-After": "2" },
      });
    });
    await expect(
      pollPage(cursor, new AbortController().signal, () => {
        cursor = null;
      }),
    ).rejects.toMatchObject({ status, retryAfter: 2 });
    expect(cursor).toBeNull();
    await expect(pollPage(cursor, new AbortController().signal)).rejects.toMatchObject({ status });
    expect(calls).toHaveLength(3);
    expect(calls[2]).toBe("/api/v1/notifications?limit=50");
  });
test("registered messages have closed mappings; unknown wire keys never become translation paths", () => {
  for (const message of messages)
    expect(messageName(notificationFixture({ messageKey: `notifications.${message}` }))).toBe(
      message,
    );
  expect(
    messageName(notificationFixture({ messageKey: "<script>PRIVATE_SENTINEL</script>" })),
  ).toBe("unknown");
});
test("baseline IDs and repeated read/obsolete messages never re-enter the live toast stream", () => {
  const seen = new Set<string>(),
    baseline = notificationFixture(),
    fresh = notificationFixture({ id: "e0370000-0000-4000-8000-000000000002" });
  expect(observeFeed([baseline], seen, true)).toEqual([]);
  expect(observeFeed([baseline, fresh], seen, false)).toEqual([fresh]);
  expect(observeFeed([fresh], seen, false)).toEqual([]);
  expect(
    observeFeed(
      [
        notificationFixture({
          id: "e0370000-0000-4000-8000-000000000003",
          readAt: "2026-10-30T12:00:00.000Z",
        }),
      ],
      seen,
      false,
    ),
  ).toEqual([]);
  for (let i = 0; i < 600; i++)
    observeFeed(
      [
        notificationFixture({
          id: `e0370000-0000-4000-8000-${String(i).padStart(12, "0")}`,
          liveToastEligible: false,
        }),
      ],
      seen,
      false,
    );
  expect(seen.size).toBe(512);
});
test("safe targets use existing workspaces and qualification assignment UUID never becomes member identity", () => {
  const item = notificationFixture();
  for (const [kind, path] of [
    ["trip", `/account/trips/${notificationId}`],
    ["event", `/account/events/${notificationId}`],
    ["application", "/account/admin/applications"],
    ["member", "/account/admin/members"],
    ["qualification", "/account/qualifications?game=ets2"],
  ] as const)
    expect(notificationTarget({ ...item, target: { kind, id: notificationId } })).toBe(path);
  expect(notificationTarget({ ...item, target: null })).toBeNull();
  expect(
    notificationTarget({
      ...item,
      display: { ...item.display, game: null },
      target: { kind: "qualification", id: notificationId },
    }),
  ).toBe("/account/qualifications");
});
test("uncertain command retries preserve identity until input, revision, or expiry changes", () => {
  const first = commandAttempt(
    "/me/notification-preferences",
    notificationPreferences,
    '"v1"',
    null,
    0,
  );
  expect(
    commandAttempt(
      "/me/notification-preferences",
      { ...notificationPreferences },
      '"v1"',
      first,
      1,
    ),
  ).toBe(first);
  expect(
    commandAttempt(
      "/me/notification-preferences",
      { ...notificationPreferences, tripStarted: false },
      '"v1"',
      first,
      1,
    ).key,
  ).not.toBe(first.key);
  expect(
    commandAttempt("/me/notification-preferences", notificationPreferences, '"v2"', first, 1).key,
  ).not.toBe(first.key);
  expect(
    commandAttempt("/me/notification-preferences", notificationPreferences, '"v1"', first, 600000)
      .key,
  ).not.toBe(first.key);
});
test("read-through uncertain identity survives the generic ten-minute expiry", () => {
  const payload = { throughCursor: "synthetic-original-checkpoint" };
  const first = commandAttempt("/notifications/read-all", payload, null, null, 0);
  const retry = commandAttempt("/notifications/read-all", { ...payload }, null, first, 600001);
  expect(retry).toBe(first);
  expect(retry.payload).toEqual(payload);
  expect(retry.key).toBe(first.key);
  expect(commandAttempt("/notifications/read-all", payload, null, null, 600001).key).not.toBe(
    first.key,
  );
});

test("individual read has no body; preferences use PUT, exactly six flags and strong If-Match", async () => {
  const requests: RequestInit[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    requests.push(init);
    return Response.json(
      envelope(
        url.endsWith("/csrf")
          ? { token: "NONFUNCTIONAL_FIXTURE" }
          : init.method === "PUT"
            ? notificationPreferences
            : { id: notificationId, version: 1 },
      ),
      { headers: { ETag: '"v2"' } },
    );
  });
  const readPath = `/notifications/${notificationId}/read`,
    signal = new AbortController().signal;
  await notificationCommand(
    readPath,
    undefined,
    "EnvelopeCommandResult",
    null,
    commandAttempt(readPath, undefined, null, null),
    signal,
  );
  expect(requests[1]?.body).toBeUndefined();
  expect(requests[1]?.method).toBe("POST");
  const path = "/me/notification-preferences";
  await notificationCommand(
    path,
    notificationPreferences,
    "EnvelopeNotificationPreferences",
    '"v1"',
    commandAttempt(path, notificationPreferences, '"v1"', null),
    signal,
  );
  expect(requests[3]?.method).toBe("PUT");
  expect(JSON.parse(String(requests[3]?.body))).toEqual(notificationPreferences);
  expect(new Headers(requests[3]?.headers).get("If-Match")).toBe('"v1"');
});
test("malformed and cancelled decoded reads cannot become accepted feed data", async () => {
  vi.stubGlobal("fetch", async () => Response.json(envelope({ unreadCount: 0 })));
  await expect(
    notificationRead("/notifications", "EnvelopeNotificationFeed", new AbortController().signal),
  ).rejects.toMatchObject({ kind: "unavailable" });
  const ctl = new AbortController();
  vi.stubGlobal("fetch", async () => ({
    status: 200,
    headers: new Headers(),
    json: async () => {
      ctl.abort();
      return envelope(notificationFeed());
    },
  }));
  await expect(
    notificationRead("/notifications", "EnvelopeNotificationFeed", ctl.signal),
  ).rejects.toMatchObject({ kind: "unavailable" });
});
function storage() {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  let tail = Promise.resolve();
  vi.stubGlobal("navigator", {
    locks: {
      request: (_name: string, _options: unknown, action: () => boolean) => {
        const result = tail.then(action);
        tail = result.then(
          () => {},
          () => {},
        );
        return result;
      },
    },
  });
  return values;
}
test("atomic concurrent tab claims emit once and retain only bounded opaque identities", async () => {
  const values = storage();
  expect(
    await Promise.all([
      claimToast(notificationId, () => true),
      claimToast(notificationId, () => true),
    ]),
  ).toEqual([true, false]);
  const serialized = [...values.values()][0] ?? "";
  expect(JSON.parse(serialized)).toEqual([{ id: notificationId, expires: expect.any(Number) }]);
  expect(serialized).not.toMatch(/cursor|Fictional|title|nickname/);
});
test("coordination/storage failure and scope loss fail closed before a toast claim", async () => {
  storage();
  expect(await claimToast(notificationId, () => false)).toBe(false);
  vi.stubGlobal("localStorage", {
    getItem: () => {
      throw Error("DISABLED");
    },
  });
  expect(await claimToast(notificationId, () => true)).toBe(false);
  vi.stubGlobal("navigator", {});
  expect(await claimToast(notificationId, () => true)).toBe(false);
});
test("a scope lost while waiting for the atomic lock cannot claim", async () => {
  storage();
  let action: (() => boolean) | undefined;
  vi.stubGlobal("navigator", {
    locks: {
      request: async (_name: string, _options: unknown, fn: () => boolean) => {
        action = fn;
        await Promise.resolve();
        return fn();
      },
    },
  });
  let current = true;
  const pending = claimToast(notificationId, () => current);
  current = false;
  expect(await pending).toBe(false);
  expect(action).toBeTypeOf("function");
});
test("notification browser failures are accepted only through closed diagnostic spec identities", () => {
  for (const file of ["notifications", "notifications-real"])
    expect(
      safeBrowserFailure({
        kind: "test",
        file,
        project: "desktop-chromium",
        line: 1,
        status: "failed",
      }),
    ).toMatchObject({ file });
});
