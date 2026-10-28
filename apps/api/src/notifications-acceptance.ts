import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile, writeFile, lstat } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { createUnitOfWork, newId } from "@vtc/db";
import { sql } from "@vtc/db/platform-schema";
import {
  createQualificationInitialization,
  structuralLevels,
} from "./modules/qualifications/initialization.js";
import { readConfig } from "./platform/config/env.js";
import { composeIdentity } from "./use-cases/identity-messaging.js";
import { createOutbox, type TripEvent } from "./platform/outbox/events.js";
import type { Actor } from "./modules/identity/service.js";
import type { components } from "@vtc/contracts";
import {
  acceptanceDiagnostic,
  acceptanceWorkerScope,
  acceptanceTeardown,
} from "./notifications-acceptance-diagnostics.js";

import {
  acceptanceSourcePayload,
  acceptanceSourceStream,
  type AcceptanceSourceKind,
} from "./notifications-acceptance-sources.js";

type S = components["schemas"];
type FixtureActor = { id: string; email: string; password: string; cookie: string };
type Refs = { actors: FixtureActor[]; events: string[] };
type Message = S["Notification"];
const run = process.env.VTC_NOTIFICATIONS_ACCEPTANCE_RUN ?? "";
const mode = process.argv[2] ?? "";
assert.equal(process.env.VTC_NOTIFICATIONS_ACCEPTANCE, "synthetic-only");
assert.match(run, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
assert.ok(
  ["validate", "seed", "produce", "inspect", "revoke", "exercise", "worker-permissions"].includes(
    mode,
  ),
);
assert.equal(process.argv.length, 3);
const config = readConfig(),
  suffix = run.replaceAll("-", "").slice(0, 16);
assert.equal(config.database.database, `vtc_na_${suffix}`);
assert.equal(config.database.user, `vtc_n${mode === "worker-permissions" ? "w" : "r"}_${suffix}`);
if (mode === "worker-permissions") assert.ok(acceptanceWorkerScope(process.env));
assert.equal(config.environment, "production");
assert.equal(process.env.MAIL_MODE, "disabled");
assert.ok(
  config.identity &&
    config.notifications &&
    config.events &&
    config.catalogs &&
    config.trips &&
    config.qualifications &&
    config.reconciliation &&
    config.tripDecisions &&
    config.manualReports &&
    config.admissions,
);
assert.equal(config.catalogs.production, true);
assert.equal(config.catalogs.synthetic, false);
assert.equal(config.identity.origin, "https://notifications-acceptance.invalid");
const unit = createUnitOfWork(config.database);
const composed = composeIdentity(
  unit,
  config.identity,
  undefined,
  config.admissions,
  false,
  config.catalogs,
  config.trips,
  undefined,
  config.manualReports,
  config.qualifications,
  config.events,
  config.reconciliation,
  config.tripDecisions,
  undefined,
  config.notifications,
);
const { identity } = composed;
const events = composed.events!,
  trips = composed.trips!,
  notifications = composed.notifications!;
const watchdog = setTimeout(() => process.exit(1), mode === "exercise" ? 1_700_000 : 50_000);
const path = (name: string) => `/acceptance/${name}`;
const instant = () => new Date().toISOString();
const streamIdentities = new Map<string, ReturnType<typeof acceptanceSourceStream>>();
async function save(name: string, value: unknown) {
  await writeFile(path(name), JSON.stringify(value), { mode: 0o600 });
}
async function rows<T>(query: ReturnType<typeof sql>) {
  const [result] = await unit.run((tx) => unit.client(tx).execute(query));
  assert.ok(Array.isArray(result));
  return result as T[];
}
async function rejectSqlPermission(statement: ReturnType<typeof sql>) {
  await assert.rejects(
    unit.run(async (tx) => {
      await unit.client(tx).execute(statement);
      // Unexpected permission must still roll back the negative probe's attempted mutation.
      throw new Error("UNEXPECTED_ACCEPTANCE_SQL_PERMISSION");
    }),
    (error) => {
      let cause: unknown = error;
      for (let depth = 0; depth < 5 && cause && typeof cause === "object"; depth++) {
        if ("errno" in cause && [1142, 1143].includes(Number(cause.errno))) return true;
        cause = "cause" in cause ? cause.cause : undefined;
      }
      return false;
    },
  );
}
async function refs(): Promise<Refs> {
  const result = await rows<{ run_id: string; refs: Refs | string | null }>(
    sql`SELECT run_id,refs FROM notification_acceptance WHERE singleton=1`,
  );
  assert.equal(result[0]?.run_id, run);
  const value = result[0]?.refs;
  assert.ok(value);
  return typeof value === "string" ? JSON.parse(value) : value;
}
async function actor(ref: FixtureActor): Promise<Actor> {
  return identity.authenticate(new Headers({ cookie: ref.cookie }));
}
async function member(
  email: string,
  name: string,
  roles: ("driver" | "dispatcher")[],
): Promise<FixtureActor> {
  const id = newId(),
    password = randomBytes(24).toString("base64url"),
    credential = await identity.prepareCredential(password);
  await unit.run(async (tx) => {
    await identity.insertWithCredential(tx, { userId: id, email, name, ...credential, roles });
    await createQualificationInitialization(unit).initialize(tx, {
      userId: id,
      games: ["ets2", "ats"],
      assignedAt: instant(),
    });
  });
  const signed = await identity.login(email, password);
  return { id, email, password, cookie: signed.cookies.map((c) => c.split(";", 1)[0]).join("; ") };
}
async function source(owner: Actor, kind: AcceptanceSourceKind = "fresh", sourceId = newId()) {
  const at = Date.now();
  const stream =
    streamIdentities.get(sourceId) ??
    acceptanceSourceStream(kind, at, {
      installationId: newId(),
      bindingId: newId(),
    });
  streamIdentities.set(sourceId, stream);
  const payload = acceptanceSourcePayload(kind, at, { ...stream, sourceId, eventId: newId() });
  const previousStep = operationStep;
  operationStep = "source_store";
  const result = await unit.run((tx) =>
    trips.storeInTransaction(tx, "ets2telemetry", payload, {
      ownerUserId: owner.userId,
      connection: { state: "unknown", referenceId: null },
    }),
  );
  operationStep = previousStep;
  return {
    id: result.tripId,
    occurredAt: kind === "completed" || kind === "unknown" ? at : stream.startedUtcMs,
    sourceId,
    sourceRecordId: result.sourceRecordId,
  };
}
function eventInput(extra: Partial<S["EventInput"]> = {}): S["EventInput"] {
  return {
    title: "Fictional acceptance convoy",
    description: "Fictional acceptance description",
    game: "ets2",
    server: "Fictional server",
    organizer: "Fictional organizer",
    meetingLocation: "Fictional meeting",
    route: "Fictional route",
    meetingAt: instant(),
    startsAt: new Date(Date.now() + 3600000).toISOString(),
    endsAt: null,
    visibility: "members",
    originCityId: null,
    destinationCityId: null,
    prescribedCargoId: null,
    prescribedMassKg: null,
    prescribedTrailerTypeId: null,
    ...extra,
  };
}
async function event(director: Actor, owner: Actor, input = eventInput()) {
  const result = await events.create(director, newId(), input),
    id = result.data.event.id;
  await events.respond(owner, id, newId(), 1, { response: "participating" });
  return { id, input };
}
async function revoke(f: Refs) {
  const references = [...f.actors];
  try {
    const info = await lstat(path("sessions.json"));
    assert.ok(info.isFile() && (info.mode & 0o077) === 0 && info.size <= 16384);
    const sessions = JSON.parse(await readFile(path("sessions.json"), "utf8")) as {
      id: string;
      cookie: string;
    }[];
    assert.ok(Array.isArray(sessions) && sessions.length <= 4);
    for (const session of sessions) {
      const own = f.actors.find((a) => a.id === session.id);
      assert.ok(own && typeof session.cookie === "string");
      references.push({ ...own, cookie: session.cookie });
    }
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT"))
      throw error;
  }
  for (const ref of references) {
    const headers = new Headers({ cookie: ref.cookie });
    try {
      const current = await identity.authenticate(headers);
      await identity.logout(current, headers);
    } catch (error) {
      if (
        !(error && typeof error === "object" && "statusCode" in error && error.statusCode === 401)
      )
        throw error;
    }
  }
}
let phase = 0;
let operationStep = "allocation";
const evidence: {
  runId: string;
  startedUtc: string;
  scenarios: {
    ordinal: number;
    status: string;
    startedUtc: string;
    finishedUtc: string;
    durationMs: number;
    samplesMs: number[];
  }[];
  status: string;
  failure?: ReturnType<typeof acceptanceDiagnostic> & { ordinal: number };
  teardownFailure?: ReturnType<typeof acceptanceDiagnostic>;
  observations: {
    actorOrdinal: number;
    sourceOccurredUtcMs: number;
    pollArrivalUtcMs: number;
    responseServerUtc: string;
    sourceReceiptUtc: string;
    commitObservation: string;
  }[];
} = { runId: run, startedUtc: instant(), scenarios: [], status: "running", observations: [] };
try {
  const allocation = await rows<{ run_id: string; image_id: string; revision: string }>(
    sql`SELECT run_id,image_id,revision FROM notification_acceptance WHERE singleton=1`,
  );
  assert.equal(allocation[0]?.run_id, run);
  assert.equal(allocation[0]?.image_id, process.env.VTC_NOTIFICATIONS_ACCEPTANCE_IMAGE_ID);
  assert.equal(allocation[0]?.revision, process.env.VTC_NOTIFICATIONS_ACCEPTANCE_REVISION);
  assert.equal(allocation[0]?.revision, process.env.VTC_REVISION);
  if (mode === "worker-permissions") {
    operationStep = "worker_permissions";
    const positive = [
      sql`DELETE FROM catalog_commands WHERE 1=0`,
      sql`UPDATE catalog_operations SET \`state\`=\`state\`,failure_code=failure_code WHERE 1=0`,
      sql`UPDATE catalog_artifacts SET content=content,payload_expires_at=payload_expires_at WHERE 1=0`,
      sql`UPDATE catalog_revisions SET \`state\`=\`state\`,pruned=pruned WHERE 1=0`,
      sql`DELETE FROM catalog_relations WHERE 1=0`,
      sql`DELETE FROM catalog_mappings WHERE 1=0`,
      sql`DELETE FROM catalog_aliases WHERE 1=0`,
      sql`DELETE FROM catalog_facts WHERE 1=0`,
      sql`DELETE FROM catalog_changes WHERE 1=0`,
      sql`DELETE FROM catalog_coverage WHERE 1=0`,
      sql`DELETE FROM catalog_mapping_issues WHERE 1=0`,
    ];
    for (const statement of positive) await unit.run((tx) => unit.client(tx).execute(statement));
    const negative = [
      sql`UPDATE reconciliation_rules SET version=version WHERE 1=0`,
      sql`DELETE FROM reconciliation_rules WHERE 1=0`,
      sql`UPDATE reconciliation_candidates SET evidence=evidence WHERE 1=0`,
      sql`UPDATE trip_facts SET id=id WHERE 1=0`,
      sql`DELETE FROM source_messages WHERE 1=0`,
      sql`UPDATE catalog_publications SET version=version WHERE 1=0`,
      sql`UPDATE catalog_revisions SET complete=complete WHERE 1=0`,
      sql`UPDATE catalog_artifacts SET id=id WHERE 1=0`,
      sql`UPDATE catalog_facts SET id=id WHERE 1=0`,
      sql`UPDATE notification_acceptance SET image_id=image_id WHERE singleton=1`,
      sql`INSERT INTO reconciliation_commands (actor_id,operation,\`key\`,fingerprint,result,created_at) VALUES (${Buffer.from(newId())},'merge',${Buffer.from(newId())},${randomBytes(32)},CAST('{}' AS JSON),UTC_TIMESTAMP(3))`,
      sql`INSERT INTO reconciliation_history (reconciliation_id,version,actor_id,operation,reason,snapshot,created_at) VALUES (${Buffer.from(newId())},1,${Buffer.from(newId())},'apply','Fictional forbidden history write',CAST('{}' AS JSON),UTC_TIMESTAMP(3))`,
    ];
    for (const statement of negative) await rejectSqlPermission(statement);
    console.log(
      JSON.stringify({
        event: "notifications_fixture",
        phase: "worker_permissions",
        result: "pass",
        allowedNoops: positive.length,
        deniedMutations: negative.length,
      }),
    );
  } else if (mode === "validate") {
    console.log(
      JSON.stringify({ event: "notifications_fixture", phase: "configuration", result: "pass" }),
    );
  } else if (mode === "seed") {
    operationStep = "seed_company";
    const password = randomBytes(24).toString("base64url"),
      email = `director-${suffix}@example.invalid`;
    await identity.bootstrap({ email, name: "Fictional Acceptance Director", password });
    const signed = await identity.login(email, password),
      cookie = signed.cookies.map((c) => c.split(";", 1)[0]).join("; ");
    const director = await identity.authenticate(new Headers({ cookie }));
    operationStep = "seed_qualification_rules";
    for (const game of ["ets2", "ats"] as const)
      for (const level of (await composed.qualifications!.levels(director, game)).items) {
        const input: S["RulesInput"] = {
          rules: [{ type: "max_mass", maxKg: "50000" }],
          requiredTrips: 2,
          requiredDistanceM: "1000",
          reason: "Fictional isolated acceptance limits",
        };
        if (level.id === structuralLevels.ets2[0]) {
          const keys = [newId(), newId()];
          const attempts = await Promise.allSettled(
            keys.map((key) =>
              composed.qualifications!.publish(director, level.id, key, level.version, input),
            ),
          );
          assert.equal(attempts.filter((result) => result.status === "fulfilled").length, 1);
          const failed = attempts.find((result) => result.status === "rejected");
          assert.ok(failed?.status === "rejected" && failed.reason?.statusCode === 409);
          const winnerIndex = attempts.findIndex((result) => result.status === "fulfilled"),
            winner = attempts[winnerIndex];
          assert.ok(winner?.status === "fulfilled");
          assert.deepEqual(
            await composed.qualifications!.publish(
              director,
              level.id,
              keys[winnerIndex]!,
              level.version,
              input,
            ),
            winner.value,
          );
          const [count] = await rows<{ n: number }>(
            sql`SELECT COUNT(*) n FROM qualification_rule_versions WHERE level_id=${Buffer.from(level.id)}`,
          );
          assert.equal(Number(count?.n), 1);
          await assert.rejects(
            unit.run((tx) =>
              unit
                .client(tx)
                .execute(
                  sql`UPDATE qualification_rule_versions SET reason=reason WHERE level_id=${Buffer.from(level.id)}`,
                ),
            ),
            (error) => {
              let cause: unknown = error;
              for (let depth = 0; depth < 5 && cause && typeof cause === "object"; depth++) {
                if ("errno" in cause && [1142, 1143].includes(Number(cause.errno))) return true;
                cause = "cause" in cause ? cause.cause : undefined;
              }
              return false;
            },
          );
          console.log(
            JSON.stringify({
              event: "notifications_fixture",
              phase: "restricted_concurrent_rule_publication",
              result: "pass",
              publications: 1,
              conflicts: 1,
              historyMutationDenied: true,
            }),
          );
        } else
          await composed.qualifications!.publish(director, level.id, newId(), level.version, input);
      }
    operationStep = "seed_reconciliation_permissions";
    await rejectSqlPermission(sql`UPDATE reconciliation_rules SET version=version WHERE 1=0`);
    await rejectSqlPermission(sql`DELETE FROM reconciliation_rules WHERE 1=0`);
    await rejectSqlPermission(
      sql`UPDATE reconciliation_candidates SET evidence=evidence WHERE 1=0`,
    );
    await rejectSqlPermission(
      sql`INSERT INTO reconciliation_commands (actor_id,operation,\`key\`,fingerprint,result,created_at) VALUES (${Buffer.from(director.userId)},'merge',${Buffer.from(newId())},${randomBytes(32)},CAST('{}' AS JSON),UTC_TIMESTAMP(3))`,
    );
    await rejectSqlPermission(
      sql`INSERT INTO reconciliation_history (reconciliation_id,version,actor_id,operation,reason,snapshot,created_at) VALUES (${Buffer.from(newId())},1,${Buffer.from(director.userId)},'apply','Fictional forbidden history write',CAST('{}' AS JSON),UTC_TIMESTAMP(3))`,
    );
    console.log(
      JSON.stringify({
        event: "notifications_fixture",
        phase: "reconciliation_permissions",
        result: "pass",
        deniedMutations: 5,
      }),
    );
    await rejectSqlPermission(
      sql`UPDATE notification_acceptance SET image_id=image_id WHERE singleton=1`,
    );
    console.log(
      JSON.stringify({
        event: "notifications_fixture",
        phase: "ownership_permissions",
        result: "pass",
        deniedMutations: 1,
      }),
    );
    operationStep = "seed_members";
    const actors: FixtureActor[] = [{ id: director.userId, email, password, cookie }];
    for (const [name, roles] of [
      ["owner", ["driver"]],
      ["observer", ["driver"]],
      ["dispatcher", ["dispatcher"]],
    ] as const)
      actors.push(
        await member(`${name}-${suffix}@example.invalid`, `Fictional ${name}`, [...roles]),
      );
    await identity.updateCompanySettings(
      director,
      newId(),
      (await unit.run((tx) => identity.companySettingsInTransaction(tx, director))).version,
      "UTC",
    );
    await unit.run((tx) =>
      unit
        .client(tx)
        .execute(
          sql`UPDATE notification_acceptance SET refs=${JSON.stringify({ actors, events: [] })} WHERE singleton=1`,
        ),
    );
    await save("evidence.json", evidence);
  } else if (mode === "revoke") {
    await revoke(await refs());
  } else if (mode === "inspect") {
    const [messages] = await rows<{ n: number }>(sql`SELECT COUNT(*) n FROM notifications`);
    console.log(
      JSON.stringify({
        event: "notifications_fixture",
        phase: "inspection",
        count: Number(messages?.n),
        result: "pass",
      }),
    );
  } else if (mode === "produce") {
    const f = await refs();
    await source(await actor(f.actors[1]!));
  } else {
    const f = await refs(),
      director = await actor(f.actors[0]!),
      owner = await actor(f.actors[1]!);
    const clients = f.actors.map((ref) => ({
      ref,
      cookies: new Map<string, string>(),
      token: "",
      cursor: "",
      lastServerTime: "",
    }));
    type Client = (typeof clients)[number];
    async function request(
      c: Client,
      url: string,
      method = "GET",
      body?: unknown,
      headers: Record<string, string> = {},
    ) {
      const response = await fetch(config.identity!.origin + url, {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(5000),
        headers: {
          origin: config.identity!.origin,
          cookie: [...c.cookies].map(([k, v]) => `${k}=${v}`).join("; "),
          ...(c.token ? { "x-csrf-token": c.token } : {}),
          ...(body ? { "content-type": "application/json" } : {}),
          ...headers,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      for (const cookie of response.headers.getSetCookie()) {
        const [pair] = cookie.split(";"),
          at = pair!.indexOf("=");
        c.cookies.set(pair!.slice(0, at), pair!.slice(at + 1));
      }
      await save(
        "sessions.json",
        clients.map((current) => ({
          id: current.ref.id,
          cookie: [...current.cookies].map(([k, v]) => `${k}=${v}`).join("; "),
        })),
      );
      assert.equal(response.headers.get("cache-control"), "no-store");
      const data = (await response.json()) as {
        data: S["NotificationFeed"] & S["NotificationPreferences"] & { token: string };
      };
      return { status: response.status, headers: response.headers, data: data.data };
    }
    async function login(c: Client) {
      c.cookies.clear();
      c.token = "";
      c.cursor = "";
      c.token = (await request(c, "/api/v1/auth/csrf")).data.token;
      assert.equal(
        (
          await request(c, "/api/v1/auth/login", "POST", {
            email: c.ref.email,
            password: c.ref.password,
          })
        ).status,
        200,
      );
      c.token = (await request(c, "/api/v1/auth/csrf")).data.token;
    }
    async function poll(c: Client): Promise<Message[]> {
      const found: Message[] = [];
      for (let page = 0; page < 100; page++) {
        const feed = await request(
          c,
          `/api/v1/notifications?limit=100${c.cursor ? `&cursor=${encodeURIComponent(c.cursor)}` : ""}`,
        );
        assert.equal(feed.status, 200);
        assert.equal(typeof feed.data.nextCursor, "string");
        found.push(...feed.data.items);
        c.cursor = feed.data.nextCursor;
        c.lastServerTime = feed.data.serverTime;
        if (!feed.data.hasMore) return found;
      }
      throw Error("ACCEPTANCE_PAGE_BOUND");
    }
    async function until<T>(
      read: () => Promise<T>,
      ready: (v: T) => boolean,
      seconds = 210,
      interval = 30000,
    ): Promise<T> {
      const deadline = Date.now() + seconds * 1000;
      while (true) {
        const value = await read();
        if (ready(value)) return value;
        assert.ok(Date.now() < deadline, "ACCEPTANCE_WAIT_EXPIRED");
        await sleep(interval);
      }
    }
    async function one(ordinal: number, work: (samples: number[]) => Promise<void>) {
      phase = ordinal;
      operationStep = "scenario";
      const start = Date.now(),
        samples: number[] = [];
      await work(samples);
      const finished = Date.now();
      evidence.scenarios.push({
        ordinal,
        status: "pass",
        startedUtc: new Date(start).toISOString(),
        finishedUtc: new Date(finished).toISOString(),
        durationMs: finished - start,
        samplesMs: samples,
      });
      await save("evidence.json", evidence);
      console.log(
        JSON.stringify({
          event: "notifications_acceptance_scenario",
          ordinal,
          result: "pass",
          durationMs: finished - start,
          samples: samples.length,
          minimumMs: samples.length ? Math.min(...samples) : null,
          maximumMs: samples.length ? Math.max(...samples) : null,
        }),
      );
    }
    async function beforeNextMinute() {
      let boundary = (Math.floor(Date.now() / 60000) + 1) * 60000;
      if (boundary - Date.now() < 5000) boundary += 60000;
      // Wait outside the transaction; the held-row failure fixture stays inside ordinary bounds.
      await sleep(Math.max(0, boundary - Date.now() - 3000));
    }
    await until(
      async () => {
        try {
          return (
            await fetch(config.identity!.origin + "/health/ready", {
              signal: AbortSignal.timeout(5000),
              redirect: "error",
            })
          ).status;
        } catch {
          return 0;
        }
      },
      (status) => status === 200,
      30,
      1000,
    );
    for (const c of clients) await login(c);
    let scenarioFailed = false;
    try {
      await one(1, async (samples) => {
        const fresh = await source(owner),
          seen = new Map<number, Message[]>(),
          observed = new Map<number, { serverTime: string; arrival: number }>();
        const context = await unit.run((tx) =>
          trips.eventContextInTransaction(tx, fresh.sourceRecordId),
        );
        assert.ok(context);
        await until(
          async () => {
            for (let i = 0; i < clients.length; i++) {
              const page = await poll(clients[i]!);
              if (page.some((r) => r.category === "trip.started") && !observed.has(i))
                observed.set(i, { serverTime: clients[i]!.lastServerTime, arrival: Date.now() });
              seen.set(i, [...(seen.get(i) ?? []), ...page]);
            }
            return seen;
          },
          (m) => [0, 1, 2, 3].every((i) => m.get(i)?.some((r) => r.category === "trip.started")),
          210,
        );
        for (const i of [0, 1, 2, 3]) {
          const match = seen.get(i)!.filter((r) => r.category === "trip.started");
          assert.equal(match.length, 1);
          const observation = observed.get(i);
          assert.ok(observation && Number.isFinite(Date.parse(observation.serverTime)));
          assert.equal(
            match[0]!.liveToastEligible,
            Date.parse(observation.serverTime) <= fresh.occurredAt + 120000,
          );
          assert.deepEqual(Object.keys(match[0]!.display).sort(), [
            "actorNickname",
            "eventTitle",
            "game",
          ]);
          assert.equal(match[0]!.display.actorNickname, "Fictional owner");
          assert.equal(match[0]!.display.game, "ets2");
          if (i === 2) assert.equal(match[0]!.target, null);
          samples.push(observation.arrival - fresh.occurredAt);
          evidence.observations.push({
            actorOrdinal: i,
            sourceOccurredUtcMs: fresh.occurredAt,
            sourceReceiptUtc: context.receivedAt,
            pollArrivalUtcMs: observation.arrival,
            responseServerUtc: observation.serverTime,
            commitObservation:
              "Committed effect first observed in this HTTP response; no exact commit wall-time claimed.",
          });
        }
      });
      await one(2, async () => {
        const old = [];
        for (const kind of ["backfill", "unknown", "delayed"] as const)
          old.push(await source(owner, kind));
        const terminal = await source(owner, "completed");
        const delayedStart = await source(owner, "fresh", terminal.sourceId);
        assert.equal(delayedStart.id, terminal.id);
        const seen: Message[] = [];
        await until(
          async () => {
            seen.push(...(await poll(clients[1]!)));
            return seen;
          },
          (items) =>
            items.filter((i) => i.category === "trip.started").length >= 3 &&
            items.some((i) => i.category === "trip.finished"),
        );
        for (const item of seen)
          if (old.some((r) => r.id === item.target?.id))
            assert.equal(item.liveToastEligible, false);
        assert.ok(
          !seen.some(
            (i) =>
              i.category === "trip.started" && i.target?.id === terminal.id && i.liveToastEligible,
          ),
        );
      });
      await one(3, async () => {
        await composed.admissions!.submit(`notifications-${suffix}`, newId(), {
          nickname: "Fictional acceptance applicant",
          email: `applicant-${suffix}@example.invalid`,
          steamProfileUrl: "https://steamcommunity.com/id/fictional-acceptance",
          games: ["ets2"],
          discord: null,
          introduction: null,
        });
        const seen = clients.map(() => [] as Message[]);
        await until(
          async () => {
            for (let i = 0; i < clients.length; i++) seen[i]!.push(...(await poll(clients[i]!)));
            return seen;
          },
          (items) => items[0]!.some((i) => i.category === "application.submitted"),
        );
        for (const i of [1, 2, 3])
          assert.ok(!seen[i]!.some((r) => r.category === "application.submitted"));
        const completed = await source(owner, "completed"),
          staff = await actor(f.actors[3]!),
          review = await composed.tripDecisions!.review(staff, completed.id);
        await composed.tripDecisions!.decide(staff, completed.id, newId(), review.version, {
          decision: "reject",
          reviewedRevisionId: review.data.factRevisionId,
          factRevisionId: review.data.factRevisionId,
          proposalId: null,
          reason: "Fictional private acceptance rejection",
        });
        const rejected = clients.map(() => [] as Message[]);
        await until(
          async () => {
            for (let i = 0; i < clients.length; i++)
              rejected[i]!.push(...(await poll(clients[i]!)));
            return rejected;
          },
          (items) =>
            [0, 1, 3].every((i) =>
              items[i]!.some(
                (r) => r.category === "trip.rejected" && r.target?.id === completed.id,
              ),
            ),
        );
        assert.ok(!rejected[2]!.some((r) => r.category === "trip.rejected"));
        assert.ok(!JSON.stringify(rejected).includes("Fictional private acceptance rejection"));
        const privateMessage = rejected[3]!.find((r) => r.category === "trip.rejected")!,
          readKey = newId();
        assert.equal(
          (
            await request(
              clients[3]!,
              `/api/v1/notifications/${privateMessage.id}/read`,
              "POST",
              undefined,
              { "idempotency-key": readKey },
            )
          ).status,
          200,
        );
        const beforeRoleLoss = await identity.current(staff),
          staleStaffCursor = clients[3]!.cursor;
        await identity.administer(director, staff.userId, newId(), beforeRoleLoss.version, {
          kind: "roles",
          roles: ["driver"],
        });
        assert.equal((await request(clients[3]!, "/api/v1/notifications")).status, 401);
        await login(clients[3]!);
        assert.ok(
          [403, 409, 422].includes(
            (
              await request(
                clients[3]!,
                `/api/v1/notifications?cursor=${encodeURIComponent(staleStaffCursor)}`,
              )
            ).status,
          ),
        );
        const filtered = await request(clients[3]!, "/api/v1/notifications?limit=100");
        assert.equal(filtered.status, 200);
        assert.ok(
          !filtered.data.items.some((r: Message) =>
            ["trip.rejected", "application.submitted"].includes(r.category),
          ),
        );
        assert.equal(
          filtered.data.unreadCount,
          filtered.data.items.filter((r: Message) => r.readAt === null).length,
        );
        // A permanent read receipt cannot bypass current private-category authorization.
        assert.equal(
          (
            await request(
              clients[3]!,
              `/api/v1/notifications/${privateMessage.id}/read`,
              "POST",
              undefined,
              { "idempotency-key": readKey },
            )
          ).status,
          404,
        );
        const before = await rows<{ version: number }>(
          sql`SELECT version FROM identity_memberships WHERE user_id=${Buffer.from(f.actors[3]!.id)}`,
        );
        const stale = filtered.data.nextCursor;
        assert.ok(stale);
        await identity.administer(director, f.actors[3]!.id, newId(), Number(before[0]!.version), {
          kind: "deactivate",
          reason: "Fictional acceptance deactivation",
        });
        assert.equal((await request(clients[3]!, "/api/v1/notifications")).status, 401);
        const after = await rows<{ version: number }>(
          sql`SELECT version FROM identity_memberships WHERE user_id=${Buffer.from(f.actors[3]!.id)}`,
        );
        await identity.administer(director, f.actors[3]!.id, newId(), Number(after[0]!.version), {
          kind: "reinstate",
          roles: ["driver"],
          qualifications: [
            {
              game: "ets2",
              levelId: structuralLevels.ets2[0],
              purpose: "reinstatement",
              reason: "Fictional acceptance reinstatement",
            },
          ],
          reason: "Fictional acceptance reinstatement",
        });
        await login(clients[3]!);
        assert.ok(
          [403, 409, 422].includes(
            (
              await request(
                clients[3]!,
                `/api/v1/notifications?cursor=${encodeURIComponent(stale)}`,
              )
            ).status,
          ),
        );
      });
      await one(4, async () => {
        const c = clients[1]!,
          before = await request(c, "/api/v1/me/notification-preferences"),
          key = newId();
        const next = { ...before.data, tripStarted: false };
        const headers = { "if-match": before.headers.get("etag")!, "idempotency-key": key };
        const first = await request(c, "/api/v1/me/notification-preferences", "PUT", next, headers);
        assert.equal(first.status, 200);
        assert.equal(
          (await request(c, "/api/v1/me/notification-preferences", "PUT", next, headers)).status,
          200,
        );
        assert.equal(
          (await request(c, "/api/v1/me/notification-preferences", "PUT", before.data, headers))
            .status,
          409,
        );
        const hidden = await source(owner);
        await until(
          async () => await poll(clients[2]!),
          (items) => items.some((i) => i.target === null && i.category === "trip.started"),
        );
        assert.ok(!(await poll(c)).some((i) => i.target?.id === hidden.id));
        const current = await request(c, "/api/v1/me/notification-preferences");
        assert.equal(
          (
            await request(c, "/api/v1/me/notification-preferences", "PUT", before.data, {
              "if-match": current.headers.get("etag")!,
              "idempotency-key": newId(),
            })
          ).status,
          200,
        );
        const through = c.cursor;
        assert.equal(
          (
            await request(
              c,
              "/api/v1/notifications/read-all",
              "POST",
              { throughCursor: through },
              { "idempotency-key": newId() },
            )
          ).status,
          200,
        );
        const newer = await source(owner),
          arrived: Message[] = [];
        await until(
          async () => {
            arrived.push(...(await poll(c)));
            return arrived;
          },
          (items) => items.some((i) => i.target?.id === newer.id),
        );
        assert.equal(arrived.find((i) => i.target?.id === newer.id)!.readAt, null);
      });
      await one(5, async () => {
        await beforeNextMinute();
        const created = await event(director, owner),
          rescheduled = await event(director, owner),
          cancelled = await event(director, owner),
          observer = await actor(f.actors[2]!),
          departed = await event(director, observer),
          c = clients[1]!,
          seen: Message[] = [];
        await events.respond(observer, created.id, newId(), 1, {
          response: "declined",
          reason: "Fictional private decline",
        });
        await until(
          async () => {
            seen.push(...(await poll(c)));
            return seen;
          },
          (items) =>
            [created, rescheduled, cancelled].every((e) =>
              items.some((i) => i.category === "event.reminder" && i.target?.id === e.id),
            ),
        );
        const reminder = seen.find(
            (i) => i.category === "event.reminder" && i.target?.id === created.id,
          )!,
          oldRescheduled = seen.find(
            (i) => i.category === "event.reminder" && i.target?.id === rescheduled.id,
          )!;
        const observerMessages = await until(
          async () => await request(clients[2]!, "/api/v1/notifications?limit=100"),
          (feed) =>
            feed.data.items.some(
              (i: Message) => i.category === "event.reminder" && i.target?.id === departed.id,
            ),
        );
        assert.ok(
          !observerMessages.data.items.some(
            (i: Message) => i.category === "event.reminder" && i.target?.id === created.id,
          ),
        );
        for (const index of [0, 3]) {
          const unanswered = await request(clients[index]!, "/api/v1/notifications?limit=100");
          assert.ok(!unanswered.data.items.some((i: Message) => i.category === "event.reminder"));
        }
        await events.cancel(director, cancelled.id, newId(), 1, "Fictional unread cancellation");
        assert.ok(
          !(await request(c, "/api/v1/notifications?limit=100")).data.items.some(
            (i: Message) => i.category === "event.reminder" && i.target?.id === cancelled.id,
          ),
        );
        const membership = await identity.current(observer);
        await identity.administer(director, observer.userId, newId(), membership.version, {
          kind: "deactivate",
          reason: "Fictional reminder membership loss",
        });
        assert.equal((await request(clients[2]!, "/api/v1/notifications")).status, 401);
        const [inactive] = await rows<{ version: number }>(
          sql`SELECT version FROM identity_memberships WHERE user_id=${Buffer.from(observer.userId)}`,
        );
        await identity.administer(director, observer.userId, newId(), Number(inactive!.version), {
          kind: "reinstate",
          roles: ["driver"],
          qualifications: [
            {
              game: "ets2",
              levelId: structuralLevels.ets2[0],
              purpose: "reinstatement",
              reason: "Fictional acceptance reinstatement",
            },
          ],
          reason: "Fictional reminder membership return",
        });
        await login(clients[2]!);
        const returned = await request(clients[2]!, "/api/v1/notifications?limit=100");
        assert.ok(
          !returned.data.items.some(
            (i: Message) => i.category === "event.reminder" && i.target?.id === departed.id,
          ),
        );
        assert.equal(
          returned.data.unreadCount,
          returned.data.items.filter((i: Message) => i.readAt === null).length,
        );
        await events.update(director, rescheduled.id, newId(), 1, {
          ...rescheduled.input,
          startsAt: new Date(Date.now() + 3660000).toISOString(),
        });
        assert.ok(
          !(await request(c, "/api/v1/notifications?limit=100")).data.items.some(
            (i: Message) => i.id === oldRescheduled.id,
          ),
        );
        const replacement = await until(
          async () => await request(c, "/api/v1/notifications?limit=100"),
          (feed) =>
            feed.data.items.some(
              (i: Message) =>
                i.category === "event.reminder" &&
                i.target?.id === rescheduled.id &&
                i.id !== oldRescheduled.id,
            ),
        );
        assert.equal(
          replacement.data.items.filter(
            (i: Message) => i.category === "event.reminder" && i.target?.id === rescheduled.id,
          ).length,
          1,
        );
        await events.respond(owner, rescheduled.id, newId(), 2, {
          response: "declined",
          reason: "Fictional unread RSVP withdrawal",
        });
        assert.ok(
          !(await request(c, "/api/v1/notifications?limit=100")).data.items.some(
            (i: Message) => i.category === "event.reminder" && i.target?.id === rescheduled.id,
          ),
        );
        await events.update(director, created.id, newId(), 1, {
          ...created.input,
          title: "Fictional cosmetic revision",
        });
        await sleep(60000);
        const latest = await request(c, "/api/v1/notifications");
        assert.equal(
          latest.data.items.filter(
            (i: Message) => i.category === "event.reminder" && i.target?.id === created.id,
          ).length,
          1,
        );
        assert.equal(
          latest.data.items.find(
            (i: Message) => i.category === "event.reminder" && i.target?.id === created.id,
          )?.id,
          reminder.id,
        );
        const readKey = newId();
        assert.equal(
          (
            await request(c, `/api/v1/notifications/${reminder.id}/read`, "POST", undefined, {
              "idempotency-key": readKey,
            })
          ).status,
          200,
        );
        await events.update(director, created.id, newId(), 2, {
          ...created.input,
          route: "Fictional revised route",
        });
        await sleep(60000);
        const readCosmetic = await request(c, "/api/v1/notifications/history?limit=100");
        assert.equal(
          readCosmetic.data.items.filter(
            (i: Message) => i.category === "event.reminder" && i.target?.id === created.id,
          ).length,
          1,
        );
        assert.ok(
          readCosmetic.data.items.some(
            (i: Message) => i.id === reminder.id && i.readAt && !i.liveToastEligible,
          ),
        );
        await events.respond(owner, created.id, newId(), 2, {
          response: "declined",
          reason: "Fictional withdrawal",
        });
        await events.cancel(director, created.id, newId(), 3, "Fictional cancellation");
        const history = await request(c, "/api/v1/notifications/history?limit=100");
        assert.ok(
          history.data.items.some(
            (i: Message) => i.id === reminder.id && !i.liveToastEligible && i.readAt,
          ),
        );
      });
      await one(6, async () => {
        const due = Date.now();
        await save("request.json", {
          runId: run,
          scenario: 6,
          kind: "pause",
          createdUtc: due,
          untilUtc: due + 150000,
        });
        await until(
          async () => JSON.parse(await readFile(path("tick.json"), "utf8")),
          (tick) =>
            tick.status === "skipped_requested_pause" && tick.finishedUtc >= Math.floor(due / 1000),
          90,
          1000,
        );
        const created = await event(
          director,
          owner,
          eventInput({ startsAt: new Date(due + 3600000).toISOString() }),
        );
        await sleep(Math.max(0, due + 190000 - Date.now()));
        await until(
          async () => JSON.parse(await readFile(path("tick.json"), "utf8")),
          (tick) => tick.status === "pass" && tick.finishedUtc * 1000 > due + 150000,
          150,
          30000,
        );
        const [saved] = await rows<{ n: number }>(
          sql`SELECT COUNT(*) n FROM notifications WHERE category='event.reminder' AND subject_id=${Buffer.from(created.id)}`,
        );
        assert.equal(Number(saved?.n), 0);
        const messages = await request(clients[1]!, "/api/v1/notifications");
        assert.ok(
          !messages.data.items.some(
            (i: Message) => i.category === "event.reminder" && i.target?.id === created.id,
          ),
        );
      });
      await one(7, async (samples) => {
        const first = await source(owner, "backfill");
        for (let i = 1; i < 110; i++) await source(owner, i % 2 ? "backfill" : "delayed");
        const context = await unit.run((tx) =>
          trips.eventContextInTransaction(tx, first.sourceRecordId),
        );
        assert.ok(context);
        const envelope = (id = newId()): TripEvent => ({
          eventId: id,
          type: "trip.lifecycle_changed",
          schemaVersion: 1,
          aggregate: { kind: "trip", id: first.id, version: 1 },
          occurredAt: new Date(first.occurredAt).toISOString(),
          correlationId: newId(),
          causationId: null,
          data: {
            tripId: first.id,
            sourceRecordId: first.sourceRecordId,
            factRevisionId: context.factRevisionId,
          },
        });
        const old = createOutbox(unit);
        for (let i = 0; i < 260; i++) await unit.run((tx) => old.append(tx, envelope()));
        const lateId = "00000000-0000-4000-8000-00000000000c";
        let sawAdvanced = false;
        await beforeNextMinute();
        await unit.run(async (tx) => {
          await old.append(tx, envelope(lateId));
          await until(
            async () =>
              await rows<{ value: string | null }>(
                sql`SELECT HEX(\`cursor\`) value FROM outbox_routing_scans WHERE consumer='notifications.v1'`,
              ),
            (value) => {
              sawAdvanced = !!value[0]?.value;
              return sawAdvanced;
            },
            20,
            50,
          );
        });
        assert.equal(sawAdvanced, true);
        await until(
          async () =>
            await rows<{ n: number }>(
              sql`SELECT COUNT(*) n FROM durable_jobs j JOIN job_effect_receipts r ON r.job_id=j.id WHERE j.event_id=${Buffer.from(lateId)} AND j.consumer='notifications.v1'`,
            ),
          (value) => Number(value[0]?.n) === 1,
          480,
        );
        await until(
          async () =>
            await rows<{ value: string | null }>(
              sql`SELECT HEX(\`cursor\`) value FROM outbox_routing_scans WHERE consumer='notifications.v1'`,
            ),
          (value) => value.length === 1 && value[0]?.value === null,
          180,
          1000,
        );
        const seen: Message[] = [];
        await until(
          async () => {
            seen.push(...(await poll(clients[1]!)));
            return seen;
          },
          (items) => items.filter((i) => i.category === "trip.started").length >= 110,
          480,
        );
        assert.equal(new Set(seen.map((i) => i.id)).size, seen.length);
        assert.ok(
          seen.filter((i) => i.category === "trip.started").every((i) => !i.liveToastEligible),
        );
        samples.push(Date.now() - first.occurredAt);
      });
      await one(8, async () => {
        await beforeNextMinute();
        const interruptedTrip = await source(owner);
        await unit.run(async (tx) => {
          operationStep = "interrupt_lock";
          await unit
            .client(tx)
            .execute(
              sql`SELECT recipient_id FROM notification_recipients WHERE recipient_id=${Buffer.from(owner.userId)} FOR UPDATE`,
            );
          await save("request.json", {
            runId: run,
            scenario: 8,
            kind: "interrupt",
            createdUtc: Date.now(),
          });
          operationStep = "interrupt_ack";
          await until(
            async () => {
              try {
                return JSON.parse(await readFile(path("interrupted.json"), "utf8"));
              } catch {
                return null;
              }
            },
            (v) => v?.runId === run,
            20,
            250,
          );
        });
        await save("request.json", {
          runId: run,
          scenario: 8,
          kind: "overlap",
          createdUtc: Date.now(),
        });
        operationStep = "interrupt_drain";
        await until(
          async () =>
            await rows<{ n: number }>(
              sql`SELECT COUNT(*) n FROM durable_jobs WHERE state='running'`,
            ),
          (r) => Number(r[0]?.n) === 0,
          150,
        );
        const interrupted = JSON.parse(await readFile(path("interrupted.json"), "utf8"));
        operationStep = "interrupt_binding";
        assert.equal(interrupted.runId, run);
        operationStep = "interrupt_recovery";
        const recovered = await until(
          async () =>
            await rows<{ attempts: number; state: string }>(
              sql`SELECT attempts,state FROM durable_jobs WHERE id=UNHEX(${interrupted.jobIdHex})`,
            ),
          (value) => value[0]?.state === "completed",
          150,
        );
        operationStep = "interrupt_attempts";
        assert.ok(Number(recovered[0]?.attempts) >= 2);
        operationStep = "interrupt_effects";
        const [effects] = await rows<{ n: number }>(
          sql`SELECT COUNT(*) n FROM notifications WHERE subject_id=${Buffer.from(interruptedTrip.id)} AND category='trip.started'`,
        );
        assert.equal(Number(effects?.n), 4);
        operationStep = "interrupt_duplicates";
        const [duplicates] = await rows<{ n: number }>(
          sql`SELECT COUNT(*) n FROM (SELECT recipient_id,effect_key,COUNT(*) c FROM notifications GROUP BY recipient_id,effect_key HAVING c>1) x`,
        );
        assert.equal(Number(duplicates?.n), 0);
      });
      await one(9, async (samples) => {
        const before = JSON.parse(await readFile(path("tick.json"), "utf8")),
          fresh = await source(owner);
        // No HTTP/browser request occurs during these two independent scheduler invocations.
        await until(
          async () => JSON.parse(await readFile(path("tick.json"), "utf8")),
          (v) => v.count >= before.count + 2,
          180,
          1000,
        );
        const arrived = await poll(clients[1]!);
        assert.ok(arrived.some((i) => i.category === "trip.started" && i.target?.id === fresh.id));
        samples.push(Date.now() - fresh.occurredAt);
      });
      evidence.status = "pass";
      await save("evidence.json", evidence);
    } catch (error) {
      scenarioFailed = true;
      throw error;
    } finally {
      const priorStep = operationStep;
      operationStep = "scenario_teardown";
      try {
        const secondary = await acceptanceTeardown(async () => {
          for (const c of clients)
            if (c.cookies.size) {
              const csrf = await request(c, "/api/v1/auth/csrf");
              if (csrf.status === 200) {
                c.token = csrf.data.token;
                const result = await request(c, "/api/v1/auth/logout", "POST");
                assert.ok([200, 401].includes(result.status));
              }
              assert.equal((await request(c, "/api/v1/notifications")).status, 401);
            }
        }, scenarioFailed);
        if (secondary)
          evidence.teardownFailure = acceptanceDiagnostic(secondary.error, operationStep);
      } finally {
        if (scenarioFailed) operationStep = priorStep;
      }
    }
  }
} catch (error) {
  evidence.status = "fail";
  evidence.failure = { ordinal: phase, ...acceptanceDiagnostic(error, operationStep) };
  await save("evidence.json", evidence).catch(() => undefined);
  console.error(
    JSON.stringify({
      event: "notifications_acceptance_scenario",
      result: "fail",
      ...evidence.failure,
    }),
  );
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  await unit.close();
}
