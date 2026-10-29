import { lstat, readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { setTimeout as sleep } from "node:timers/promises";

// Operator-only synthetic HTTP acceptance. Nothing is registered in the normal API/jobs process.
const mode = process.argv[2];
let phase = "configuration";
const actors = [];
let cleanupRequest;
function requireCondition(value) {
  if (!value) throw Error("NOTIFICATIONS_PROBE_DENIED");
}
try {
  requireCondition(
    process.env.VTC_NOTIFICATIONS_PROBE === "synthetic-only" &&
      ["poll", "exercise"].includes(mode) &&
      process.argv.length === 3,
  );
  const path = process.env.NOTIFICATIONS_PROBE_CONFIG;
  requireCondition(path);
  const info = await lstat(path);
  requireCondition(info.isFile() && info.size <= 16384 && (info.mode & 0o077) === 0);
  const config = JSON.parse(await readFile(path, "utf8"));
  const origin = new URL(config.origin);
  requireCondition(
    origin.origin === config.origin &&
      !origin.username &&
      !origin.password &&
      (origin.protocol === "https:" ||
        (origin.protocol === "http:" && origin.hostname === "127.0.0.1")) &&
      config.syntheticOnly === true &&
      Array.isArray(config.actors) &&
      config.actors.length >= 1 &&
      config.actors.length <= 4,
  );
  for (const a of config.actors) {
    requireCondition(
      typeof a.email === "string" &&
        /^[^\s@]+@example\.invalid$/.test(a.email) &&
        typeof a.password === "string" &&
        a.password.length >= 12 &&
        Array.isArray(a.forbiddenCategories),
    );
    actors.push({ ...a, cookies: new Map(), cursor: undefined, token: undefined });
  }
  async function request(a, path, options = {}) {
    const started = performance.now();
    const result = await fetch(`${origin.origin}${path}`, {
      redirect: "error",
      signal: AbortSignal.timeout(5000),
      ...options,
      headers: {
        cookie: [...a.cookies].map(([k, v]) => `${k}=${v}`).join("; "),
        origin: origin.origin,
        ...(a.token ? { "x-csrf-token": a.token } : {}),
        ...(options.body ? { "content-type": "application/json" } : {}),
        ...options.headers,
      },
    });
    for (const value of result.headers.getSetCookie()) {
      const pair = value.split(";", 1)[0],
        split = pair.indexOf("=");
      a.cookies.set(pair.slice(0, split), pair.slice(split + 1));
    }
    requireCondition(result.headers.get("cache-control") === "no-store");
    const body = await result.json();
    return {
      status: result.status,
      headers: result.headers,
      body,
      ms: performance.now() - started,
    };
  }
  cleanupRequest = request;
  phase = "login";
  for (const a of actors) {
    let csrf = await request(a, "/api/v1/auth/csrf");
    requireCondition(csrf.status === 200);
    a.token = csrf.body.data.token;
    const signed = await request(a, "/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: a.email, password: a.password }),
    });
    requireCondition(signed.status === 200);
    csrf = await request(a, "/api/v1/auth/csrf");
    requireCondition(csrf.status === 200);
    a.token = csrf.body.data.token;
  }
  const samples = [],
    seen = new Set(),
    expectedSeen = actors.map(() => false);
  const cycles = mode === "poll" ? 12 : 1;
  for (let cycle = 0; cycle < cycles; cycle++) {
    phase = "poll";
    for (let actorIndex = 0; actorIndex < actors.length; actorIndex++) {
      const a = actors[actorIndex];
      for (let page = 0; page < 100; page++) {
        const result = await request(
          a,
          `/api/v1/notifications?limit=100${a.cursor ? `&cursor=${encodeURIComponent(a.cursor)}` : ""}`,
        );
        requireCondition(result.status === 200);
        const feed = result.body.data;
        requireCondition(typeof feed.nextCursor === "string" && Array.isArray(feed.items));
        for (const item of feed.items) {
          requireCondition(
            !a.forbiddenCategories.includes(item.category) &&
              Object.keys(item.display).sort().join(",") === "actorNickname,eventTitle,game",
          );
          const identity = `${actorIndex}:${item.id}`;
          requireCondition(!seen.has(identity) || cycle === 0);
          seen.add(identity);
          if (
            a.expected?.category === item.category &&
            (!a.expected.subjectId || a.expected.subjectId === item.target?.id)
          ) {
            requireCondition(Number.isFinite(Date.parse(a.expected.occurredAt)));
            expectedSeen[actorIndex] = true;
            samples.push(Date.now() - Date.parse(a.expected.occurredAt));
          }
        }
        a.cursor = feed.nextCursor;
        console.log(
          JSON.stringify({
            event: "notifications_poll_probe",
            actor: actorIndex,
            cycle,
            page,
            count: feed.items.length,
            unread: feed.unreadCount,
            hasMore: feed.hasMore,
            responseMs: Math.round(result.ms),
          }),
        );
        if (!feed.hasMore) break;
        requireCondition(page < 99);
      }
    }
    if (cycle + 1 < cycles) await sleep(30000);
  }
  if (mode === "exercise")
    for (const a of actors) {
      phase = "commands";
      const history = await request(a, "/api/v1/notifications/history?limit=100");
      requireCondition(
        history.status === 200 &&
          history.body.data.items.every((i) => i.liveToastEligible === false),
      );
      const preferences = await request(a, "/api/v1/me/notification-preferences");
      const command = {
        method: "PUT",
        headers: {
          "if-match": preferences.headers.get("etag"),
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify(preferences.body.data),
      };
      const first = await request(a, "/api/v1/me/notification-preferences", command);
      const replay = await request(a, "/api/v1/me/notification-preferences", command);
      requireCondition(
        first.status === 200 &&
          replay.status === 200 &&
          first.headers.get("etag") === replay.headers.get("etag"),
      );
      if (history.body.data.items.length) {
        const read = { method: "POST", headers: { "idempotency-key": crypto.randomUUID() } };
        const path = `/api/v1/notifications/${history.body.data.items[0].id}/read`;
        requireCondition((await request(a, path, read)).status === 200);
        requireCondition((await request(a, path, read)).status === 200);
      }
      const all = {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ throughCursor: a.cursor }),
      };
      requireCondition((await request(a, "/api/v1/notifications/read-all", all)).status === 200);
      requireCondition((await request(a, "/api/v1/notifications/read-all", all)).status === 200);
    }
  phase = "logout";
  for (const a of actors) {
    requireCondition((await request(a, "/api/v1/auth/logout", { method: "POST" })).status === 200);
    requireCondition((await request(a, "/api/v1/notifications")).status === 401);
    a.cookies.clear();
    a.token = undefined;
    a.cookies.clear();
    a.token = undefined;
  }
  requireCondition(actors.every((a, index) => !a.expected || expectedSeen[index]));
  console.log(
    JSON.stringify({
      event: "notifications_probe_result",
      mode,
      result: "pass",
      observed: samples.length,
      minimumMs: samples.length ? Math.min(...samples) : null,
      maximumMs: samples.length ? Math.max(...samples) : null,
    }),
  );
} catch {
  console.error(
    JSON.stringify({ event: "notifications_probe_result", mode, phase, result: "fail" }),
  );
  process.exitCode = 1;
} finally {
  for (const a of actors) {
    if (a.cookies.size && cleanupRequest) {
      try {
        const csrf = await cleanupRequest(a, "/api/v1/auth/csrf");
        requireCondition(csrf.status === 200);
        a.token = csrf.body.data.token;
        requireCondition(
          (await cleanupRequest(a, "/api/v1/auth/logout", { method: "POST" })).status === 200,
        );
      } catch {
        console.error(JSON.stringify({ event: "notifications_probe_cleanup", result: "fail" }));
        process.exitCode = 1;
      }
    }
    a.cookies.clear();
    a.password = undefined;
    a.token = undefined;
  }
}
