import { describe, expect, test } from "vitest";
import { createSchemaValidator } from "../../apps/api/src/platform/http/schemas.ts";

const valid = (name: string) =>
  createSchemaValidator().compile({ $ref: `urn:vtc:browser:v1#/$defs/${name}` });
const stats = valid("CompanyStatsPublic");
const envelope = valid("EnvelopeCompanyStatsPublic");

const available = {
  status: "available",
  month: "2026-10",
  reportingTimezone: "Europe/Moscow",
  fromDate: "2026-10-01",
  toDateExclusive: "2026-11-01",
  acceptedTrips: 3,
  actualDistanceM: "412500.5",
  games: ["ets2", "ats"],
};
const body = (currentMonth: unknown, extra: Record<string, unknown> = {}) => ({
  computedAt: "2026-10-17T12:00:00.000Z",
  activeMembers: 12,
  currentMonth,
  ...extra,
});

describe("public company statistics contract (VTC-052)", () => {
  test("accepts available, real-zero and unavailable months", () => {
    expect(stats(body(available))).toBe(true);
    expect(stats(body({ ...available, acceptedTrips: 0, actualDistanceM: "0", games: [] }))).toBe(
      true,
    );
    expect(stats(body({ ...available, games: ["ats"] }))).toBe(true);
    expect(
      stats(
        body({ status: "unavailable", reason: "company_reporting_timezone" }, { activeMembers: 0 }),
      ),
    ).toBe(true);
    expect(envelope({ data: body(available), meta: { requestId: "synthetic-request-001" } })).toBe(
      true,
    );
  });

  test("an available month requires every figure; unavailable carries none", () => {
    for (const field of Object.keys(available)) {
      const missing = { ...available } as Record<string, unknown>;
      delete missing[field];
      expect(stats(body(missing)), field).toBe(false);
    }
    expect(stats(body({ ...available, acceptedTrips: null }))).toBe(false);
    expect(stats(body({ ...available, actualDistanceM: null }))).toBe(false);
    for (const field of ["acceptedTrips", "actualDistanceM", "games", "month"])
      expect(
        stats(
          body({
            status: "unavailable",
            reason: "company_reporting_timezone",
            [field]: (available as Record<string, unknown>)[field],
          }),
        ),
        field,
      ).toBe(false);
    expect(stats(body({ status: "unavailable", reason: "projection_pending" }))).toBe(false);
    expect(stats(body({ status: "unavailable" }))).toBe(false);
    expect(stats(body({ ...available, status: "pending" }))).toBe(false);
    expect(stats(body(null))).toBe(false);
  });

  test("decimal, month, game and count values stay canonical and bounded", () => {
    for (const actualDistanceM of ["1.50", "-1", "01", "1.", ".5", "1e3", "", "0.0"])
      expect(stats(body({ ...available, actualDistanceM })), actualDistanceM).toBe(false);
    expect(stats(body({ ...available, actualDistanceM: "1".repeat(65) }))).toBe(false);
    expect(stats(body({ ...available, actualDistanceM: 412500.5 }))).toBe(false);
    for (const month of ["2026-13", "2026-00", "2026-1", "26-10", "2026-10-01"])
      expect(stats(body({ ...available, month })), month).toBe(false);
    for (const games of [["ets2", "ets2"], ["ets2", "ats", "ats"], ["eut2"], ["ETS2"]])
      expect(stats(body({ ...available, games })), games.join()).toBe(false);
    expect(stats(body({ ...available, acceptedTrips: -1 }))).toBe(false);
    expect(stats(body({ ...available, acceptedTrips: 1.5 }))).toBe(false);
    expect(stats(body(available, { activeMembers: -1 }))).toBe(false);
    expect(stats(body(available, { activeMembers: "12" }))).toBe(false);
    expect(stats(body(available, { computedAt: "2026-10-17T12:00:00Z" }))).toBe(false);
    expect(stats(body({ ...available, reportingTimezone: "" }))).toBe(false);
    expect(stats(body({ ...available, reportingTimezone: "x".repeat(129) }))).toBe(false);
  });

  test("private and per-driver fields are rejected at both levels", () => {
    for (const field of ["ownerId", "members", "leaderboard", "projectionPending"]) {
      expect(stats(body(available, { [field]: "fictional" })), `top-level ${field}`).toBe(false);
      expect(stats(body({ ...available, [field]: "fictional" })), `currentMonth ${field}`).toBe(
        false,
      );
      expect(
        stats(
          body({
            status: "unavailable",
            reason: "company_reporting_timezone",
            [field]: "fictional",
          }),
        ),
        `unavailable ${field}`,
      ).toBe(false);
    }
    expect(
      envelope({
        data: body(available),
        meta: { requestId: "synthetic-request-001" },
        members: [],
      }),
    ).toBe(false);
  });
});
