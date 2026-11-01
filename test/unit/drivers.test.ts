import { describe, expect, it } from "vitest";
import {
  assignmentFor,
  failureView,
  initial,
  type Level,
  ladderFor,
  monthLabel,
  nextLevel,
  ownTrips,
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
  formerId,
  levelId,
  levelsFixture,
  profileFixture,
  progressFixture,
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
  describe("rolling twelve-month window", () => {
    it("ends with the current UTC month and starts eleven months earlier", () => {
      expect(twelveMonthWindow(new Date("2026-11-15T12:00:00Z"))).toEqual({
        fromDate: "2025-12-01",
        toDateExclusive: "2026-12-01",
      });
    });

    it("rolls over January and December", () => {
      expect(twelveMonthWindow(new Date("2027-01-01T00:00:00Z"))).toEqual({
        fromDate: "2026-02-01",
        toDateExclusive: "2027-02-01",
      });
      expect(twelveMonthWindow(new Date("2026-12-31T23:59:59Z"))).toEqual({
        fromDate: "2026-01-01",
        toDateExclusive: "2027-01-01",
      });
    });

    it("stays within the 732-day API limit and covers twelve month starts", () => {
      for (const now of ["2024-02-29T10:00:00Z", "2026-07-01T00:00:00Z", "2028-03-31T23:00:00Z"]) {
        const window = twelveMonthWindow(new Date(now));
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
    const all: Level[] = [...levelsFixture("ets2").data.items, ...levelsFixture("ats").data.items];

    it("orders one game's levels by code and ignores the other game", () => {
      expect(ladderFor(all, "ets2").map((level) => level.code)).toEqual([
        "trainee",
        "driver_iii",
        "driver_ii",
        "driver_i",
      ]);
      expect(ladderFor(all, "ats").every((level) => level.game === "ats")).toBe(true);
    });

    it("resolves the next level, the top level and unknown levels", () => {
      const ladder = ladderFor(all, "ets2");
      const next = nextLevel(ladder, levelId("ets2", "driver_ii"));
      expect(next !== "top" && next?.code).toBe("driver_i");
      expect(nextLevel(ladder, levelId("ets2", "trainee"))).toMatchObject({ code: "driver_iii" });
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
    it("uses the exact own scope and the bounded company window, never an owner parameter", () => {
      expect(tripsPath({ isSelf: true })).toBe("/trips?scope=mine&decision=accepted&limit=10");
      expect(tripsPath({ isSelf: true, game: "ats" })).toBe(
        "/trips?scope=mine&decision=accepted&limit=10&game=ats",
      );
      expect(tripsPath({ isSelf: false })).toBe("/trips?scope=company&decision=accepted&limit=100");
      expect(tripsPath({ isSelf: false, game: "ets2" })).toBe(
        "/trips?scope=company&decision=accepted&limit=100&game=ets2",
      );
      for (const path of [tripsPath({ isSelf: true }), tripsPath({ isSelf: false })])
        expect(path).not.toMatch(/owner|member/);
    });

    it("keeps only the member's trips in order and caps them at ten", () => {
      const items = tripsFixture(new URLSearchParams("scope=company")).data.items;
      const own = ownTrips(items, alphaId);
      expect(own.map((trip) => trip.owner.id)).toEqual(Array(5).fill(alphaId));
      expect(own.map((trip) => trip.id)).toEqual(
        items.filter((trip) => trip.owner.id === alphaId).map((trip) => trip.id),
      );
      const many = Array.from({ length: 14 }, (_, index) => ({
        ...items[0],
        id: `${index}`,
      })) as typeof items;
      expect(ownTrips(many, alphaId)).toHaveLength(10);
      expect(ownTrips(items, betaId, 1)).toHaveLength(1);
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
    expect(present).toContain("qualification.eligible");
  });
});

describe("driver profile fixtures match the browser contract", () => {
  const parses = (name: Parameters<typeof schema>[0], value: unknown) =>
    schema(name).safeParse(value).success;

  it("parses every builder with its envelope schema", () => {
    for (const id of [selfId, alphaId, betaId, formerId, topId])
      expect(parses("EnvelopeMemberProfile", profileFixture(id))).toBe(true);
    for (const game of ["ets2", "ats"] as const)
      expect(parses("EnvelopeListQualificationLevel", levelsFixture(game))).toBe(true);
    for (const search of ["", "game=ats", "game=ets2"])
      expect(parses("EnvelopeAnalytics", analyticsFixture(new URLSearchParams(search)))).toBe(true);
    expect(
      parses("EnvelopeAnalytics", analyticsFixture(new URLSearchParams(), { empty: true })),
    ).toBe(true);
    for (const search of ["scope=company", "scope=mine", "scope=company&game=ats"])
      expect(
        parses(
          "EnvelopeListTripSummary",
          tripsFixture(new URLSearchParams(search), { nextCursor: true }),
        ),
      ).toBe(true);
  });

  it("serves public progress, which the private progress schema rejects", () => {
    for (const [id, game] of [
      [alphaId, "ets2"],
      [alphaId, "ats"],
      [selfId, "ets2"],
      [topId, "ets2"],
    ] as const) {
      const fixture = progressFixture(id, game);
      expect(parses("EnvelopeProgressPublic", fixture)).toBe(true);
      expect(parses("EnvelopeProgress", fixture)).toBe(false);
    }
    expect(progressFixture(formerId, "ets2")).toBeNull();
  });

  it("keeps fixtures free of private account data", () => {
    const serialized = JSON.stringify([
      profileFixture(alphaId),
      tripsFixture(new URLSearchParams("scope=company")),
      progressFixture(alphaId, "ets2"),
    ]);
    for (const secret of ["@example.invalid", "email", "password", "token", "evidence"])
      expect(serialized).not.toContain(secret);
  });
});
