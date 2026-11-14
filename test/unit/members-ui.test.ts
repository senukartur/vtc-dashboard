import { describe, expect, test } from "vitest";
import {
  additionalOf,
  filterParams,
  formatDay,
  lastTrip,
  levelCell,
  listPath,
  memberPanel,
  membershipChange,
  membershipOf,
  normalizeSearch,
  orderedRoles,
  parseFilters,
  type Role,
  reinstatementBody,
  roleDiff,
  rolesBody,
} from "../../apps/web/src/features/admin/members-model.ts";
import { administrationTranslations } from "../../apps/web/src/features/admin/translations.ts";

const levels = [
  { id: "l-ets2-trainee", game: "ets2", position: 1, name: "Trainee" },
  { id: "l-ets2-d3", game: "ets2", position: 2, name: "Driver III" },
  { id: "l-ats-d2", game: "ats", position: 3, name: "Driver II" },
] as const;

describe("membership and roles", () => {
  test("membershipOf distinguishes trainee, driver, none and both", () => {
    expect(membershipOf(["trainee", "dispatcher"])).toBe("trainee");
    expect(membershipOf(["deputy_director", "driver"])).toBe("driver");
    expect(membershipOf(["dispatcher"])).toBe("none");
    expect(membershipOf(["driver", "trainee"])).toBe("both");
  });
  test("orderedRoles and additionalOf use a fixed order", () => {
    expect(
      orderedRoles(["trainee", "dispatcher", "director", "driver", "deputy_director"]),
    ).toEqual(["director", "deputy_director", "dispatcher", "driver", "trainee"]);
    expect(additionalOf(["deputy_director", "driver", "dispatcher"])).toEqual([
      "dispatcher",
      "deputy_director",
    ]);
  });
  test("rolesBody keeps the server membership, never sends Director and has a fixed order", () => {
    expect(rolesBody(["driver"], ["deputy_director", "dispatcher"])).toEqual([
      "driver",
      "dispatcher",
      "deputy_director",
    ]);
    expect(rolesBody(["director", "driver", "dispatcher"], [])).toEqual(["driver"]);
    expect(rolesBody(["driver", "trainee"], ["dispatcher"])).toEqual([
      "trainee",
      "driver",
      "dispatcher",
    ]);
    expect(rolesBody(["dispatcher"], [])).toEqual([]);
  });
  test("roleDiff lists added and removed additional roles only", () => {
    expect(roleDiff(["driver", "dispatcher"], ["deputy_director"])).toEqual({
      added: ["deputy_director"],
      removed: ["dispatcher"],
    });
    expect(roleDiff(["driver", "dispatcher"], ["dispatcher"])).toEqual({ added: [], removed: [] });
  });
  test("membershipChange is null without a real change", () => {
    expect(membershipChange(["driver", "dispatcher"], "driver")).toBeNull();
    expect(membershipChange(["driver"], null)).toBeNull();
    expect(membershipChange(["driver", "dispatcher"], "trainee")).toEqual({
      from: "driver",
      to: "trainee",
    });
    expect(membershipChange(["dispatcher"], "driver")).toEqual({ from: "none", to: "driver" });
    expect(membershipChange(["trainee", "driver"], "driver")).toEqual({
      from: "both",
      to: "driver",
    });
  });
});

describe("memberPanel", () => {
  test("the serving Director is protected: read-only roles and unavailable deactivation", () => {
    expect(memberPanel({ roles: ["director", "driver"], status: "active" })).toEqual({
      protected: true,
      roles: "readonly",
      leave: "disabled",
      restore: false,
    });
  });
  test("an active member is editable and a former member can be restored", () => {
    expect(memberPanel({ roles: ["deputy_director", "driver"], status: "active" })).toEqual({
      protected: false,
      roles: "editable",
      leave: "enabled",
      restore: false,
    });
    expect(memberPanel({ roles: [], status: "inactive" })).toEqual({
      protected: false,
      roles: "hidden",
      leave: "hidden",
      restore: true,
    });
  });
});

describe("filters and list path", () => {
  test("parseFilters defaults to active and ignores unknown values", () => {
    expect(parseFilters(new URLSearchParams())).toEqual({
      status: "active",
      role: null,
      search: null,
      cursor: null,
    });
    expect(
      parseFilters(new URLSearchParams("status=gone&role=director&search=%20%20&cursor=")),
    ).toEqual({ status: "active", role: null, search: null, cursor: null });
    expect(
      parseFilters(
        new URLSearchParams("status=inactive&role=dispatcher&search=%20Kestrel%20&cursor=abc"),
      ),
    ).toEqual({ status: "inactive", role: "dispatcher", search: "Kestrel", cursor: "abc" });
    expect(parseFilters(new URLSearchParams(`search=${"x".repeat(200)}`)).search).toHaveLength(128);
  });
  test("normalizeSearch cuts by code points and never leaves an unpaired surrogate", () => {
    const astral = "\u{1F69A}";
    expect(normalizeSearch(`  ${"a".repeat(127)}${astral}${astral}  `)).toBe(
      `${"a".repeat(127)}${astral}`,
    );
    expect(normalizeSearch(`ab\uD83D`)).toBe("ab");
    expect(normalizeSearch("   ")).toBeNull();
    const parsed = parseFilters(new URLSearchParams({ search: astral.repeat(130) }));
    expect(Array.from(parsed.search ?? "")).toHaveLength(128);
    expect(() => listPath(parsed)).not.toThrow();
  });
  test("listPath keeps status first and encodes the search and cursor", () => {
    expect(listPath({ status: "active", role: null, search: null, cursor: null })).toBe(
      "/admin/members?status=active&limit=25",
    );
    expect(
      listPath({
        status: "inactive",
        role: "deputy_director",
        search: "Вымышленный & 50%",
        cursor: "a+b/c=",
      }),
    ).toBe(
      "/admin/members?status=inactive&limit=25&role=deputy_director&search=%D0%92%D1%8B%D0%BC%D1%8B%D1%88%D0%BB%D0%B5%D0%BD%D0%BD%D1%8B%D0%B9%20%26%2050%25&cursor=a%2Bb%2Fc%3D",
    );
  });
  test("filterParams round-trips through parseFilters", () => {
    const filters = {
      status: "active",
      role: "trainee",
      search: "Frost",
      cursor: "next",
    } as const;
    expect(Object.keys(filterParams(filters))[0]).toBe("status");
    expect(parseFilters(new URLSearchParams(filterParams(filters)))).toEqual(filters);
    expect(filterParams({ status: "inactive", role: null, search: null, cursor: null })).toEqual({
      status: "inactive",
    });
  });
});

describe("cells and dates", () => {
  const assignments = [{ game: "ets2", levelId: "l-ets2-d3" }] as const;
  test("levelCell reports none, loading, unavailable or the level name", () => {
    expect(levelCell(assignments, "ats", levels, false, false)).toBe("none");
    expect(levelCell(assignments, "ets2", undefined, true, false)).toBe("loading");
    expect(levelCell(assignments, "ets2", undefined, false, true)).toBe("unavailable");
    expect(levelCell([{ game: "ets2", levelId: "l-ats-d2" }], "ets2", levels, false, false)).toBe(
      "unavailable",
    );
    expect(levelCell(assignments, "ets2", levels, false, false)).toEqual({
      name: "Driver III",
      position: 2,
    });
  });
  test("lastTrip keeps null distinct from a date", () => {
    expect(lastTrip(null)).toEqual({ kind: "none" });
    expect(lastTrip("2026-10-31T23:30:00.000Z")).toEqual({
      kind: "date",
      iso: "2026-10-31T23:30:00.000Z",
    });
  });
  test("formatDay uses the display timezone and has no time", () => {
    const value = "2026-10-31T23:30:00.000Z";
    expect(formatDay(value, "en", "UTC")).toBe("31 Oct 2026");
    expect(formatDay(value, "en", "Europe/Moscow")).toBe("1 Nov 2026");
    expect(formatDay(value, "ru", "Europe/Moscow")).toMatch(/^1 нояб\. 2026/);
    expect(formatDay("2026-10-31", "en", "UTC")).toBeNull();
    expect(formatDay(value, "en", "Not/A_Zone")).toBeNull();
  });
});

describe("reinstatementBody", () => {
  test("keeps the existing request shape and order", () => {
    const body = reinstatementBody(
      "driver",
      ["deputy_director", "dispatcher"],
      { ets2: "l-ets2-d3", ats: "l-ats-d2" },
      " Fictional return ",
    );
    expect(JSON.stringify(body)).toBe(
      JSON.stringify({
        roles: ["driver", "dispatcher", "deputy_director"],
        assignments: [
          {
            game: "ets2",
            levelId: "l-ets2-d3",
            purpose: "reinstatement",
            reason: " Fictional return ",
          },
          {
            game: "ats",
            levelId: "l-ats-d2",
            purpose: "reinstatement",
            reason: " Fictional return ",
          },
        ],
        reason: " Fictional return ",
      }),
    );
  });
  test("skips games without a selected level", () => {
    expect(reinstatementBody("trainee", [], { ets2: "", ats: "l-ats-d2" }, "r")).toEqual({
      roles: ["trainee"],
      assignments: [{ game: "ats", levelId: "l-ats-d2", purpose: "reinstatement", reason: "r" }],
      reason: "r",
    });
  });
});

describe("members translations", () => {
  const { en, ru } = administrationTranslations;
  test("null last trip wording never claims the member did not drive", () => {
    for (const text of [en.membersUi.noTrips, en.membersUi.noTripsLong])
      expect(text).not.toMatch(/never|not driven|no trips yet/i);
    for (const text of [ru.membersUi.noTrips, ru.membersUi.noTripsLong])
      expect(text).not.toMatch(/никогда|не ездил/i);
  });
  test("strings avoid characters outside the font coverage set", () => {
    const all = JSON.stringify([en.membersUi, ru.membersUi]);
    expect(all).not.toMatch(/[−↺]/);
    expect(all).not.toMatch(/Достаточно суров|Юкон\?/);
  });
  test("role labels cover every role", () => {
    const roles: Role[] = ["director", "deputy_director", "dispatcher", "driver", "trainee"];
    for (const role of roles) {
      expect(en.membersUi.roleShort[role]).toBeTruthy();
      expect(ru.membersUi.roleShort[role]).toBeTruthy();
    }
  });
});
