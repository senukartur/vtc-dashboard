import { createHash } from "node:crypto";

export const games = ["ets2", "ats"] as const;
export const demoEpoch = "2000-01-01T00:00:00.000Z";
export const demoEmail = "demo.director@example.invalid";

// Stable UUIDv4-shaped fixture identities, separate from runtime ID generation.
export function demoId(key: string) {
  const bytes = createHash("sha256").update(`vtc/local-dashboard/v1/${key}`).digest();
  bytes[6] = ((bytes[6] ?? 0) & 15) | 64;
  bytes[8] = ((bytes[8] ?? 0) & 63) | 128;
  const hex = bytes.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const demoMembers = [
  { nickname: "Demo · RoadCaptain", roles: ["driver"], rank: 2 },
  { nickname: "Demo · NorthStar", roles: ["driver", "deputy_director"], rank: 3 },
  { nickname: "Demo · BalticFox", roles: ["driver", "dispatcher"], rank: 1 },
  { nickname: "Demo · DesertOwl", roles: ["driver"], rank: 2 },
  { nickname: "Demo · PolarBear", roles: ["driver"], rank: 1 },
  { nickname: "Demo · CedarWolf", roles: ["driver"], rank: 1 },
  { nickname: "Demo · NewHorizon", roles: ["trainee"], rank: 0 },
  { nickname: "Demo · OldTimer", roles: ["driver"], rank: 1 },
].map((member, index) => ({
  ...member,
  id: demoId(`member/${index}`),
  email: index === 0 ? demoEmail : `demo.driver.${index}@example.invalid`,
  former: index === 7,
  roles: member.roles as ("driver" | "trainee" | "dispatcher" | "deputy_director")[],
}));

export function demoDataset(now: Date) {
  if (!Number.isFinite(now.getTime()) || now.toISOString() <= demoEpoch)
    throw new Error("DEMO_DATE_INVALID");
  const today = now.toISOString().slice(0, 10);
  const midnight = Date.parse(`${today}T00:00:00.000Z`);
  // Full previous month plus current month, including all rolling filters.
  const from = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1);
  const trips = [];
  for (let day = from; day <= midnight; day += 86400000) {
    const date = new Date(day).toISOString().slice(0, 10);
    for (const [gameIndex, game] of games.entries()) {
      for (let slot = 0; slot < 2; slot++) {
        const sequence = Math.floor(day / 86400000) + slot * 5 + gameIndex * 3;
        const memberIndex = sequence % 7;
        const owner = demoMembers[memberIndex];
        if (!owner) throw new Error("DEMO_MEMBER_MISSING");
        // Midnight completion keeps today's fixtures in the past even on month rollover.
        const completedAt = new Date(day);
        const id = demoId(`trip/${date}/${game}/${slot}`);
        trips.push({
          id,
          ownerId: owner.id,
          game,
          decision: "accepted" as const,
          actualDistanceM: String((320 + (sequence % 11) * 87 + gameIndex * 130) * 1000),
          start: new Date(completedAt.getTime() - 3 * 3600000).toISOString(),
          end: completedAt.toISOString(),
        });
      }
    }
  }
  const queue = ["pending_review", "pending_review", "rejected", "unassessed"] as const;
  for (const [index, decision] of queue.entries()) {
    const owner = demoMembers[index + 1];
    if (!owner) throw new Error("DEMO_MEMBER_MISSING");
    trips.push({
      id: demoId(`queue/${index}`),
      ownerId: owner.id,
      game: games[index % 2] ?? "ets2",
      decision,
      actualDistanceM: String((480 + index * 90) * 1000),
      start: new Date(midnight - 5 * 3600000).toISOString(),
      end: new Date(midnight - 2 * 3600000).toISOString(),
    });
  }
  const events = games.map((game, index) => {
    const startsAt = new Date(midnight + (3 + index * 3) * 86400000 + 18 * 3600000);
    return {
      id: demoId(`event/${today}/${game}`),
      game,
      title: game === "ets2" ? "Demo · Baltic Evening Convoy" : "Demo · Pacific Coast Convoy",
      route: game === "ets2" ? "Berlin → Hamburg" : "Seattle → Portland",
      startsAt: startsAt.toISOString(),
      meetingAt: new Date(startsAt.getTime() - 30 * 60000).toISOString(),
      endsAt: new Date(startsAt.getTime() + 2 * 3600000).toISOString(),
    };
  });
  return { trips, events };
}

export function assertDemoTarget(env: NodeJS.ProcessEnv) {
  if (
    env.NODE_ENV !== "development" ||
    !["127.0.0.1", "localhost", "::1", "db"].includes(env.MYSQL_HOST ?? "") ||
    !["vtc_dev", "vtc_demo"].includes(env.MYSQL_DATABASE ?? "")
  )
    throw new Error("DEMO_REQUIRES_LOCAL_DEVELOPMENT_DATABASE");
}
