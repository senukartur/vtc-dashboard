import { randomBytes, randomUUID } from "node:crypto";
import { createUnitOfWork, newId, runMigrations } from "@vtc/db";
import { eq, steamLinks, steamNonces, steamProofs } from "@vtc/db/external-identities-schema";
import { membership } from "@vtc/db/identity-schema";
import type { Connection, RowDataPacket } from "mysql2/promise";
import {
  beforeEach,
  expect,
  test,
  afterAll as vitestAfterAll,
  beforeAll as vitestBeforeAll,
} from "vitest";
import { createApp } from "../../apps/api/src/app.ts";
import {
  type ExternalProviders,
  ProviderFailure,
  steamEndpoint,
  steamProvider,
} from "../../apps/api/src/modules/external-identities/providers.ts";
import {
  createExternalIdentities,
  type ExternalCredential,
  steamProjection,
} from "../../apps/api/src/modules/external-identities/service.ts";
import { type Actor, createIdentity } from "../../apps/api/src/modules/identity/service.ts";
import { identityAccessEvents } from "../../apps/api/src/platform/outbox/events.ts";
import {
  guardedSettings,
  reset,
  SCHEMA_SETUP_TIMEOUT_MS,
  testConnection,
} from "../persistence/support.ts";
import { identityDiagnostics } from "../support/identity-diagnostics.ts";
import { schemaLifecycleHooks } from "../support/schema-lifecycle.ts";

const { beforeAll, afterAll } = schemaLifecycleHooks(vitestBeforeAll, vitestAfterAll);

const config = {
  secret: randomBytes(32).toString("hex"),
  origin: "http://127.0.0.1:4173",
  production: false,
};
const password = "Synthetic-external-passphrase-42";
const diagnostic = identityDiagnostics("external");
let unit: ReturnType<typeof createUnitOfWork>, control: Connection, director: Actor;
let instant = Date.now(),
  serial = 10n;
const now = () => new Date(instant),
  sid = () => (76561190000000000n + serial++).toString();
const ports = () => ({
  accessEvents: identityAccessEvents(unit),
  steamProjection: steamProjection(unit),
});
const owner = () => createIdentity(unit, config, ports(), now);
const providers = (): ExternalProviders => ({
  steam: steamProvider(
    async () => new Response("ns:http://specs.openid.net/auth/2.0\nis_valid:true\n"),
  ),
  truckers: { lookup: async () => ({ found: false, profile: null }) },
});
const external = (custom = providers(), identity = owner()) =>
  createExternalIdentities(unit, identity, custom, now);
async function safe<T>(input: Promise<T>): Promise<T> {
  try {
    return await input;
  } catch (error) {
    throw Object.assign(new Error("SYNTHETIC_EXTERNAL_OPERATION_FAILED"), {
      statusCode:
        error && typeof error === "object" && "statusCode" in error ? error.statusCode : 500,
    });
  }
}
async function signIn(email: string) {
  const login = await safe(owner().login(email, password)),
    cookie = login.cookies.map((value) => value.split(";", 1)[0]).join("; ");
  return { cookie, actor: await safe(owner().authenticate(new Headers({ cookie }))) };
}
async function member(roles: ("driver" | "deputy_director" | "dispatcher")[] = ["driver"]) {
  const userId = newId(),
    email = `${userId}@example.invalid`,
    identity = owner(),
    prepared = await identity.prepareCredential(password);
  await safe(
    unit.run((tx) =>
      identity.insertWithCredential(tx, {
        userId,
        email,
        name: "Synthetic External Member",
        roles,
        ...prepared,
      }),
    ),
  );
  return { userId, email, ...(await signIn(email)) };
}
function assertion(
  request: { verificationUrl: string },
  candidate: string,
  nonce = `${now().toISOString().slice(0, 19)}Z${randomUUID()}`,
) {
  const returned = new URL(
    new URL(request.verificationUrl).searchParams.get("openid.return_to") ?? "",
  );
  const query = new URLSearchParams(returned.search);
  for (const [key, value] of Object.entries({
    ns: "http://specs.openid.net/auth/2.0",
    mode: "id_res",
    op_endpoint: steamEndpoint,
    claimed_id: `https://steamcommunity.com/openid/id/${candidate}`,
    identity: `https://steamcommunity.com/openid/id/${candidate}`,
    return_to: returned.toString(),
    response_nonce: nonce,
    assoc_handle: "synthetic",
    signed: "op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle",
    sig: Buffer.alloc(32, 1).toString("base64"),
  }))
    query.set(`openid.${key}`, value);
  return query.toString();
}
async function initial(actor: Actor, candidate = sid()) {
  const service = external(),
    request = await safe(service.request(actor, newId(), "initial")),
    raw = assertion(request, candidate);
  await safe(service.callback(actor, raw));
  return { candidate, raw, request };
}
async function replacement(actor: Actor, candidate = sid()) {
  const service = external(),
    request = await safe(service.request(actor, newId(), "replacement"));
  await safe(service.callback(actor, assertion(request, candidate)));
  return { candidate, request };
}
const version = async (actor: Actor) => (await safe(owner().current(actor))).version;
const apply = async (
  actor: Actor,
  target: Actor,
  proofId: string,
  key = newId(),
  expected?: number,
) =>
  safe(
    external().replace(actor, target.userId, key, expected ?? (await version(target)), {
      verificationId: proofId,
      reason: "Synthetic owner requested replacement",
    }),
  );
async function credential(actor: Actor): Promise<ExternalCredential> {
  return unit.run(async (tx) => {
    const access = await owner().accessState(tx, actor.userId),
      [link] = await unit
        .client(tx)
        .select()
        .from(steamLinks)
        .where(eq(steamLinks.userId, actor.userId));
    if (!link) throw new Error("SYNTHETIC_LINK_REQUIRED");
    return {
      userId: actor.userId,
      steamId: link.steamId,
      accessEpoch: access.accessEpoch,
      identityEpoch: access.identityEpoch,
      credentialEpoch: access.credentialEpoch,
    };
  });
}
async function eligible(c: ExternalCredential) {
  return safe(unit.run((tx) => external().credentialEligible(tx, c)));
}
async function count(
  table:
    | "external_steam_changes"
    | "external_steam_accounts"
    | "external_steam_nonces"
    | "outbox_events",
  userId?: string,
) {
  const filter = userId
    ? table === "outbox_events"
      ? " WHERE aggregate_id = ?"
      : " WHERE user_id = ?"
    : "";
  const [rows] = await safe(
    control.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM ${table}${filter}`,
      userId ? [userId] : [],
    ),
  );
  return Number(rows[0]?.n);
}
beforeAll(async () => {
  control = await diagnostic.phase("connection", () => testConnection());
  await diagnostic.phase("reset", () => reset(control));
  await diagnostic.phase("migrations", () => runMigrations(guardedSettings()));
  unit = createUnitOfWork(guardedSettings());
  await diagnostic.phase("bootstrap", () =>
    safe(
      owner().bootstrap({
        email: "external-director@example.invalid",
        name: "Synthetic External Director",
        password,
      }),
    ),
  );
  director = (await signIn("external-director@example.invalid")).actor;
  // This aggregate setup includes eight complete migrations/reset and native password
  // hashing. A focused run measured the old 15s hook deadline; SQL/control bounds stay unchanged.
}, SCHEMA_SETUP_TIMEOUT_MS);
beforeEach(() => {
  instant += 60000;
});
afterAll(async () => {
  await unit?.close();
  await control?.end();
});

test("initial proof links once, projects /me and retains password login and local owner", async () => {
  const m = await member(),
    original = await version(m.actor),
    linked = await initial(m.actor);
  const self = await safe(owner().current(m.actor));
  expect(self.data.steamVerified).toBe(true);
  expect(self.data.missingSetup.includes("steam")).toBe(false);
  expect(self.version).toBe(original + 1);
  expect((await signIn(m.email)).actor.userId === m.userId).toBe(true);
  expect(await count("external_steam_changes", m.userId)).toBe(1);
  await expect(safe(external().callback(m.actor, linked.raw))).rejects.toMatchObject({
    statusCode: 401,
  });
  await expect(safe(external().request(m.actor, newId(), "initial"))).rejects.toMatchObject({
    statusCode: 409,
  });
  expect(await count("external_steam_changes", m.userId)).toBe(1);
});
test("request results reconstruct an identical bound URL after response loss or proof completion", async () => {
  const m = await member(),
    service = external(),
    key = newId();
  const first = await safe(service.request(m.actor, key, "initial"));
  expect(await safe(service.request(m.actor, key, "initial"))).toEqual(first);
  await safe(service.callback(m.actor, assertion(first, sid())));
  expect(await safe(service.request(m.actor, key, "initial"))).toEqual(first);
  const [rows] = await control.query<RowDataPacket[]>(
    "SELECT result FROM identity_command_results WHERE command_key=?",
    [key],
  );
  const text = JSON.stringify(rows);
  expect(
    text.includes("verificationUrl") || text.includes("state=") || text.includes("openid"),
  ).toBe(false);
});
test("cancellation, failed provider receipt and an in-flight membership change never link an account", async () => {
  const m = await member(),
    service = external();
  const cancelled = await safe(service.request(m.actor, newId(), "initial"));
  const query = new URL(
    new URL(cancelled.verificationUrl).searchParams.get("openid.return_to") ?? "",
  ).searchParams;
  query.set("openid.mode", "cancel");
  await expect(safe(service.callback(m.actor, query.toString()))).rejects.toMatchObject({
    statusCode: 401,
  });
  const unavailable = providers();
  unavailable.steam.verify = async () => {
    throw new ProviderFailure("timeout");
  };
  const retry = await safe(service.request(m.actor, newId(), "initial"));
  await expect(
    safe(external(unavailable).callback(m.actor, assertion(retry, sid()))),
  ).rejects.toMatchObject({ statusCode: 503 });
  let release: (() => void) | undefined, entered: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
      entered = resolve;
    }),
    held = new Promise<void>((resolve) => {
      release = resolve;
    });
  const delayed = providers(),
    verify = delayed.steam.verify;
  delayed.steam.verify = async (...args) => {
    entered?.();
    await held;
    return verify(...args);
  };
  const pending = safe(external(delayed).callback(m.actor, assertion(retry, sid())));
  const rejected = expect(pending).rejects.toMatchObject({ statusCode: 401 });
  await gate;
  await safe(
    owner().administer(director, m.userId, newId(), await version(m.actor), { kind: "deactivate" }),
  );
  release?.();
  await rejected;
  expect(await count("external_steam_changes", m.userId)).toBe(0);
});
test("proof pages bind cursors to actor/session/member/limit and logout invalidates pending proofs", async () => {
  const m = await member(),
    deputy = await member(["deputy_director"]),
    other = await member(),
    service = external();
  await initial(m.actor);
  await replacement(m.actor);
  const next = await replacement(m.actor);
  const page = await safe(service.list(director, m.userId, { limit: 1 }));
  expect(page.items.length).toBe(1);
  expect(typeof page.nextCursor).toBe("string");
  const cursor = page.nextCursor ?? "";
  const second = await safe(service.list(director, m.userId, { limit: 1, cursor }));
  expect(second.items.length).toBe(1);
  expect(second.nextCursor).toBe(null);
  for (const [actor, targetId, limit] of [
    [deputy.actor, m.userId, 1],
    [director, other.userId, 1],
    [director, m.userId, 2],
  ] as const)
    await expect(safe(service.list(actor, targetId, { limit, cursor }))).rejects.toMatchObject({
      statusCode: 422,
    });
  await safe(owner().logout(m.actor, new Headers({ cookie: m.cookie })));
  expect((await safe(service.inspect(director, next.request.id, m.userId, true))).state).toBe(
    "invalidated",
  );
  await expect(
    apply(director, (await signIn(m.email)).actor, next.request.id),
  ).rejects.toMatchObject({ statusCode: 409 });
});

test("retained proof pages default to 25 and share cursor scope with explicit 25 only", async () => {
  const m = await member(),
    service = external(),
    proofIds = Array.from({ length: 52 }, () => newId()).sort();
  const linked = await initial(m.actor);
  await unit.run(async (tx) => {
    const target = await owner().externalContext(tx, m.actor);
    await unit
      .client(tx)
      .insert(steamProofs)
      .values(
        proofIds.map((id) => ({
          id,
          userId: m.userId,
          sessionId: m.actor.sessionId,
          purpose: "replacement" as const,
          state: "invalidated" as const,
          identityEpoch: target.identityEpoch,
          accessEpoch: target.accessEpoch,
          credentialEpoch: target.credentialEpoch,
          emailEpoch: target.emailEpoch,
          previousSteamId: linked.candidate,
          createdAt: now(),
          expiresAt: new Date(instant + 600000),
        })),
      );
  });
  const first = await safe(service.list(director, m.userId, {}));
  expect(first.items.map((proof) => proof.id)).toEqual(proofIds.slice(0, 25));
  expect(typeof first.nextCursor).toBe("string");
  expect(await safe(service.list(director, m.userId, { limit: 25 }))).toEqual(first);
  const cursor = first.nextCursor ?? "";
  const second = await safe(service.list(director, m.userId, { cursor }));
  expect(second.items.map((proof) => proof.id)).toEqual(proofIds.slice(25, 50));
  expect(typeof second.nextCursor).toBe("string");
  expect(await safe(service.list(director, m.userId, { cursor, limit: 25 }))).toEqual(second);
  await expect(safe(service.list(director, m.userId, { cursor, limit: 50 }))).rejects.toMatchObject(
    { statusCode: 422 },
  );
  const finalCursor = second.nextCursor ?? "";
  const last = await safe(service.list(director, m.userId, { cursor: finalCursor, limit: 25 }));
  expect(await safe(service.list(director, m.userId, { cursor: finalCursor }))).toEqual(last);
  expect(last.items.map((proof) => proof.id)).toEqual(proofIds.slice(50));
  expect(last.nextCursor).toBe(null);
  const received = [...first.items, ...second.items, ...last.items].map((proof) => proof.id);
  expect(received).toEqual(proofIds);
  expect(new Set(received).size).toBe(52);
});

test("competing owners cannot claim the same exact Steam ID, including a released historical ID", async () => {
  const first = await member(),
    second = await member(),
    candidate = sid(),
    service = external();
  const requests = await Promise.all(
    [first, second].map((m) => safe(service.request(m.actor, newId(), "initial"))),
  );
  const outcomes = await Promise.allSettled(
    [first, second].map((m, i) => {
      const request = requests[i];
      if (!request) throw new Error("SYNTHETIC_REQUEST_REQUIRED");
      return safe(service.callback(m.actor, assertion(request, candidate)));
    }),
  );
  expect(outcomes.filter((result) => result.status === "fulfilled").length).toBe(1);
  const winner = outcomes[0]?.status === "fulfilled" ? first : second,
    loser = winner === first ? second : first;
  const requested = await replacement(winner.actor);
  await apply(director, winner.actor, requested.request.id);
  const retry = await safe(service.request(loser.actor, newId(), "initial"));
  await expect(
    safe(service.callback(loser.actor, assertion(retry, candidate))),
  ).rejects.toMatchObject({ statusCode: 409 });
  expect((await safe(owner().current(loser.actor))).data.steamVerified).toBe(false);
});
test("replacement only verifies a member request; current deputy/director applies exactly once and epochs never revive", async () => {
  const m = await member(),
    deputy = await member(["deputy_director"]),
    old = await initial(m.actor),
    before = await credential(m.actor);
  const next = await replacement(m.actor),
    expected = await version(m.actor),
    key = newId();
  expect(await eligible(before)).toBe(true);
  expect((await safe(external().inspect(m.actor, next.request.id))).state).toBe("verified");
  const results = await Promise.all(
    [1, 2].map(() => apply(deputy.actor, m.actor, next.request.id, key, expected)),
  );
  expect(results[0]).toEqual(results[1]);
  expect(await eligible(before)).toBe(false);
  expect(await count("external_steam_changes", m.userId)).toBe(2);
  const back = await replacement(m.actor, old.candidate);
  await apply(director, m.actor, back.request.id);
  expect(await eligible(before)).toBe(false);
  const current = await credential(m.actor);
  await safe(
    owner().administer(director, m.userId, newId(), await version(m.actor), { kind: "deactivate" }),
  );
  expect(await eligible(current)).toBe(false);
  await safe(
    owner().administer(
      director,
      m.userId,
      newId(),
      (
        await unit.run((tx) =>
          unit.client(tx).select().from(membership).where(eq(membership.userId, m.userId)),
        )
      )[0]?.version ?? 0,
      { kind: "reinstate", roles: ["driver"] },
    ),
  );
  expect(await eligible(current)).toBe(false);
  expect((await signIn(m.email)).actor.userId === m.userId).toBe(true);
});
test("deputy may apply serving director's own verified Steam request without changing the login/leadership channel", async () => {
  const deputy = await member(["deputy_director"]);
  await initial(director);
  const before = await safe(owner().current(director)),
    next = await replacement(director);
  await apply(deputy.actor, director, next.request.id);
  const after = await safe(owner().current(director));
  expect(after.data.email === before.data.email).toBe(true);
  expect(after.data.emailVerified).toBe(before.data.emailVerified);
  expect(after.data.capabilities.includes("leadership.transfer")).toBe(true);
});
test("same-profile request consumes proof without false change or credential revocation", async () => {
  const m = await member(),
    linked = await initial(m.actor),
    old = await credential(m.actor),
    expected = await version(m.actor);
  const next = await replacement(m.actor, linked.candidate);
  const result = await apply(director, m.actor, next.request.id);
  expect(result.version).toBe(expected);
  expect(await eligible(old)).toBe(true);
  expect(await count("external_steam_changes", m.userId)).toBe(1);
  expect((await safe(external().inspect(m.actor, next.request.id))).state).toBe("applied");
});
test("proof binds member/session/state, replacement generation, expiry and all security epochs", async () => {
  const m = await member(),
    other = await member(),
    service = external();
  let request = await safe(service.request(m.actor, newId(), "initial")),
    raw = assertion(request, sid());
  await expect(safe(service.callback(other.actor, raw))).rejects.toMatchObject({ statusCode: 404 });
  const fresh = await signIn(m.email);
  await expect(safe(service.callback(fresh.actor, raw))).rejects.toMatchObject({ statusCode: 401 });
  const query = new URLSearchParams(raw);
  query.set("state", "tampered");
  await expect(safe(service.callback(m.actor, query.toString()))).rejects.toMatchObject({
    statusCode: 401,
  });
  await safe(service.request(m.actor, newId(), "initial"));
  await expect(safe(service.callback(m.actor, raw))).rejects.toMatchObject({ statusCode: 401 });
  request = await safe(service.request(m.actor, newId(), "initial"));
  raw = assertion(request, sid());
  instant += 600000;
  await expect(safe(service.callback(m.actor, raw))).rejects.toMatchObject({ statusCode: 401 });
  for (const field of ["identityEpoch", "emailEpoch", "accessEpoch", "credentialEpoch"] as const) {
    const a = await member(),
      p = await safe(service.request(a.actor, newId(), "initial"));
    await unit.run((tx) =>
      unit
        .client(tx)
        .update(membership)
        .set({ [field]: 2 })
        .where(eq(membership.userId, a.userId)),
    );
    await expect(safe(service.callback(a.actor, assertion(p, sid())))).rejects.toHaveProperty(
      "statusCode",
    );
  }
});
test("nonce replay across independent proof generations is rejected durably", async () => {
  const first = await member(),
    second = await member(),
    service = external(),
    nonce = `${now().toISOString().slice(0, 19)}Z${randomUUID()}`;
  const a = await safe(service.request(first.actor, newId(), "initial")),
    b = await safe(service.request(second.actor, newId(), "initial"));
  await safe(service.callback(first.actor, assertion(a, sid(), nonce)));
  await expect(
    safe(service.callback(second.actor, assertion(b, sid(), nonce))),
  ).rejects.toMatchObject({ statusCode: 409 });
});
test("staff cannot supply a candidate or apply unverified/foreign/expired/stale-version proof; roles are current", async () => {
  const m = await member(),
    other = await member(),
    deputy = await member(["deputy_director"]),
    service = external();
  await initial(m.actor);
  await initial(other.actor);
  const pending = await safe(service.request(m.actor, newId(), "replacement"));
  await expect(apply(director, m.actor, pending.id)).rejects.toMatchObject({ statusCode: 409 });
  const foreign = await replacement(other.actor);
  await expect(apply(director, m.actor, foreign.request.id)).rejects.toMatchObject({
    statusCode: 404,
  });
  const proof = await replacement(m.actor);
  await expect(apply(other.actor, m.actor, proof.request.id)).rejects.toMatchObject({
    statusCode: 403,
  });
  await expect(apply(director, m.actor, proof.request.id, newId(), 1)).rejects.toMatchObject({
    statusCode: 409,
  });
  await safe(
    owner().administer(director, deputy.userId, newId(), await version(deputy.actor), {
      kind: "roles",
      roles: ["driver"],
    }),
  );
  await expect(apply(deputy.actor, m.actor, proof.request.id)).rejects.toMatchObject({
    statusCode: 401,
  });
  instant += 600000;
  await expect(apply(director, m.actor, proof.request.id)).rejects.toMatchObject({
    statusCode: 409,
  });
});
test("required event failure rolls back link/proof/history/epoch writes and a retry can complete", async () => {
  const m = await member();
  await initial(m.actor);
  const proof = await replacement(m.actor),
    before = await credential(m.actor);
  const failingIdentity = createIdentity(
    unit,
    config,
    {
      ...ports(),
      accessEvents: {
        async append(tx, event) {
          await ports().accessEvents.append(tx, event);
          throw new Error("SYNTHETIC_EVENT_FAILURE");
        },
      },
    },
    now,
  );
  await expect(
    safe(
      external(providers(), failingIdentity).replace(
        director,
        m.userId,
        newId(),
        await version(m.actor),
        { verificationId: proof.request.id, reason: "Synthetic failure" },
      ),
    ),
  ).rejects.toMatchObject({ statusCode: 500 });
  expect(await eligible(before)).toBe(true);
  expect(await count("external_steam_changes", m.userId)).toBe(1);
  expect((await safe(external().inspect(m.actor, proof.request.id))).state).toBe("verified");
  await apply(director, m.actor, proof.request.id);
  expect(await eligible(before)).toBe(false);
});
test("callback and staff apply races are serialized with current membership changes", async () => {
  const m = await member();
  await initial(m.actor);
  const proof = await replacement(m.actor),
    expected = await version(m.actor);
  const outcomes = await Promise.allSettled([
    apply(director, m.actor, proof.request.id, newId(), expected),
    safe(owner().administer(director, m.userId, newId(), expected, { kind: "deactivate" })),
  ]);
  expect(outcomes.filter((o) => o.status === "fulfilled").length).toBe(1);
  const [rows] = await control.query<RowDataPacket[]>(
    "SELECT status FROM identity_memberships WHERE user_id=?",
    [m.userId],
  );
  if (rows[0]?.status === "inactive")
    expect(await count("external_steam_changes", m.userId)).toBe(1);
});
test("TruckersMP cache retains stale success, marks cold failures, coalesces refresh and fences old identities", async () => {
  const m = await member();
  await initial(m.actor);
  let lookups = 0,
    mode: "success" | "failure" = "success";
  const custom = providers();
  custom.truckers.lookup = async () => {
    lookups++;
    if (mode === "failure") throw new ProviderFailure("rate_limited");
    return {
      found: true,
      profile: {
        playerId: "42",
        displayName: "Synthetic Provider Driver",
        vtc: { inVtc: false, id: null, name: null, tag: null, memberId: null },
      },
    };
  };
  const service = external(custom);
  const first = await safe(service.current(m.actor));
  expect(first.data.truckersMp.status).toBe("available");
  await Promise.all([service.current(m.actor), service.current(m.actor)]);
  expect(lookups).toBe(1);
  instant += 900000;
  mode = "failure";
  const stale = await safe(service.current(m.actor));
  expect(stale.data.truckersMp.status).toBe("stale");
  expect(stale.data.truckersMp.displayName).toBe("Synthetic Provider Driver");
  expect(stale.data.truckersMp.failure).toBe("rate_limited");
  const cold = await member();
  await initial(cold.actor);
  expect((await safe(service.current(cold.actor))).data.truckersMp.status).toBe("unavailable");
  expect((await safe(service.current((await member()).actor))).data.truckersMp.status).toBe(
    "not_linked",
  );
  instant += 60000;
  let release: (() => void) | undefined, entered: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
      entered = resolve;
    }),
    held = new Promise<void>((resolve) => {
      release = resolve;
    });
  const delayed = providers();
  delayed.truckers.lookup = async () => {
    entered?.();
    await held;
    return {
      found: true,
      profile: {
        playerId: "99",
        displayName: "Old Identity",
        vtc: { inVtc: false, id: null, name: null, tag: null, memberId: null },
      },
    };
  };
  const late = external(delayed).refresh(m.actor);
  await gate;
  const next = await replacement(m.actor);
  await apply(director, m.actor, next.request.id);
  release?.();
  await safe(late);
  const fresh = await safe(external().current(m.actor));
  expect(fresh.data.truckersMp.found).toBe(false);
  expect(fresh.data.truckersMp.displayName).toBe(null);
  expect(
    (await safe(owner().current(m.actor))).data.capabilities.includes("trips.submit_own"),
  ).toBe(true);
});
test("HTTP enforces cookie/Origin/CSRF/strict schema/private 404 and callback uses clean completion", async () => {
  const m = await member(),
    other = await member(),
    identity = owner(),
    app = await createApp({
      checkReadiness: async () => true,
      identity,
      externalIdentities: external(providers(), identity),
    });
  try {
    const csrf = await app.inject({ url: "/api/v1/auth/csrf", headers: { cookie: m.cookie } });
    const headers = {
      cookie: m.cookie,
      origin: config.origin,
      "x-csrf-token": String(csrf.json().data.token),
      "idempotency-key": newId(),
    };
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/me/steam-verifications",
          headers: { ...headers, origin: "https://example.invalid" },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/me/steam-verifications",
          headers,
          payload: {},
        })
      ).statusCode,
    ).toBe(422);
    const start = await app.inject({
      method: "POST",
      url: "/api/v1/me/steam-verifications",
      headers,
    });
    expect(start.statusCode).toBe(200);
    const request = start.json().data;
    const raw = assertion(request, sid());
    const callback = await app.inject({
      url: `/api/v1/identity/steam/callback?${raw}`,
      headers: { cookie: m.cookie },
    });
    expect(callback.statusCode).toBe(303);
    expect(callback.headers.location).toBe("/api/v1/identity/steam/completed");
    expect(callback.headers["referrer-policy"]).toBe("no-referrer");
    const next = await replacement(m.actor);
    expect(
      (
        await app.inject({
          url: `/api/v1/me/steam-replacement-verifications/${next.request.id}`,
          headers: { cookie: other.cookie },
        })
      ).statusCode,
    ).toBe(404);
    const actorCsrf = await app.inject({ url: "/api/v1/auth/csrf", headers: { cookie: m.cookie } });
    const extra = await app.inject({
      method: "POST",
      url: `/api/v1/admin/members/${m.userId}/steam-replacement`,
      headers: {
        ...headers,
        "x-csrf-token": actorCsrf.json().data.token,
        "if-match": `"v${await version(m.actor)}"`,
      },
      payload: {
        verificationId: next.request.id,
        reason: "Synthetic request",
        candidateSteamId: sid(),
      },
    });
    expect(extra.statusCode).toBe(422);
    expect(
      (await app.inject({ url: "/api/v1/me/identity", headers: { cookie: m.cookie } })).statusCode,
    ).toBe(200);
  } finally {
    await app.close();
  }
});
test("indexed proof/nonce cleanup is bounded and retains immutable applied evidence and exact ownership", async () => {
  const m = await member();
  await initial(m.actor);
  await unit.run(async (tx) => {
    const target = await owner().externalContext(tx, m.actor);
    const proof = (expiresAt: Date) => ({
      id: newId(),
      userId: m.userId,
      sessionId: m.actor.sessionId,
      purpose: "initial" as const,
      state: "invalidated" as const,
      identityEpoch: target.identityEpoch,
      accessEpoch: target.accessEpoch,
      credentialEpoch: target.credentialEpoch,
      emailEpoch: target.emailEpoch,
      previousSteamId: null,
      createdAt: now(),
      expiresAt,
    });
    await unit
      .client(tx)
      .insert(steamProofs)
      .values(Array.from({ length: 1000 }, () => proof(new Date(instant + 172800000))));
    await unit
      .client(tx)
      .insert(steamProofs)
      .values(Array.from({ length: 201 }, () => proof(new Date(instant - 172800000))));
    await unit
      .client(tx)
      .insert(steamNonces)
      .values(
        Array.from({ length: 201 }, () => ({
          hash: randomBytes(32),
          expiresAt: new Date(instant - 1000),
        })),
      );
  });
  const request = await safe(external().request(m.actor, newId(), "replacement"));
  const [proofs] = await control.query<RowDataPacket[]>(
    "SELECT COUNT(*) n FROM external_steam_proofs WHERE user_id=? AND expires_at<?",
    [m.userId, new Date(instant - 86400000)],
  );
  expect(Number(proofs[0]?.n)).toBe(101);
  await safe(external().callback(m.actor, assertion(request, sid())));
  const [nonces] = await control.query<RowDataPacket[]>(
    "SELECT COUNT(*) n FROM external_steam_nonces WHERE expires_at<?",
    [now()],
  );
  expect(Number(nonces[0]?.n)).toBe(101);
  expect(await count("external_steam_changes", m.userId)).toBe(1);
  const [expiry] = await control.query<RowDataPacket[]>(
    "EXPLAIN SELECT id FROM external_steam_proofs WHERE expires_at < ? LIMIT 100",
    [new Date(instant - 86400000)],
  );
  expect(expiry[0]?.key).toBe("external_proof_expiry");
  const [page] = await control.query<RowDataPacket[]>(
    "EXPLAIN SELECT id FROM external_steam_proofs WHERE user_id=? AND purpose='replacement' AND id>? ORDER BY id LIMIT 51",
    [m.userId, "00000000-0000-4000-8000-000000000000"],
  );
  expect(page[0]?.key).toBe("external_proof_member_page");
  const c = await credential(m.actor);
  const [owned] = await control.query<RowDataPacket[]>(
    "EXPLAIN SELECT user_id FROM external_steam_accounts WHERE steam_id=?",
    [c.steamId],
  );
  expect(owned[0]?.key).toBe("PRIMARY");
  await expect(
    safe(control.query("DELETE FROM external_steam_accounts WHERE steam_id=?", [c.steamId])),
  ).rejects.toHaveProperty("statusCode");
  expect(await eligible(c)).toBe(true);
});
test("an abandoned cache lease is reclaimed durably and its late receipt cannot overwrite a newer generation", async () => {
  const m = await member();
  await initial(m.actor);
  let release: (() => void) | undefined, entered: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
      entered = resolve;
    }),
    held = new Promise<void>((resolve) => {
      release = resolve;
    });
  const oldProvider = providers();
  oldProvider.truckers.lookup = async () => {
    entered?.();
    await held;
    return {
      found: true,
      profile: {
        playerId: "101",
        displayName: "Abandoned generation",
        vtc: { inVtc: false, id: null, name: null, tag: null, memberId: null },
      },
    };
  };
  const old = external(oldProvider).refresh(m.actor);
  await gate;
  instant += 60000;
  const recovered = await safe(external().current(m.actor));
  expect(recovered.data.truckersMp.found).toBe(false);
  release?.();
  await safe(old);
  const final = await safe(external().current(m.actor));
  expect(final.data.truckersMp.found).toBe(false);
  expect(final.data.truckersMp.displayName).toBe(null);
  const [rows] = await control.query<RowDataPacket[]>(
    "SELECT generation,lease_id FROM external_truckers_cache WHERE user_id=?",
    [m.userId],
  );
  expect(Number(rows[0]?.generation)).toBe(2);
  expect(rows[0]?.lease_id).toBe(null);
});
