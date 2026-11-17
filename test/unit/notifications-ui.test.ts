import { afterEach, expect, test, vi } from "vitest";
import { capabilities, type Role } from "../../apps/api/src/modules/identity/permissions.ts";
import { preferenceKeys } from "../../apps/api/src/modules/notifications/policy.ts";
import { claimToast } from "../../apps/web/src/features/notifications/claims.ts";
import {
  notificationFeed,
  notificationFixture,
  notificationId,
  notificationPreferences,
  notificationPreferencesFor,
} from "../../apps/web/src/features/notifications/fixtures.ts";
import {
  badgeText,
  commandAttempt,
  dayGroup,
  groupByDay,
  messageName,
  messages,
  notificationTarget,
  notificationVisual,
  observeFeed,
  notificationAccountPath,
  groupDetails,
  groupState,
  groupWrite,
  preferenceGroups,
  visibleGroups,
} from "../../apps/web/src/features/notifications/model.ts";
import { notificationTranslations } from "../../apps/web/src/features/notifications/translations.ts";
import {
  notificationCommand,
  notificationRead,
  pollPage,
} from "../../apps/web/src/features/notifications/transport.ts";
import { schema } from "../../apps/web/src/features/dashboard/transport.ts";
import { safeBrowserFailure } from "../../scripts/browser-diagnostics.mjs";
const envelope = (data: unknown) => ({ data, meta: { requestId: "synthetic-notifications" } });
afterEach(() => vi.unstubAllGlobals());
test("notification fixtures use reviewed DTOs and mirror the server preference keys per capability", () => {
  expect(
    schema("EnvelopeNotificationFeed").safeParse(
      envelope(notificationFeed([notificationFixture()])),
    ).success,
  ).toBe(true);
  expect(
    schema("EnvelopeNotificationPreferences").safeParse(envelope(notificationPreferences)).success,
  ).toBe(true);
  // The default stub is the Stage 4 member read.
  expect(Object.keys(notificationPreferences).sort()).toEqual(
    [...preferenceKeys(capabilities(["driver"]))].sort(),
  );
  for (const roles of [
    ["trainee"],
    ["driver"],
    ["dispatcher"],
    ["deputy_director"],
    ["director"],
  ] as Role[][]) {
    const granted = capabilities(roles),
      read = notificationPreferencesFor(granted);
    expect(Object.keys(read), roles.join()).toEqual(preferenceKeys(granted));
    expect(schema("EnvelopeNotificationPreferences").safeParse(envelope(read)).success).toBe(true);
  }
  expect(Object.keys(notificationPreferencesFor(capabilities(["dispatcher"])))).toContain(
    "reviewQueue",
  );
  expect(Object.keys(notificationPreferencesFor(capabilities(["dispatcher"])))).not.toContain(
    "newApplications",
  );
  expect(Object.keys(notificationPreferencesFor(capabilities(["deputy_director"])))).toHaveLength(
    10,
  );
  // An undeclared key makes the strict generated schema reject the read instead of hiding it.
  expect(
    schema("EnvelopeNotificationPreferences").safeParse(
      envelope({ ...notificationPreferences, pushAlerts: true }),
    ).success,
  ).toBe(false);
});
const rows = (data: Parameters<typeof visibleGroups>[0]) =>
  visibleGroups(data).map((group) => [group.id, group.keys]);
test("rows group every contract preference exactly once in the P14 order", () => {
  expect(preferenceGroups.map((group) => [group.id, [...group.keys]])).toEqual([
    ["tripDecision", ["tripAccepted", "tripRejected"]],
    ["companyTrips", ["tripStarted", "tripFinished"]],
    ["events", ["newEvent", "eventReminders", "eventChanges"]],
    ["level", ["qualificationChanges"]],
    ["reviewQueue", ["reviewQueue"]],
    ["applications", ["newApplications"]],
  ]);
  const grouped = preferenceGroups.flatMap((group) => [...group.keys]);
  expect(grouped).toHaveLength(10);
  expect(new Set(grouped).size).toBe(10);
  expect([...grouped].sort()).toEqual([...preferenceKeys(capabilities(["director"]))].sort());
  expect(preferenceGroups.filter((group) => "audience" in group).map((group) => group.id)).toEqual([
    "reviewQueue",
    "applications",
  ]);
});
test("a row renders only when the read returned one of its keys and controls only those", () => {
  const count = (roles: Role[]) =>
    visibleGroups(notificationPreferencesFor(capabilities(roles))).map((group) => group.id);
  for (const roles of [["trainee"], ["driver"]] as Role[][])
    expect(count(roles), roles.join()).toEqual(["tripDecision", "companyTrips", "events", "level"]);
  expect(count(["dispatcher"])).toEqual([
    "tripDecision",
    "companyTrips",
    "events",
    "level",
    "reviewQueue",
  ]);
  for (const roles of [["deputy_director"], ["director"]] as Role[][])
    expect(count(roles), roles.join()).toEqual(preferenceGroups.map((group) => group.id));
  expect(rows(notificationPreferencesFor(capabilities(["director"])))).toEqual(
    preferenceGroups.map((group) => [group.id, [...group.keys]]),
  );
  // A pre-Stage 4 read without the optional keys renders four rows with only its own keys.
  const { tripAccepted: _accepted, newEvent: _event, ...six } = notificationPreferences;
  expect(rows(six)).toEqual([
    ["tripDecision", ["tripRejected"]],
    ["companyTrips", ["tripStarted", "tripFinished"]],
    ["events", ["eventReminders", "eventChanges"]],
    ["level", ["qualificationChanges"]],
  ]);
  // False is a returned value, not an absent key.
  expect(rows({ ...six, tripRejected: false })[0]).toEqual(["tripDecision", ["tripRejected"]]);
  expect(rows({ ...six, newEvent: false })).toContainEqual([
    "events",
    ["newEvent", "eventReminders", "eventChanges"],
  ]);
});
test("differing grouped values are mixed and one row change sets exactly the row's returned keys", () => {
  const deputy = notificationPreferencesFor(capabilities(["deputy_director"]));
  const keys = (id: string) => visibleGroups(deputy).find((group) => group.id === id)?.keys ?? [];
  const values = { ...deputy, tripRejected: false, eventChanges: false, newEvent: false };
  expect(groupState(values, keys("tripDecision"))).toBe("mixed");
  expect(groupState(values, keys("events"))).toBe("mixed");
  expect(groupState(values, keys("companyTrips"))).toBe("on");
  expect(
    groupState({ ...values, tripStarted: false, tripFinished: false }, keys("companyTrips")),
  ).toBe("off");
  // A single-key row is never mixed.
  expect(groupState(values, keys("level"))).toBe("on");
  expect(groupState({ ...values, qualificationChanges: false }, keys("level"))).toBe("off");
  const on = groupWrite(values, keys("tripDecision"), true);
  expect(on).toEqual({ ...values, tripAccepted: true, tripRejected: true });
  // Another row's mixed values stay as they are, and the key set is unchanged.
  expect(groupState(on, keys("events"))).toBe("mixed");
  expect(Object.keys(on)).toEqual(Object.keys(values));
  expect(groupWrite(values, keys("events"), false)).toEqual({
    ...values,
    newEvent: false,
    eventReminders: false,
    eventChanges: false,
  });
  expect(values.tripRejected).toBe(false);
  // A key the read did not return is never added, even when the row lists it.
  const { tripAccepted: _accepted, newEvent: _event, ...six } = notificationPreferences;
  const legacy = groupWrite(six, ["tripAccepted", "tripRejected"], false);
  expect(Object.keys(legacy).sort()).toEqual(Object.keys(six).sort());
  expect(legacy.tripRejected).toBe(false);
  expect("tripAccepted" in legacy).toBe(false);
});
test("row details follow what the viewer receives", () => {
  const details = (roles: Role[], id: string) => {
    const granted = capabilities(roles),
      data = notificationPreferencesFor(granted),
      group = visibleGroups(data).find((item) => item.id === id);
    return group ? groupDetails(group, data, granted) : null;
  };
  expect(details(["driver"], "tripDecision")).toEqual(["tripAccepted", "tripRejectedOwn"]);
  expect(details(["dispatcher"], "tripDecision")).toEqual(["tripAccepted", "tripRejected"]);
  expect(details(["driver"], "companyTrips")).toEqual(["tripStarted", "tripFinished"]);
  expect(details(["driver"], "events")).toEqual(["newEvent", "eventReminders", "eventChanges"]);
  expect(details(["dispatcher"], "events")).toEqual(["newEvent", "eventReminders", "eventChanges"]);
  expect(details(["deputy_director"], "events")).toEqual([
    "newEvent",
    "eventReminders",
    "eventChanges",
    "eventChangesAccess",
  ]);
  expect(details(["driver"], "level")).toEqual(["qualificationChanges"]);
  expect(details(["deputy_director"], "level")).toEqual([
    "qualificationChanges",
    "qualificationChangesStaff",
  ]);
  expect(details(["dispatcher"], "reviewQueue")).toEqual(["reviewQueue"]);
  expect(details(["director"], "applications")).toEqual(["newApplications"]);
  expect(details(["driver"], "reviewQueue")).toBeNull();
});
test("row names, details, columns and audience suffixes have RU/EN parity and no removed keys", () => {
  const { en, ru } = notificationTranslations;
  for (const part of ["groups", "details", "audience", "columns"] as const)
    expect(Object.keys(ru[part]).sort(), part).toEqual(Object.keys(en[part]).sort());
  expect(Object.keys(en.groups)).toEqual(preferenceGroups.map((group) => group.id));
  expect(Object.keys(en.audience).sort()).toEqual(
    preferenceGroups
      .filter((group) => "audience" in group)
      .map((group) => group.id)
      .sort(),
  );
  const used = new Set(["mixed"]);
  for (const roles of [["driver"], ["dispatcher"], ["deputy_director"]] as Role[][]) {
    const granted = capabilities(roles),
      data = notificationPreferencesFor(granted);
    for (const group of visibleGroups(data))
      for (const detail of groupDetails(group, data, granted)) used.add(detail);
  }
  expect([...used].sort()).toEqual(Object.keys(en.details).sort());
  for (const locale of [en, ru]) {
    for (const part of [locale.groups, locale.details, locale.audience, locale.columns])
      for (const [key, text] of Object.entries(part)) expect(text, key).toMatch(/\S/);
    expect(locale.rowTip).toContain("{{name}}");
    for (const key of [
      "savedImmediately",
      "toggleHint",
      "how5",
      "aboutTip",
      "preferenceKeysChanged",
      "preferencesLink",
      "retrySave",
    ] as const)
      expect(locale[key]).toMatch(/\S/);
    for (const removed of [
      "save",
      "toggles",
      "tripStarted",
      "eventChanges",
      "qualificationChanges",
    ])
      expect(removed in locale).toBe(false);
  }
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
  expect(messages).toEqual(expect.arrayContaining(["trip.accepted", "event.published"]));
  expect(
    notificationVisual(notificationFixture({ messageKey: "notifications.trip.accepted" })),
  ).toEqual({
    icon: "check",
    tone: "accepted",
    kind: "Trip",
  });
  expect(
    notificationVisual(notificationFixture({ messageKey: "notifications.event.published" })),
  ).toEqual({ icon: "calendar", tone: "info", kind: "Event" });
  for (const message of messages) {
    expect(messageName(notificationFixture({ messageKey: `notifications.${message}` }))).toBe(
      message,
    );
    for (const locale of ["en", "ru"] as const)
      expect(
        (notificationTranslations[locale].messages as Record<string, string>)[message],
        `${locale}:${message}`,
      ).toMatch(/\S/);
  }
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

test("individual read has no body; preferences use PUT with exactly the read keys and strong If-Match", async () => {
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
  expect(Object.keys(JSON.parse(String(requests[3]?.body)))).toEqual(
    Object.keys(notificationPreferences),
  );
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
test("day groups follow the display timezone calendar, not UTC or 24-hour windows", () => {
  const now = Date.parse("2026-10-30T12:00:00.000Z");
  expect(dayGroup("2026-10-30T00:30:00.000Z", now, "UTC")).toBe("today");
  expect(dayGroup("2026-10-29T23:59:00.000Z", now, "UTC")).toBe("yesterday");
  expect(dayGroup("2026-10-29T00:00:00.000Z", now, "UTC")).toBe("yesterday");
  expect(dayGroup("2026-10-28T23:59:00.000Z", now, "UTC")).toBe("earlier");
  // 23:30Z on the 29th is already 00:30 on the 30th in Warsaw (UTC+1 after the DST change).
  expect(dayGroup("2026-10-29T23:30:00.000Z", now, "Europe/Warsaw")).toBe("today");
  expect(dayGroup("2026-10-29T23:30:00.000Z", now, "UTC")).toBe("yesterday");
  // Across the 25 October DST change, "yesterday" is still one calendar day back.
  const afterDst = Date.parse("2026-10-26T06:00:00.000Z");
  expect(dayGroup("2026-10-24T22:30:00.000Z", afterDst, "Europe/Warsaw")).toBe("yesterday");
  expect(dayGroup("2026-10-24T21:30:00.000Z", afterDst, "Europe/Warsaw")).toBe("earlier");
  expect(dayGroup("not-a-date", now, "UTC")).toBe("earlier");
  expect(dayGroup("2026-10-30T11:00:00.000Z", now, "Invalid/Zone")).toBe("today");
});
test("grouping keeps item order inside fixed sections and drops empty sections", () => {
  const now = Date.parse("2026-10-30T12:00:00.000Z");
  const items = [
    { id: "a", occurredAt: "2026-10-30T11:00:00.000Z" },
    { id: "b", occurredAt: "2026-10-30T09:00:00.000Z" },
    { id: "c", occurredAt: "2026-10-20T09:00:00.000Z" },
    { id: "d", occurredAt: "2026-10-19T09:00:00.000Z" },
  ];
  expect(groupByDay(items, now, "UTC")).toEqual([
    { key: "today", items: [items[0], items[1]] },
    { key: "earlier", items: [items[2], items[3]] },
  ]);
  expect(groupByDay([], now, "UTC")).toEqual([]);
});
test("bell badge hides unknown and zero counts, marks failures and caps at 99+", () => {
  expect(badgeText(undefined, false)).toBeNull();
  expect(badgeText(undefined, true)).toBe("?");
  expect(badgeText(0, false)).toBeNull();
  expect(badgeText(7, false)).toBe("7");
  expect(badgeText(99, false)).toBe("99");
  expect(badgeText(100, false)).toBe("99+");
});
test("every registered message has a closed visual; unknown keys fall back to a neutral dot", () => {
  const icons = new Set<string>();
  for (const message of messages) {
    const visual = notificationVisual(
      notificationFixture({ messageKey: `notifications.${message}` }),
    );
    expect(visual.icon).not.toBe("dot");
    expect(["info", "accepted", "rejected", "pending", "neutral"]).toContain(visual.tone);
    expect(visual.kind).not.toBe("Other");
    icons.add(visual.icon);
  }
  expect(icons.size).toBeGreaterThan(8);
  expect(
    notificationVisual(notificationFixture({ messageKey: "notifications.trip.unregistered" })),
  ).toEqual({ icon: "dot", tone: "neutral", kind: "Other" });
  expect(
    notificationVisual(notificationFixture({ messageKey: "notifications.trip.rejected" })),
  ).toEqual({ icon: "cross", tone: "rejected", kind: "Trip" });
});
