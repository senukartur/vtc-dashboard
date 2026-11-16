import { describe, expect, it } from "vitest";
import {
  approvedApplicationsHref,
  invitationCountPath,
  invitationsPath,
} from "../../apps/web/src/features/admin/invitations-model.ts";
import { membershipLine } from "../../apps/web/src/features/drivers/model.ts";
import {
  accessHref,
  activityView,
  countsPath,
  type DirectoryEntry,
  directoryFailure,
  directoryFilterKey,
  directoryPath,
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

  it("opens Invited only with applications.manage and never keeps level filters off In company", () => {
    expect(url("tab=invited").tab).toBe("active");
    expect(url("tab=invited", true).tab).toBe("invited");
    expect(url("tab=former").tab).toBe("former");
    expect(url(`tab=former&ets2Level=${ets2}&atsLevel=${ats}`)).toMatchObject({
      ets2Level: null,
      atsLevel: null,
    });
    expect(url(`tab=invited&ets2Level=${ets2}`, true).ets2Level).toBeNull();
    // Without the capability the tab falls back to In company, where levels apply.
    expect(url(`tab=invited&ets2Level=${ets2}`).ets2Level).toBe(ets2);
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
    // Former sends no level parameters even when the URL still had them.
    expect(path(`tab=former&role=driver&ets2Level=${ets2}`)).toBe(
      "/members?limit=25&status=former&role=driver&sort=lastTrip&order=desc",
    );
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
  }) as Parameters<typeof membershipLine>[3];
  const profile = (trips: "on" | "none" | "off", formerMember = false) => {
    const data = profileFixture(alphaId, trips).data;
    return { ...data, member: { ...data.member, formerMember } };
  };

  it("joins the latest join, the last trip and the no-trip state in the display timezone", () => {
    expect(membershipLine(profile("on"), "en", "UTC", t)).toBe(
      "In the company since 12 Mar 2026 · last trip 14 Nov 2026",
    );
    // 16:20 UTC is already the next day east of Tokyo.
    expect(membershipLine(profile("on"), "en", "Asia/Tokyo", t)).toBe(
      "In the company since 12 Mar 2026 · last trip 15 Nov 2026",
    );
    expect(membershipLine(profile("none"), "en", "UTC", t)).toBe(
      "In the company since 12 Mar 2026 · no accepted trips yet",
    );
    expect(membershipLine(profile("off"), "en", "UTC", t)).toBe("In the company since 12 Mar 2026");
    expect(membershipLine(profile("on", true), "en", "UTC", t)).toBe(
      "Joined the company on 12 Mar 2026 · last trip 14 Nov 2026",
    );
    const { memberSince: _, ...withoutSince } = profile("none");
    expect(membershipLine(withoutSince, "en", "UTC", t)).toBe("No accepted trips yet");
    const { memberSince: __, ...bare } = profile("off");
    expect(membershipLine(bare, "en", "UTC", t)).toBeNull();
  });
});
