import { expect, test } from "vitest";
import {
  assertDemoTarget,
  demoDataset,
  demoId,
  demoMembers,
  games,
} from "../../scripts/demo/dataset.ts";

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
