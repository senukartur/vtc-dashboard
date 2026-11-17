import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computePeriodDates } from "../../apps/web/src/features/dashboard/model.ts";
import {
  assignmentFor,
  failureView,
  initial,
  type Level,
  ladderFor,
  monthLabel,
  nextLevel,
  sourceKeys,
  tripsPath,
  twelveMonthWindow,
} from "../../apps/web/src/features/drivers/model.ts";
import { driverTranslations } from "../../apps/web/src/features/drivers/translations.ts";
import { DriversFailure, schema } from "../../apps/web/src/features/drivers/transport.ts";
import {
  alphaId,
  analyticsFixture,
  betaId,
  type DirectoryOptions,
  directoryCounts,
  directoryMembers,
  directoryResponse,
  formerId,
  invitationsFixture,
  levelId,
  levelsFixture,
  profileFixture,
  qualificationsFixture,
  selfId,
  topId,
  tripsFixture,
} from "../e2e/support/drivers-fixtures.ts";

function keys(value: object, prefix = ""): string[] {
  return Object.entries(value)
    .flatMap(([key, item]) =>
      typeof item === "object" ? keys(item, `${prefix}${key}.`) : [`${prefix}${key}`],
    )
    .sort();
}

function entries(value: object, prefix = ""): [string, string][] {
  return Object.entries(value).flatMap(([key, item]) =>
    typeof item === "object"
      ? entries(item, `${prefix}${key}.`)
      : [[`${prefix}${key}`, String(item)] as [string, string]],
  );
}

const placeholders = (text: string) => (text.match(/\{\{\w+\}\}/g) ?? []).sort();
const days = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 86_400_000;

describe("driver profile model", () => {
  describe("rolling twelve-month window in the reporting timezone", () => {
    const at = (instant: string, zone: string) => twelveMonthWindow(new Date(instant), zone);
    const span = (fromDate: string, toDateExclusive: string) => ({ fromDate, toDateExclusive });
    const october2026 = span("2025-11-01", "2026-11-01");
    const november2026 = span("2025-12-01", "2026-12-01");
    const december2026 = span("2026-01-01", "2027-01-01");
    const january2027 = span("2026-02-01", "2027-02-01");

    it("rolls into the next month at local midnight east of UTC", () => {
      expect(at("2026-10-31T20:59:00Z", "Europe/Moscow")).toEqual(october2026);
      expect(at("2026-10-31T21:00:00Z", "Europe/Moscow")).toEqual(november2026);
      // The UTC clock is still in October at the same instants.
      expect(at("2026-10-31T20:59:00Z", "UTC")).toEqual(october2026);
      expect(at("2026-10-31T21:00:00Z", "UTC")).toEqual(october2026);
    });

    it("keeps the month across a local day boundary inside it", () => {
      expect(at("2026-11-15T20:59:00Z", "Europe/Moscow")).toEqual(november2026);
      expect(at("2026-11-15T21:00:00Z", "Europe/Moscow")).toEqual(november2026);
    });

    it("rolls over the year at local midnight east of UTC", () => {
      expect(at("2026-12-31T14:59:00Z", "Asia/Tokyo")).toEqual(december2026);
      expect(at("2026-12-31T15:00:00Z", "Asia/Tokyo")).toEqual(january2027);
    });

    it("stays in the previous month and year west of UTC", () => {
      expect(at("2026-12-01T07:59:00Z", "America/Los_Angeles")).toEqual(november2026);
      expect(at("2026-12-01T07:59:00Z", "UTC")).toEqual(december2026);
      expect(at("2026-12-01T08:00:00Z", "America/Los_Angeles")).toEqual(december2026);
      expect(at("2027-01-01T07:59:59.999Z", "America/Los_Angeles")).toEqual(december2026);
      expect(at("2027-01-01T07:59:59.999Z", "UTC")).toEqual(january2027);
    });

    it("follows daylight saving changes", () => {
      // New York leaves daylight saving time on 1 November 2026 (EDT -4 to EST -5).
      expect(at("2026-11-01T03:59:00Z", "America/New_York")).toEqual(october2026);
      expect(at("2026-11-01T04:00:00Z", "America/New_York")).toEqual(november2026);
      expect(at("2026-11-01T06:30:00Z", "America/New_York")).toEqual(november2026);
      expect(at("2026-12-01T04:30:00Z", "America/New_York")).toEqual(november2026);
      // Berlin is on CET (+1) on 31 October and on CEST (+2) on 31 March.
      expect(at("2026-10-31T22:30:00Z", "Europe/Berlin")).toEqual(october2026);
      expect(at("2026-10-31T23:00:00Z", "Europe/Berlin")).toEqual(november2026);
      expect(at("2026-03-31T21:59:00Z", "Europe/Berlin")).toEqual(span("2025-04-01", "2026-04-01"));
      expect(at("2026-03-31T22:00:00Z", "Europe/Berlin")).toEqual(span("2025-05-01", "2026-05-01"));
    });

    it("handles the extreme offsets", () => {
      expect(at("2026-10-31T09:59:00Z", "Pacific/Kiritimati")).toEqual(october2026);
      expect(at("2026-10-31T10:00:00Z", "Pacific/Kiritimati")).toEqual(november2026);
      expect(at("2026-11-01T10:59:00Z", "Pacific/Pago_Pago")).toEqual(october2026);
      expect(at("2026-11-01T11:00:00Z", "Pacific/Pago_Pago")).toEqual(november2026);
    });

    it("falls back to UTC for a zone unknown to the browser", () => {
      for (const instant of ["2026-10-31T21:00:00Z", "2026-12-31T23:59:59Z"])
        expect(at(instant, "Not/A_Zone")).toEqual(at(instant, "UTC"));
    });

    it("ends with the overview's current month and starts eleven months before it", () => {
      const monthsBefore = (date: string, months: number) => {
        const [year, month] = date.split("-").map(Number) as [number, number];
        return new Date(Date.UTC(year, month - 1 - months, 1)).toISOString().slice(0, 10);
      };
      const cases: [string, string][] = [
        ["2026-10-31T20:59:00Z", "Europe/Moscow"],
        ["2026-10-31T21:00:00Z", "Europe/Moscow"],
        ["2026-12-31T15:00:00Z", "Asia/Tokyo"],
        ["2026-12-01T07:59:00Z", "America/Los_Angeles"],
        ["2027-01-01T07:59:59.999Z", "America/Los_Angeles"],
        ["2026-11-01T06:30:00Z", "America/New_York"],
        ["2026-03-31T22:00:00Z", "Europe/Berlin"],
        ["2026-10-31T10:00:00Z", "Pacific/Kiritimati"],
        ["2026-11-01T10:59:00Z", "Pacific/Pago_Pago"],
        ["2026-10-31T21:00:00Z", "UTC"],
      ];
      for (const [instant, zone] of cases) {
        const now = new Date(instant);
        const month = computePeriodDates("thisMonth", now, zone);
        const window = twelveMonthWindow(now, zone);
        expect(window.toDateExclusive).toBe(month.toDateExclusive);
        expect(window.fromDate).toBe(monthsBefore(month.fromDate, 11));
      }
    });

    it("stays within the 732-day API limit and covers twelve month starts", () => {
      for (const now of ["2024-02-29T10:00:00Z", "2026-07-01T00:00:00Z", "2028-03-31T23:00:00Z"]) {
        const window = twelveMonthWindow(new Date(now), "UTC");
        expect(days(window.fromDate, window.toDateExclusive)).toBeLessThanOrEqual(732);
        expect(window.fromDate.endsWith("-01")).toBe(true);
        const response = analyticsFixture(new URLSearchParams(window));
        expect(response.data.buckets).toHaveLength(12);
        expect(response.data.buckets.at(-1)?.date.slice(0, 7)).toBe(now.slice(0, 7));
      }
    });
  });

  it("formats bucket months with the recorded Node 24 ICU output", () => {
    expect(monthLabel("2026-11-01", "en", "short")).toBe("Nov");
    expect(monthLabel("2026-11-01", "en", "long")).toBe("November 2026");
    expect(monthLabel("2025-12-01", "ru", "short")).toBe("дек.");
    expect(monthLabel("2026-05-01", "ru", "short")).toBe("май");
    expect(monthLabel("2026-11-01", "ru", "long")).toBe("ноябрь 2026 г.");
    expect(monthLabel("not-a-date", "en", "long")).toBe("not-a-date");
  });

  describe("level ladder", () => {
    const all: Level[] = [
      ...levelsFixture("ets2").data.levels,
      ...levelsFixture("ats").data.levels,
    ];

    it("orders one game's levels by position and ignores the other game", () => {
      expect(ladderFor(all, "ets2").map((level) => level.position)).toEqual([1, 2, 3, 4]);
      expect(ladderFor(all, "ats").every((level) => level.game === "ats")).toBe(true);
    });

    it("resolves the next level, the top level and unknown levels", () => {
      const ladder = ladderFor(all, "ets2");
      const next = nextLevel(ladder, levelId("ets2", "driver_ii"));
      expect(next !== "top" && next?.id).toBe(levelId("ets2", "driver_i"));
      expect(nextLevel(ladder, levelId("ets2", "trainee"))).toMatchObject({
        id: levelId("ets2", "driver_iii"),
      });
      expect(nextLevel(ladder, levelId("ets2", "driver_i"))).toBe("top");
      expect(nextLevel(ladder, levelId("ats", "driver_ii"))).toBeNull();
      expect(nextLevel([], levelId("ets2", "trainee"))).toBeNull();
    });

    it("finds the assignment per game", () => {
      const profile = profileFixture(alphaId).data;
      expect(assignmentFor(profile, "ats")?.levelId).toBe(levelId("ats", "driver_iii"));
      expect(assignmentFor(profileFixture(formerId).data, "ets2")).toBeNull();
    });
  });

  describe("trip requests", () => {
    it("uses one completion-ordered page and restricts company history to the requested driver", () => {
      expect(tripsPath(selfId, { isSelf: true })).toBe(
        "/trips?scope=mine&decision=accepted&limit=10&order=completion_desc",
      );
      expect(tripsPath(selfId, { isSelf: true, game: "ats" })).toBe(
        "/trips?scope=mine&decision=accepted&game=ats&limit=10&order=completion_desc",
      );
      expect(tripsPath(alphaId, { isSelf: false })).toBe(
        `/trips?scope=company&ownerId=${alphaId}&limit=10&order=completion_desc`,
      );
      expect(tripsPath(alphaId, { isSelf: false, game: "ets2" })).toBe(
        `/trips?scope=company&ownerId=${alphaId}&game=ets2&limit=10&order=completion_desc`,
      );
      // Labels follow the interface language, not the saved account language.
      expect(tripsPath(alphaId, { isSelf: false, locale: "ru" })).toBe(
        `/trips?scope=company&ownerId=${alphaId}&limit=10&order=completion_desc&locale=ru`,
      );
    });

    it("names the sources and falls back to unknown", () => {
      expect(sourceKeys(["ets2telemetry", "manual"])).toEqual(["ets2telemetry", "manual"]);
      expect(sourceKeys(["manual", "manual"])).toEqual(["manual"]);
      expect(sourceKeys([])).toEqual(["unknown"]);
    });
  });

  it("maps failures to page states", () => {
    for (const status of [400, 404, 422])
      expect(failureView(new DriversFailure("unavailable", status))).toBe("notFound");
    expect(failureView(new DriversFailure("forbidden", 403))).toBe("forbidden");
    expect(failureView(new DriversFailure("conflict", 409))).toBe("setup");
    expect(failureView(new DriversFailure("unavailable", 503))).toBe("error");
    // Timeouts and unparseable responses carry no status.
    expect(failureView(new DriversFailure("unavailable"))).toBe("error");
    expect(failureView(new DriversFailure("uncertain", 500))).toBe("error");
    expect(failureView(new Error("network"))).toBe("error");
  });

  it("takes the first user-perceived character of the nickname", () => {
    expect(initial("ёжик")).toBe("Ё");
    expect(initial("  alpha")).toBe("A");
    expect(initial("👩‍🚀Pilot")).toBe("👩‍🚀");
    expect(initial("   ")).toBe("?");
  });
});

describe("driver profile translations", () => {
  const { en, ru } = driverTranslations;

  it("keeps identical RU and EN keys and placeholders without plurals", () => {
    expect(keys(en)).toEqual(keys(ru));
    const russian = new Map(entries(ru));
    for (const [key, value] of entries(en)) {
      expect(placeholders(value), key).toEqual(placeholders(russian.get(key) ?? ""));
      expect(value).not.toContain("{{count}}");
    }
  });

  it("contains no empty values and no mockup-only slogan", () => {
    for (const [, value] of [...entries(en), ...entries(ru)]) {
      expect(value.trim()).not.toBe("");
      expect(value).not.toMatch(/Достаточно суров|Yukon\?/);
    }
  });

  it("drops the replaced profile keys", () => {
    const present = keys(en);
    for (const key of [
      "privacyNotice",
      "statsTitle",
      "totalDistance",
      "chartTitle",
      "tripsTitle",
      "tripsHelp",
      "viewTrip",
      "detailsCol",
      "dateCol",
      "gameCol",
      "unitKm",
      "level",
      "progress",
      "memberSince",
      "status",
      "eligible",
    ])
      expect(present).not.toContain(`profile.${key}`);
    expect(present).toContain("states.forbidden");
    expect(present).toContain("qualification.notConfigured");
    // The client-side directory and the trips-card lifetime line are gone (VTC-145).
    for (const key of [
      "directory.subtitle",
      "directory.searchPlaceholder",
      "directory.totalMembers",
      "directory.activeMember",
      "directory.formerMember",
      "directory.loadMore",
      "trips.lifetime",
    ])
      expect(present).not.toContain(key);
  });
});

describe("driver profile fixtures match the browser contract", () => {
  const parses = (name: Parameters<typeof schema>[0], value: unknown) =>
    schema(name).safeParse(value).success;

  it("parses every builder with its envelope schema", () => {
    for (const id of [selfId, alphaId, betaId, formerId, topId])
      for (const trips of ["on", "none", "off"] as const)
        expect(parses("EnvelopeMemberProfile", profileFixture(id, trips))).toBe(true);
    for (const game of ["ets2", "ats"] as const)
      expect(parses("EnvelopeQualificationLevelList", levelsFixture(game))).toBe(true);
    for (const search of ["", "game=ats", "game=ets2"])
      expect(parses("EnvelopeAnalytics", analyticsFixture(new URLSearchParams(search)))).toBe(true);
    expect(
      parses("EnvelopeAnalytics", analyticsFixture(new URLSearchParams(), { empty: true })),
    ).toBe(true);
    for (const search of ["scope=company", "scope=mine", "scope=company&game=ats"])
      for (const bulk of [false, true])
        expect(
          parses(
            "EnvelopeListTripSummary",
            tripsFixture(new URLSearchParams(search), { nextCursor: true, bulk }),
          ),
        ).toBe(true);
  });

  it("serves public qualifications for assigned games only", () => {
    for (const id of [alphaId, selfId, topId, formerId]) {
      const fixture = qualificationsFixture(id);
      expect(parses("EnvelopeMyQualificationList", fixture)).toBe(true);
      expect(fixture.data.items.every((item) => item.level !== null)).toBe(true);
    }
    expect(
      qualificationsFixture(alphaId)
        .data.items.map((item) => item.game)
        .sort(),
    ).toEqual(["ats", "ets2"]);
  });

  it("keeps fixtures free of private account data", () => {
    const serialized = JSON.stringify([
      profileFixture(alphaId),
      tripsFixture(new URLSearchParams("scope=company")),
      qualificationsFixture(alphaId),
    ]);
    for (const secret of ["@example.invalid", "email", "password", "token", "evidence"])
      expect(serialized).not.toContain(secret);
  });
});

describe("drivers directory fixtures match the live Stage 4 contract", () => {
  const parses = (name: Parameters<typeof schema>[0], value: unknown) =>
    schema(name).safeParse(value).success;
  type Example = { id: string; status: number; response: unknown };
  const examples = (
    JSON.parse(
      readFileSync(
        new URL("../../docs/contracts/dashboard/examples.json", import.meta.url),
        "utf8",
      ),
    ) as { cases: Example[] }
  ).cases;
  const example = (id: string) => {
    const found = examples.find((item) => item.id === id);
    if (!found) throw new Error(`MISSING_EXAMPLE ${id}`);
    return found.response as Record<string, unknown>;
  };
  /** Key paths of an object; arrays contribute the union of their elements' key paths. */
  function shape(value: unknown, prefix = ""): string[] {
    if (Array.isArray(value))
      return [...new Set(value.flatMap((item) => shape(item, `${prefix}[].`)))].sort();
    if (value === null || typeof value !== "object") return [];
    return Object.entries(value)
      .flatMap(([key, item]) => [`${prefix}${key}`, ...shape(item, `${prefix}${key}.`)])
      .sort();
  }
  const body = (search: string, options: DirectoryOptions = {}) => {
    const result = directoryResponse(new URLSearchParams(search), options);
    if (result.status !== 200) throw new Error(`UNEXPECTED_${result.status}`);
    return result.body;
  };
  /**
   * Data key paths without meta and the pre-Stage-4 assignment rows; the two games' level objects
   * collapse into one, so a page whose ATS levels are all null still states the level shape.
   */
  const withoutMeta = (paths: string[]) =>
    [
      ...new Set(
        paths
          .filter((path) => !path.startsWith("meta") && !path.startsWith("data.qualifications."))
          .map((path) => path.replace(/\.levels\.(?:ets2|ats)\./, ".levels.*.")),
      ),
    ].sort();

  it("parses every directory variant with MemberStage4DirectoryListEnvelope", () => {
    for (const options of [
      {},
      { tripsOff: true },
      { qualificationsOff: true },
      { tripsOff: true, qualificationsOff: true },
      { empty: true },
    ])
      for (const search of [
        "limit=25&status=active&sort=nickname&order=asc",
        "limit=25&status=former&sort=nickname",
        "limit=1&sort=nickname",
      ])
        expect(
          parses("MemberStage4DirectoryListEnvelope", body(search, options)),
          `${search} ${JSON.stringify(options)}`,
        ).toBe(true);
    for (const state of ["active", "expired"])
      for (const limit of ["1", "25"])
        expect(
          parses(
            "InvitationStage4ListEnvelope",
            invitationsFixture(new URLSearchParams({ state, limit })),
          ),
        ).toBe(true);
  });

  it("keeps the list and row key sets of the matching examples.json cases", () => {
    // A stub that keeps an older shape fails here instead of rendering as data (PR #199).
    const active = body("limit=25&status=active&sort=distance30d");
    const former = body("limit=25&status=former&sort=lastTrip");
    const tripsOff = body("limit=25&status=active&sort=nickname", { tripsOff: true });
    const qualificationsOff = body("limit=25&status=active&sort=distance30d", {
      qualificationsOff: true,
    });
    expect(withoutMeta(shape(active))).toEqual(
      withoutMeta(shape(example("listMembers:stage-4-active-tab"))),
    );
    expect(withoutMeta(shape(former))).toEqual(
      withoutMeta(shape(example("listMembers:stage-4-former-tab"))),
    );
    expect(withoutMeta(shape(tripsOff))).toEqual(
      withoutMeta(shape(example("listMembers:stage-4-without-trips"))),
    );
    // No example lacks Qualifications: the active case minus every `levels` path.
    expect(withoutMeta(shape(qualificationsOff))).toEqual(
      withoutMeta(shape(example("listMembers:stage-4-active-tab"))).filter(
        (path) => !path.includes(".levels"),
      ),
    );
    expect(withoutMeta(shape(invitationsFixture(new URLSearchParams("state=active"))))).toEqual(
      withoutMeta(shape(example("listInvitations:stage-4-active"))),
    );
    expect(withoutMeta(shape(profileFixture(alphaId)))).toEqual(
      withoutMeta(shape(example("getMember:stage-4-returned-member"))),
    );
    expect(withoutMeta(shape(profileFixture(alphaId, "none")))).toEqual(
      withoutMeta(shape(example("getMember:stage-4-no-accepted-trip"))),
    );
  });

  it("serves company-wide counters, filter-bound cursors and the server's validation", () => {
    const counts = directoryCounts();
    expect(counts).toEqual({
      active: directoryMembers.active.length,
      former: directoryMembers.former.length,
      droveLast30Days: directoryMembers.active.filter((item) => item.trips > 0).length,
    });
    expect([counts.active, counts.former]).toEqual([18, 4]);
    const filtered = body("limit=25&status=active&search=hauler&sort=nickname");
    expect(filtered.data.items.map((item) => item.nickname)).toEqual([
      "AlphaHauler",
      "MikeHauler",
      "Romeo Long Distance Hauler of the Northern Routes",
    ]);
    expect(filtered.data.statusCounts).toEqual(counts);
    const first = body("limit=10&status=active&sort=distance30d&order=desc");
    expect(first.data.items).toHaveLength(10);
    const distances = first.data.items.map((item) => Number(item.last30Days?.actualDistanceM));
    expect(distances).toEqual([...distances].sort((a, b) => b - a));
    const cursor = first.data.nextCursor ?? "";
    const second = body(
      `limit=10&status=active&sort=distance30d&order=desc&cursor=${encodeURIComponent(cursor)}`,
    );
    expect(second.data.items).toHaveLength(8);
    expect(second.data.nextCursor).toBeNull();
    const other = directoryResponse(
      new URLSearchParams({ limit: "10", status: "active", sort: "trips30d", cursor }),
    );
    expect(other.status).toBe(409);
    // Members without an accepted trip sort last in both directions.
    for (const order of ["asc", "desc"]) {
      const items = body(`limit=25&status=active&sort=lastTrip&order=${order}`).data.items;
      expect(items.slice(-2).map((item) => item.lastAcceptedTripAt)).toEqual([null, null]);
    }
    for (const search of [
      "sort=distance30d&status=active",
      `ets2Level=${levelId("ets2", "trainee")}&sort=nickname`,
    ])
      expect(
        directoryResponse(new URLSearchParams(search), { tripsOff: true, qualificationsOff: true })
          .status,
      ).toBe(422);
    for (const search of ["order=asc", "search=%20", "status=left", "ets2Level=bogus"])
      expect(directoryResponse(new URLSearchParams(search)).status).toBe(422);
    expect(
      body(`limit=25&status=former&ets2Level=${levelId("ets2", "driver_ii")}&sort=nickname`).data
        .items,
    ).toEqual([]);
  });

  it("keeps the directory and invitation fixtures free of links and tokens", () => {
    const serialized = JSON.stringify([
      body("limit=25&status=active&sort=nickname"),
      invitationsFixture(new URLSearchParams("state=active")),
      invitationsFixture(new URLSearchParams("state=expired")),
    ]);
    for (const secret of ["token", "link", "secret", "password", "http"])
      expect(serialized.toLowerCase()).not.toContain(secret);
  });
});
