import { expect, test } from "vitest";
import {
  assertDemoTarget,
  demoAssignmentEnd,
  demoAssignmentStart,
  demoDataset,
  demoEpoch,
  demoFirstTripStart,
  demoId,
  demoMembers,
  games,
} from "../../apps/api/src/demo-dataset.ts";

test("demo seed is restricted to explicitly local development databases", () => {
  const local = { NODE_ENV: "development", MYSQL_HOST: "127.0.0.1", MYSQL_DATABASE: "vtc_dev" };
  expect(() => assertDemoTarget(local)).not.toThrow();
  for (const override of [
    { NODE_ENV: "production" },
    { NODE_ENV: "test" },
    { MYSQL_HOST: "remote.example.invalid" },
    { MYSQL_DATABASE: "company" },
    { MYSQL_DATABASE: "" },
  ])
    expect(() => assertDemoTarget({ ...local, ...override })).toThrow(
      "DEMO_REQUIRES_LOCAL_DEVELOPMENT_DATABASE",
    );
});

test.each(["2026-10-30T12:00:00.000Z", "2027-01-01T00:00:01.000Z", "2028-03-01T12:00:00.000Z"])(
  "demo dates cover every dashboard period at %s without future trips",
  (instant) => {
    const now = new Date(instant),
      data = demoDataset(now);
    const currentMonth = instant.slice(0, 7);
    const previousMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
      .toISOString()
      .slice(0, 7);
    for (const game of games) {
      for (const month of [currentMonth, previousMonth])
        expect(
          data.trips.some(
            (trip) =>
              trip.game === game && trip.decision === "accepted" && trip.end.startsWith(month),
          ),
        ).toBe(true);
      expect(
        Date.parse(data.events.find((event) => event.game === game)?.startsAt ?? ""),
      ).toBeGreaterThan(now.getTime());
    }
    expect(data.trips.every((trip) => trip.start <= trip.end && trip.end <= instant)).toBe(true);
    expect(new Set(data.trips.map((trip) => trip.id)).size).toBe(data.trips.length);
    expect(data.trips.filter((trip) => trip.decision === "pending_review")).toHaveLength(2);
    expect(demoMembers.every((member) => member.email.endsWith("@example.invalid"))).toBe(true);
    expect(
      data.trips.every((trip) =>
        demoMembers.some((member) => member.id === trip.ownerId && !member.former),
      ),
    ).toBe(true);
  },
);

test("reruns retain immutable trip inputs across days and month rollover", () => {
  const previous = demoDataset(new Date("2026-10-31T12:00:00.000Z"));
  const next = demoDataset(new Date("2026-11-01T12:00:00.000Z"));
  const oldTrips = new Map(
    previous.trips.filter((trip) => trip.decision === "accepted").map((trip) => [trip.id, trip]),
  );
  for (const trip of next.trips) {
    const old = oldTrips.get(trip.id);
    if (old) expect(trip).toEqual(old);
  }
  expect(demoId("member/0")).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
});

test.each(["2026-10-30T12:00:00.000Z", "2027-01-01T00:00:01.000Z", "2026-03-31T23:59:59.000Z"])(
  "demo level admissions precede every demo trip at %s and stay believable",
  (instant) => {
    const now = new Date(instant);
    const data = demoDataset(now);
    const firstStart = data.trips.map((trip) => trip.start).sort()[0] ?? "";
    expect(new Date(demoFirstTripStart(now)).toISOString()).toBe(firstStart);
    const starts = demoMembers.flatMap((member, memberIndex) =>
      games.map((_, gameIndex) => demoAssignmentStart(now, memberIndex, gameIndex, member.rank)),
    );
    for (const start of starts) {
      expect(start).toMatch(/^\d{4}-\d{2}-\d{2}T09:00:00\.000Z$/);
      expect(start < firstStart).toBe(true);
      expect(start < instant).toBe(true);
      expect(start > demoEpoch).toBe(true);
      // At least two weeks and at most about seven months before the first trip.
      const days = (Date.parse(firstStart) - Date.parse(start)) / 86400000;
      expect(days).toBeGreaterThanOrEqual(14);
      expect(days).toBeLessThan(215);
    }
    // Deterministic for the same day, distinct per member and game.
    expect(demoAssignmentStart(new Date(instant), 2, 1, 3)).toBe(demoAssignmentStart(now, 2, 1, 3));
    expect(new Set(starts).size).toBe(starts.length);
    // A higher rank has held a level for longer.
    expect(demoAssignmentStart(now, 0, 0, 3) < demoAssignmentStart(now, 0, 0, 0)).toBe(true);
    // The former member's levels end after they start and before the first trip.
    const formerIndex = demoMembers.findIndex((member) => member.former);
    const former = demoMembers[formerIndex];
    if (!former) throw new Error("DEMO_FORMER_MISSING");
    const end = demoAssignmentEnd(now);
    for (const gameIndex of [0, 1])
      expect(demoAssignmentStart(now, formerIndex, gameIndex, former.rank) < end).toBe(true);
    expect(end < firstStart).toBe(true);
  },
);
