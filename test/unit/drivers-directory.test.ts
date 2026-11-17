import { describe, expect, it } from "vitest";
import {
  approvedApplicationsHref,
  invitationCountPath,
  invitationsPath,
} from "../../apps/web/src/features/admin/invitations-model.ts";
import { accessSave } from "../../apps/web/src/features/drivers/access-model.ts";
import { capitalize, membershipParts } from "../../apps/web/src/features/drivers/model.ts";
import { calendarDayDiff, relativeDay } from "../../apps/web/src/features/drivers/relative-day.ts";
import {
  accessHref,
  activeOnlyParams,
  activityView,
  countsPath,
  type DirectoryEntry,
  directoryFailure,
  directoryFilterKey,
  directoryPath,
  driverAccessHref,
  effectiveSort,
  filtersActive,
  headerParts,
  lastTripView,
  levelView,
  parseDirectoryUrl,
  sortParams,
} from "../../apps/web/src/features/drivers/directory-model.ts";
import { DriversFailure } from "../../apps/web/src/features/drivers/transport.ts";
import { driverTranslations } from "../../apps/web/src/features/drivers/translations.ts";
import { alphaId, levelId, profileFixture } from "../e2e/support/drivers-fixtures.ts";

const ets2 = levelId("ets2", "driver_ii");
const ats = levelId("ats", "trainee");
const url = (search: string, canInvite = false) =>
  parseDirectoryUrl(new URLSearchParams(search), canInvite);

describe("directory URL state", () => {
  it("defaults to the In company tab without filters or an explicit sort", () => {
    expect(url("")).toEqual({
      tab: "active",
      search: null,
      role: null,
      ets2Level: null,
      atsLevel: null,
      sort: null,
      order: null,
      state: "active",
      access: null,
    });
  });

  it("reads valid values and ignores invalid ones", () => {
    expect(
      url(
        `tab=active&search=%20%20Echo%20&role=dispatcher&ets2Level=${ets2}&atsLevel=${ats.toUpperCase()}&sort=trips30d&order=asc`,
      ),
    ).toMatchObject({
      search: "Echo",
      role: "dispatcher",
      ets2Level: ets2,
      atsLevel: ats,
      sort: "trips30d",
      order: "asc",
    });
    expect(
      url("tab=bogus&search=%20%20&role=owner&ets2Level=not-a-uuid&sort=rank&order=up"),
    ).toEqual(url(""));
    // An order without a valid sort means nothing.
    expect(url("order=desc").order).toBeNull();
    expect(url("state=bogus").state).toBe("active");
    expect(url("state=expired").state).toBe("expired");
  });

  it("cuts the search to 128 code points", () => {
    const long = "é".repeat(130);
    expect(Array.from(url(`search=${encodeURIComponent(long)}`).search ?? "")).toHaveLength(128);
  });

  it("opens Invited only with applications.manage and keeps role and level filters on In company only", () => {
    expect(url("tab=invited").tab).toBe("active");
    expect(url("tab=invited", true).tab).toBe("invited");
    expect(url("tab=former").tab).toBe("former");
    // Deactivation clears access roles, so Left ignores a role filter like the level filters.
    expect(url(`tab=former&role=driver&ets2Level=${ets2}&atsLevel=${ats}`)).toMatchObject({
      role: null,
      ets2Level: null,
      atsLevel: null,
    });
    expect(url(`tab=invited&role=driver&ets2Level=${ets2}`, true)).toMatchObject({
      role: null,
      ets2Level: null,
    });
    // Without the capability the tab falls back to In company, where role and levels apply.
    expect(url(`tab=invited&role=driver&ets2Level=${ets2}`)).toMatchObject({
      role: "driver",
      ets2Level: ets2,
    });
  });

  it("counts only narrowing filters as active", () => {
    expect(filtersActive(url("sort=nickname"))).toBe(false);
    expect(filtersActive(url("search=a"))).toBe(true);
    expect(filtersActive(url("role=driver"))).toBe(true);
    expect(filtersActive(url(`atsLevel=${ats}`))).toBe(true);
  });
});

describe("effective sort", () => {
  it("uses the tab default, the nickname fallback and an explicit sort", () => {
    expect(effectiveSort("active", url(""), false)).toEqual({
      sort: "distance30d",
      order: "desc",
      implicit: true,
    });
    expect(effectiveSort("former", url("tab=former"), false)).toEqual({
      sort: "lastTrip",
      order: "desc",
      implicit: true,
    });
    for (const tab of ["active", "former"] as const)
      expect(effectiveSort(tab, url(""), true)).toEqual({
        sort: "nickname",
        order: "asc",
        implicit: true,
      });
    expect(effectiveSort("active", url("sort=trips30d"), true)).toEqual({
      sort: "trips30d",
      order: "desc",
      implicit: false,
    });
    expect(effectiveSort("former", url("sort=nickname&order=desc"), false)).toEqual({
      sort: "nickname",
      order: "desc",
      implicit: false,
    });
  });

  it("writes no URL parameters for the implicit default and drops a default order", () => {
    const active = { sort: "distance30d", order: "desc" } as const;
    expect(sortParams({ sort: "distance30d", order: "desc" }, active)).toEqual({
      sort: null,
      order: null,
    });
    expect(sortParams({ sort: "distance30d", order: "asc" }, active)).toEqual({
      sort: "distance30d",
      order: "asc",
    });
    expect(sortParams({ sort: "nickname", order: "asc" }, active)).toEqual({
      sort: "nickname",
      order: null,
    });
    expect(
      sortParams({ sort: "distance30d", order: "desc" }, { sort: "nickname", order: "asc" }),
    ).toEqual({ sort: "distance30d", order: null });
  });
});

describe("directory requests", () => {
  const path = (search: string, activityUnavailable = false, cursor: string | null = null) => {
    const state = url(search, true);
    return directoryPath(state, effectiveSort(state.tab, state, activityUnavailable), cursor);
  };

  it("builds the exact per-tab request and always sends the sort", () => {
    expect(path("")).toBe("/members?limit=25&status=active&sort=distance30d&order=desc");
    expect(path("tab=former")).toBe("/members?limit=25&status=former&sort=lastTrip&order=desc");
    expect(path("", true)).toBe("/members?limit=25&status=active&sort=nickname&order=asc");
    expect(
      path(
        `search=Echo%20Runner&role=driver&ets2Level=${ets2}&atsLevel=${ats}&sort=lastTrip&order=asc`,
        false,
        "signed cursor",
      ),
    ).toBe(
      `/members?limit=25&status=active&search=Echo+Runner&role=driver&ets2Level=${ets2}&atsLevel=${ats}&sort=lastTrip&order=asc&cursor=signed+cursor`,
    );
    // Former never sends role or level parameters, even when the URL still had them.
    expect(path(`tab=former&search=Echo&role=driver&ets2Level=${ets2}`)).toBe(
      "/members?limit=25&status=former&search=Echo&sort=lastTrip&order=desc",
    );
    expect(
      directoryPath(
        { ...url("tab=former"), role: "driver", ets2Level: ets2 },
        effectiveSort("former", url(""), false),
        null,
      ),
    ).toBe("/members?limit=25&status=former&sort=lastTrip&order=desc");
    expect(activeOnlyParams).toEqual(["role", "ets2Level", "atsLevel"]);
    expect(countsPath).toBe("/members?limit=1&sort=nickname");
  });

  it("keys the cursor stack by tab and every parameter except the cursor", () => {
    const key = (search: string, activityUnavailable = false) => {
      const state = url(search, true);
      return directoryFilterKey(state, effectiveSort(state.tab, state, activityUnavailable));
    };
    expect(key("")).toBe("active:limit=25&status=active&sort=distance30d&order=desc");
    expect(key("")).not.toBe(key("tab=former"));
    expect(key("")).not.toBe(key("", true));
    expect(key("")).not.toBe(key("search=a"));
    expect(key("")).not.toBe(key("sort=distance30d&order=asc"));
    expect(key("tab=invited")).not.toBe(key(""));
    expect(key("search=a")).toBe(key("search=%20a%20"));
  });

  it("maps 400/422 to the invalid-filters state and everything else to a retryable error", () => {
    expect(directoryFailure(new DriversFailure("invalid", 422))).toBe("invalid");
    expect(directoryFailure(new DriversFailure("invalid", 400))).toBe("invalid");
    for (const status of [0, 403, 409, 500, 503])
      expect(directoryFailure(new DriversFailure("unavailable", status))).toBe("error");
    expect(directoryFailure(new Error("network"))).toBe("error");
  });

  it("builds the invitation requests and the applications link", () => {
    expect(invitationsPath("active", null)).toBe("/admin/invitations?state=active&limit=25");
    expect(invitationsPath("expired", "next page")).toBe(
      "/admin/invitations?state=expired&limit=25&cursor=next+page",
    );
    expect(invitationCountPath).toBe("/admin/invitations?state=active&limit=1");
    expect(approvedApplicationsHref).toBe("/account/admin/applications?status=approved");
  });
});

describe("directory cells", () => {
  const base: DirectoryEntry = {
    id: alphaId,
    nickname: "  Fictional Busy Driver ",
    formerMember: false,
    roles: ["driver"],
  };
  const level = { id: ets2, name: "Driver II", position: 3 };

  it("keeps unavailable, none and values apart", () => {
    expect(levelView(base, "ets2")).toEqual({ kind: "unavailable" });
    expect(levelView({ ...base, levels: { ets2: null, ats: level } }, "ets2")).toEqual({
      kind: "none",
    });
    expect(levelView({ ...base, levels: { ets2: level, ats: null } }, "ets2")).toEqual({
      kind: "level",
      name: "Driver II",
      position: 3,
    });
    expect(activityView(base)).toEqual({ kind: "unavailable" });
    expect(
      activityView({ ...base, last30Days: { acceptedTrips: 0, actualDistanceM: "0" } }),
    ).toEqual({ kind: "value", trips: 0, distanceM: "0" });
    expect(lastTripView(undefined)).toEqual({ kind: "unavailable" });
    expect(lastTripView(null)).toEqual({ kind: "none" });
    expect(lastTripView("2026-11-13T09:30:00.000Z")).toEqual({
      kind: "date",
      iso: "2026-11-13T09:30:00.000Z",
    });
  });

  it("builds the header parts only from present counters", () => {
    expect(headerParts(undefined)).toBeNull();
    expect(headerParts({ active: 18, former: 4 })).toEqual({ active: 18 });
    expect(headerParts({ active: 18, former: 4, droveLast30Days: 0 })).toEqual({
      active: 18,
      drove: 0,
    });
  });

  it("links Access to the filtered Members page by membership status", () => {
    expect(accessHref(base)).toBe(
      "/account/admin/members?status=active&search=Fictional+Busy+Driver",
    );
    expect(accessHref({ ...base, nickname: "Ω&=?", formerMember: true })).toBe(
      "/account/admin/members?status=inactive&search=%CE%A9%26%3D%3F",
    );
  });
});

describe("profile membership line", () => {
  const en = driverTranslations.en.profile;
  const t = ((key: string, options?: { date?: string }) => {
    const text = en[key.replace("profile.", "") as keyof typeof en];
    return text.replace("{{date}}", options?.date ?? "");
  }) as Parameters<typeof membershipParts>[3];
  const profile = (trips: "on" | "none" | "off", formerMember = false) => {
    const data = profileFixture(alphaId, trips).data;
    return { ...data, member: { ...data.member, formerMember } };
  };

  it("returns the latest join and the last trip parts in the display timezone", () => {
    expect(membershipParts(profile("on"), "en", "UTC", t)).toEqual({
      since: "In the company since 12 Mar 2026",
      lastTrip: { kind: "date", iso: "2026-11-14T16:20:00.000Z" },
    });
    // The join day follows the display timezone too.
    expect(
      membershipParts(
        { ...profile("off"), memberSince: "2026-03-12T20:30:00.000Z" },
        "en",
        "Asia/Tokyo",
        t,
      ).since,
    ).toBe("In the company since 13 Mar 2026");
    expect(membershipParts(profile("none"), "en", "UTC", t)).toEqual({
      since: "In the company since 12 Mar 2026",
      lastTrip: { kind: "none" },
    });
    // Without Trips the last trip is unavailable: no part, never "no trips".
    expect(membershipParts(profile("off"), "en", "UTC", t)).toEqual({
      since: "In the company since 12 Mar 2026",
      lastTrip: null,
    });
    expect(membershipParts(profile("on", true), "en", "UTC", t).since).toBe(
      "Joined the company on 12 Mar 2026",
    );
    const { memberSince: _, ...withoutSince } = profile("none");
    expect(membershipParts(withoutSince, "en", "UTC", t)).toEqual({
      since: null,
      lastTrip: { kind: "none" },
    });
    expect(
      membershipParts({ ...profile("on"), lastAcceptedTripAt: "2026-11-14" }, "en", "UTC", t)
        .lastTrip,
    ).toBeNull();
    expect(capitalize(en.noTrips, "en")).toBe("No accepted trips yet");
    expect(capitalize(driverTranslations.ru.profile.lastTripLabel, "ru")).toBe("Последний рейс");
  });
});

describe("relative last-trip days", () => {
  const at = (iso: string) => Date.parse(iso);
  const text = (iso: string, now: string, locale: "ru" | "en", zone: string) =>
    relativeDay(iso, at(now), locale, zone)?.text;

  it("turns at local midnight of the display timezone, not at UTC midnight", () => {
    const now = "2026-11-15T12:00:00.000Z";
    // 21:30 UTC is already 15 November 00:30 in Moscow (UTC+3), but still 14 November in UTC.
    expect(text("2026-11-14T21:30:00.000Z", now, "ru", "Europe/Moscow")).toBe("сегодня");
    expect(text("2026-11-14T21:30:00.000Z", now, "en", "Europe/Moscow")).toBe("today");
    expect(text("2026-11-14T21:30:00.000Z", now, "en", "UTC")).toBe("yesterday");
    // 20:59 UTC is 23:59 in Moscow: the previous day there.
    expect(text("2026-11-14T20:59:00.000Z", now, "ru", "Europe/Moscow")).toBe("вчера");
    expect(text("2026-11-14T20:59:00.000Z", now, "en", "Europe/Moscow")).toBe("yesterday");
    // Los Angeles (UTC-8) is still on 15 November at 04:00 its time; 07:59 UTC is 23:59 on the 14th.
    expect(text("2026-11-15T08:00:00.000Z", now, "en", "America/Los_Angeles")).toBe("today");
    expect(text("2026-11-15T07:59:00.000Z", now, "en", "America/Los_Angeles")).toBe("yesterday");
    expect(text("2026-11-15T07:59:00.000Z", now, "en", "UTC")).toBe("today");
  });

  it("counts whole calendar days across daylight saving changes", () => {
    // New York leaves DST on 1 November 2026 (a 25-hour day).
    expect(
      calendarDayDiff(
        "2026-10-31T16:00:00.000Z",
        at("2026-11-02T15:00:00.000Z"),
        "America/New_York",
      ),
    ).toBe(2);
    expect(
      // 00:30 EDT to 00:30 EST the next day is 25 hours and one calendar day.
      calendarDayDiff(
        "2026-11-01T04:30:00.000Z",
        at("2026-11-02T05:30:00.000Z"),
        "America/New_York",
      ),
    ).toBe(1);
    // Berlin enters DST on 29 March 2026 (a 23-hour day).
    expect(
      // 23:30 CET to 23:30 CEST the next day is 23 hours and one calendar day.
      calendarDayDiff("2026-03-28T22:30:00.000Z", at("2026-03-29T21:30:00.000Z"), "Europe/Berlin"),
    ).toBe(1);
    expect(
      text("2026-03-28T23:30:00.000Z", "2026-03-29T21:30:00.000Z", "en", "Europe/Berlin"),
    ).toBe("today");
  });

  it("says N days ago up to six days and shows the date from a week on", () => {
    const now = "2026-11-15T12:00:00.000Z";
    expect(text("2026-11-13T09:30:00.000Z", now, "en", "UTC")).toBe("2 days ago");
    expect(text("2026-11-13T09:30:00.000Z", now, "ru", "UTC")).toBe("2 дня назад");
    expect(text("2026-11-12T09:30:00.000Z", now, "ru", "UTC")).toBe("3 дня назад");
    expect(text("2026-11-10T09:30:00.000Z", now, "ru", "UTC")).toBe("5 дней назад");
    expect(text("2026-11-09T00:00:00.000Z", now, "en", "UTC")).toBe("6 days ago");
    expect(text("2026-11-08T23:59:59.000Z", now, "en", "UTC")).toBe("8 Nov 2026");
    expect(text("2026-11-08T23:59:59.000Z", now, "ru", "UTC")).toBe("8 нояб. 2026 г.");
    expect(relativeDay("2026-11-13T09:30:00.000Z", at(now), "en", "UTC")?.absolute).toBe(
      "13 Nov 2026, 09:30",
    );
    expect(relativeDay("2026-11-13T09:30:00.000Z", at(now), "ru", "Europe/Moscow")?.absolute).toBe(
      "13 нояб. 2026 г., 12:30",
    );
  });

  it("reads a future trip as today and rejects malformed values or timezones", () => {
    const now = "2026-11-15T12:00:00.000Z";
    expect(text("2026-11-16T09:00:00.000Z", now, "en", "UTC")).toBe("today");
    expect(text("2026-11-15T23:00:00.000Z", now, "ru", "UTC")).toBe("сегодня");
    for (const bad of ["2026-11-14", "2026-11-14T10:00:00+03:00", "not a date", ""])
      expect(relativeDay(bad, at(now), "en", "UTC")).toBeNull();
    expect(relativeDay("2026-11-14T10:00:00.000Z", at(now), "en", "Mars/Olympus")).toBeNull();
    expect(relativeDay("2026-11-14T10:00:00.000Z", Number.NaN, "en", "UTC")).toBeNull();
  });
});

describe("access panel state and commands", () => {
  const id = "41000000-0000-4000-8000-000000000201";

  it("opens the panel from a valid member UUID on the list tabs only", () => {
    expect(url(`access=${id}`).access).toBe(id);
    expect(url(`access=${id.toUpperCase()}&tab=former`)).toMatchObject({
      tab: "former",
      access: id,
    });
    expect(url(`access=${id}&tab=invited`, true).access).toBeNull();
    for (const bad of ["", "42", `${id}x`, "../admin"])
      expect(url(`access=${bad}`).access).toBeNull();
    // The panel is no filter: opening it keeps the cursor stack of the list.
    const open = url(`access=${id}&sort=trips30d`);
    const closed = url("sort=trips30d");
    expect(directoryFilterKey(open, effectiveSort("active", open, false))).toBe(
      directoryFilterKey(closed, effectiveSort("active", closed, false)),
    );
    expect(filtersActive(open)).toBe(false);
  });

  it("deep-links the profile to the directory panel, on Left for a former member", () => {
    expect(driverAccessHref({ id, formerMember: false })).toBe(`/account/drivers?access=${id}`);
    expect(driverAccessHref({ id, formerMember: true })).toBe(
      `/account/drivers?access=${id}&tab=former`,
    );
    const parsed = url(driverAccessHref({ id, formerMember: true }).split("?")[1] ?? "");
    expect(parsed).toMatchObject({ tab: "former", access: id });
  });

  it("sends exactly one Members page command per save", () => {
    const path = `/admin/members/${id}`;
    expect(accessSave(id, ["driver"], "driver", [], "x")).toEqual({ kind: "none" });
    expect(accessSave(id, ["driver", "dispatcher"], "driver", ["dispatcher"], "x")).toEqual({
      kind: "none",
    });
    expect(accessSave(id, ["driver", "dispatcher"], "trainee", ["dispatcher"], "Promoted")).toEqual(
      {
        kind: "membership",
        path: `${path}/membership`,
        body: { membership: "trainee", reason: "Promoted" },
        change: { from: "driver", to: "trainee" },
      },
    );
    expect(
      accessSave(id, ["driver", "dispatcher"], "driver", ["deputy_director"], "Rotation"),
    ).toEqual({
      kind: "roles",
      path: `${path}/roles`,
      // The server's membership roles as they are, the chosen additional roles, never Director.
      body: { roles: ["driver", "deputy_director"], reason: "Rotation" },
      diff: { added: ["deputy_director"], removed: ["dispatcher"] },
    });
    expect(accessSave(id, ["director", "driver"], "driver", ["dispatcher"], "x")).toMatchObject({
      kind: "roles",
      body: { roles: ["driver", "dispatcher"] },
    });
    // Both groups changed: no combined command exists, so nothing is sent.
    expect(accessSave(id, ["driver"], "trainee", ["dispatcher"], "x")).toEqual({ kind: "both" });
    // Neither or both membership roles: choosing one is a membership change.
    expect(accessSave(id, ["trainee", "driver"], "driver", [], "x")).toMatchObject({
      kind: "membership",
      change: { from: "both", to: "driver" },
    });
    expect(accessSave(id, [], null, [], "x")).toEqual({ kind: "none" });
  });
});
