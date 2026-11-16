import { randomBytes } from "node:crypto";
import { createUnitOfWork, newId, runMigrations, type UnitOfWork } from "@vtc/db";
import { applications, eq, invitations } from "@vtc/db/admissions-schema";
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
  createInvitationList,
  type InvitationList,
} from "../../apps/api/src/modules/admissions/invitation-list.ts";
import type { ApplicationInput } from "../../apps/api/src/modules/admissions/security.ts";
import {
  type Admissions,
  cleanupAdmissions,
  createAdmissions,
} from "../../apps/api/src/modules/admissions/service.ts";
import {
  type Actor,
  createIdentity,
  type Identity,
} from "../../apps/api/src/modules/identity/service.ts";
import { localProvider } from "../../apps/api/src/modules/messaging/provider.ts";
import {
  createMessaging,
  invalidateAdmissionsMail,
} from "../../apps/api/src/modules/messaging/service.ts";
import { createQualificationInitialization } from "../../apps/api/src/modules/qualifications/initialization.ts";
import {
  admissionsEvents,
  identityAccessEvents,
} from "../../apps/api/src/platform/outbox/events.ts";
import {
  guardedSettings,
  reset,
  SCHEMA_SETUP_TIMEOUT_MS,
  testConnection,
} from "../persistence/support.ts";
import { schemaLifecycleHooks } from "../support/schema-lifecycle.ts";

const { beforeAll, afterAll } = schemaLifecycleHooks(vitestBeforeAll, vitestAfterAll);

const origin = "http://127.0.0.1:4173",
  password = "Fictional-invitation-list-passphrase-42";
const identityConfig = { secret: randomBytes(32).toString("hex"), origin, production: false };
const config = { key: randomBytes(32).toString("base64url"), origin };
const mailConfig = {
  mode: "local" as const,
  key: randomBytes(32).toString("hex"),
  sender: "sender@example.invalid",
  origin,
  production: false,
};
const DAY = 86400000;
let instant = Date.now();
const time = () => new Date(instant);

let control: Connection,
  unit: UnitOfWork,
  identity: Identity,
  admissions: Admissions,
  list: InvitationList,
  director: Actor,
  app: Awaited<ReturnType<typeof createApp>>;
const cookies: Record<string, string> = {};
const secrets: string[] = [];

const input = (nickname: string): ApplicationInput => ({
  nickname,
  email: `${newId()}@example.invalid`,
  steamProfileUrl: "https://steamcommunity.com/id/fictional-driver",
  games: ["ets2"],
});
async function approve(nickname: string) {
  const raw = input(nickname);
  await admissions.submit(`pre:${newId()}`, newId(), raw, "en");
  const [row] = await unit.run((tx) =>
    unit
      .client(tx)
      .select()
      .from(applications)
      .where(eq(applications.openEmail, raw.email.toLowerCase())),
  );
  if (!row) throw new Error("SYNTHETIC_APPLICATION_MISSING");
  const decided = await admissions.decide(director, row.id, newId(), 1, { decision: "approve" });
  if (!decided.invitationId) throw new Error("SYNTHETIC_INVITATION_MISSING");
  const copied = await admissions.copy(director, decided.invitationId, 1);
  const token = new URL(copied.link).searchParams.get("token") as string;
  secrets.push(copied.link, token);
  return { applicationId: row.id, invitationId: decided.invitationId, token };
}
async function signIn(email: string) {
  const login = await identity.login(email, password, true);
  return login.cookies.map((value) => value.split(";", 1)[0]).join("; ");
}
let credential: Awaited<ReturnType<Identity["prepareCredential"]>> | undefined;
async function member(key: string, roles: ("driver" | "dispatcher" | "deputy_director")[]) {
  const userId = newId();
  credential ??= await identity.prepareCredential(password);
  const prepared = credential;
  await unit.run((tx) =>
    identity.insertWithCredential(tx, {
      userId,
      email: `${userId}@example.invalid`,
      name: `Fictional ${key}`,
      ...prepared,
      roles,
    }),
  );
  cookies[key] = await signIn(`${userId}@example.invalid`);
}
async function get(query: string, cookie = cookies.director) {
  // These cases page repeatedly; the per-minute staff read quota is covered by admissions tests.
  await control.query("DELETE FROM admissions_limits");
  return app.inject({
    method: "GET",
    url: `/api/v1/admin/invitations${query ? `?${query}` : ""}`,
    headers: cookie ? { cookie } : {},
  });
}
async function read(query: string) {
  const response = await get(query);
  expect(response.statusCode, response.body).toBe(200);
  return response.json().data as {
    items: {
      invitation: { id: string; expiresAt: string; state: string; emailDelivery: string };
      applicant: { nickname: string; email: string };
    }[];
    nextCursor: string | null;
    total: number;
  };
}
async function traverse(state: string, limit: number) {
  const ids: string[] = [];
  let cursor: string | null = null;
  const totals = new Set<number>();
  for (let pages = 0; pages < 50; pages++) {
    const data = await read(
      `state=${state}&limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    ids.push(...data.items.map((item) => item.invitation.id));
    totals.add(data.total);
    cursor = data.nextCursor;
    if (!cursor) break;
  }
  return { ids, totals };
}
const expiry = (id: string) =>
  unit
    .run((tx) =>
      unit
        .client(tx)
        .select({ expiresAt: invitations.expiresAt })
        .from(invitations)
        .where(eq(invitations.id, id)),
    )
    .then(([row]) => row?.expiresAt as string);
const ordered = async (ids: string[], direction: 1 | -1) => {
  const rows = await Promise.all(ids.map(async (id) => ({ id, at: await expiry(id) })));
  return rows
    .sort((a, b) => direction * (Date.parse(a.at) - Date.parse(b.at)) || (a.id < b.id ? -1 : 1))
    .map((row) => row.id);
};

const fixture = {
  active: [] as string[],
  expired: [] as string[],
};

beforeAll(async () => {
  control = await testConnection();
  await reset(control);
  await runMigrations(guardedSettings());
  unit = createUnitOfWork(guardedSettings());
  identity = createIdentity(
    unit,
    identityConfig,
    { accessEvents: identityAccessEvents(unit) },
    time,
  );
  let owner: Admissions | undefined;
  const messaging = createMessaging(
    unit,
    mailConfig,
    localProvider(),
    {
      identityValid: (tx, value) => identity.deliveryValid(tx, value),
      admissionsValid: (tx, value) => owner?.deliveryValid(tx, value) ?? Promise.resolve(false),
      authorize: async (tx, actor, scope) => {
        await identity.authorizeInTransaction(
          tx,
          actor,
          scope === "admissions" ? "applications.manage" : "company.read",
        );
      },
    },
    time,
  );
  owner = admissions = createAdmissions(
    unit,
    config,
    {
      identity,
      qualifications: createQualificationInitialization(unit),
      events: admissionsEvents(unit),
      invalidateMail: (tx, id) => invalidateAdmissionsMail(unit, tx, id, time),
      mail: { enqueue: messaging.enqueue, status: messaging.admissionsStatus },
    },
    time,
  );
  list = createInvitationList(
    unit,
    config,
    { identity, mailStatus: messaging.admissionsStatus },
    time,
  );
  await identity.bootstrap({
    email: "invitations-director@example.invalid",
    name: "Fictional Director",
    password,
  });
  cookies.director = await signIn("invitations-director@example.invalid");
  director = await identity.authenticate(new Headers({ cookie: cookies.director }));
  await member("driver", ["driver"]);
  await member("dispatcher", ["driver", "dispatcher"]);
  await member("deputy", ["driver", "deputy_director"]);

  const start = Date.now();
  // Expired generations: one eight days old whose secrets cleanup purges, two at the same instant.
  instant = start - 9 * DAY;
  const purged = await approve("Fictional Purged");
  instant = start - 8 * DAY;
  const pairA = await approve("Fictional Expired A");
  const pairB = await approve("Fictional Expired B");
  // Active generations: two at the same instant and one later; one has an email request.
  instant = start - DAY;
  const tieA = await approve("Fictional Active A");
  const tieB = await approve("Fictional Active B");
  instant = start - DAY + 60000;
  const later = await approve("Fictional Active Later");
  await admissions.requestEmail(director, later.invitationId, newId(), 1);
  // A reissued generation lists only its replacement.
  instant = start - 2 * DAY;
  const superseded = await approve("Fictional Reissued");
  instant = start - DAY + 120000;
  const replacement = await admissions.reissue(director, superseded.invitationId, newId(), 1);
  const replacementCopy = await admissions.copy(director, replacement.id, 1);
  secrets.push(replacementCopy.link);
  // A redeemed generation is used and never listed.
  instant = start - DAY + 180000;
  const redeemed = await approve("Fictional Redeemed");
  await admissions.redeem(`pre:${newId()}`, newId(), redeemed.token, password);
  instant = start;
  await cleanupAdmissions(unit, true, time);
  const [[purgedRow]] = await control.query<RowDataPacket[]>(
    "SELECT secret_hash IS NULL AND ciphertext IS NULL purged FROM admissions_invitations WHERE id=?",
    [purged.invitationId],
  );
  expect(Number(purgedRow?.purged)).toBe(1);
  fixture.active = [tieA.invitationId, tieB.invitationId, later.invitationId, replacement.id];
  fixture.expired = [purged.invitationId, pairA.invitationId, pairB.invitationId];

  app = await createApp({
    checkReadiness: async () => true,
    identity,
    admissions,
    invitationList: list,
  });
}, SCHEMA_SETUP_TIMEOUT_MS);

beforeEach(async () => {
  instant = Date.now();
  await control.query("DELETE FROM admissions_limits");
  await control.query("DELETE FROM identity_limits");
});

afterAll(async () => {
  await app?.close();
  await unit?.close();
  await control?.end();
});

test("active and expired lists hold only current unused generations in contract order", async () => {
  const active = await read("");
  expect(active.total).toBe(4);
  expect(active.items.map((item) => item.invitation.id)).toEqual(await ordered(fixture.active, 1));
  expect(new Set(active.items.map((item) => item.invitation.state))).toEqual(new Set(["active"]));
  const expired = await read("state=expired");
  expect(expired.total).toBe(3);
  expect(expired.items.map((item) => item.invitation.id)).toEqual(
    await ordered(fixture.expired, -1),
  );
  expect(new Set(expired.items.map((item) => item.invitation.state))).toEqual(new Set(["expired"]));
  const emailed = active.items.find((item) => item.applicant.nickname === "Fictional Active Later");
  expect(emailed?.invitation.emailDelivery).toBe("queued");
  expect(
    active.items
      .filter((item) => item.applicant.nickname !== "Fictional Active Later")
      .map((item) => item.invitation.emailDelivery),
  ).toEqual(["not_requested", "not_requested", "not_requested"]);
  // The equal-expiry pairs break ties by ascending ID in both states.
  const pairs = expired.items.filter((item) =>
    item.applicant.nickname.startsWith("Fictional Expired"),
  );
  expect(pairs.map((item) => item.invitation.id)).toEqual(
    pairs.map((item) => item.invitation.id).sort(),
  );
});

test("pages keep the total before paging and never return duplicates", async () => {
  for (const [state, ids] of [
    ["active", fixture.active],
    ["expired", fixture.expired],
  ] as const)
    for (const limit of [1, 2]) {
      const result = await traverse(state, limit);
      expect(result.ids).toEqual(await ordered(ids, state === "active" ? 1 : -1));
      expect([...result.totals]).toEqual([ids.length]);
    }
  const first = await read("limit=1");
  expect(first.items).toHaveLength(1);
  expect(first.nextCursor).toBeTruthy();
});

test("the active total equals the administration invited counter", async () => {
  const computedAt = new Date().toISOString();
  const invited = await identity.transaction((tx) =>
    admissions.usableInvitationCountInTransaction(tx, director, computedAt),
  );
  expect((await read("")).total).toBe(invited);
});

test("responses carry exact keys, no secrets and no-store", async () => {
  for (const query of ["", "state=expired"]) {
    const response = await get(query);
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const data = response.json().data;
    expect(Object.keys(data).sort()).toEqual(["items", "nextCursor", "total"]);
    for (const item of data.items) {
      expect(Object.keys(item).sort()).toEqual(["applicant", "invitation"]);
      expect(Object.keys(item.invitation).sort()).toEqual([
        "applicationId",
        "deliveryId",
        "emailDelivery",
        "expiresAt",
        "id",
        "state",
        "version",
      ]);
      expect(Object.keys(item.applicant).sort()).toEqual(["email", "nickname"]);
      expect(item.applicant.email).toMatch(/@example\.invalid$/);
    }
    for (const secret of secrets) expect(response.body).not.toContain(secret);
    for (const word of ["token", "link", "secret", "hash", "ciphertext"])
      expect(response.body.toLowerCase()).not.toContain(word);
  }
});

test("cursors bind the reader, session and state", async () => {
  const first = await read("limit=1");
  const cursor = encodeURIComponent(first.nextCursor as string);
  expect((await get(`state=active&limit=1&cursor=${cursor}`)).statusCode).toBe(200);
  const otherSession = await signIn("invitations-director@example.invalid");
  const [body = "", mac = ""] = (first.nextCursor as string).split(".");
  for (const [query, cookie] of [
    [`state=expired&limit=1&cursor=${cursor}`, cookies.director],
    [`limit=1&cursor=${cursor}`, otherSession],
    [`limit=1&cursor=${cursor}`, cookies.deputy],
    [`limit=1&cursor=${encodeURIComponent(`${body}.${mac.slice(0, -2)}AA`)}`, cookies.director],
    [`limit=1&cursor=${encodeURIComponent(`${body}x.${mac}`)}`, cookies.director],
  ] as const) {
    const response = await get(query, cookie);
    expect(response.statusCode, query).toBe(409);
    expect(response.json().error.code).toBe("VERSION_CONFLICT");
  }
  for (const query of ["state=used", "limit=0", "limit=101", "extra=1"])
    expect((await get(query)).statusCode, query).toBe(422);
});

test("only applications.manage readers list invitations", async () => {
  expect((await get("", "")).statusCode).toBe(401);
  for (const key of ["driver", "dispatcher"])
    expect((await get("", cookies[key])).statusCode, key).toBe(403);
  for (const key of ["deputy", "director"])
    expect((await get("", cookies[key])).statusCode, key).toBe(200);
  // Without the composed list the route stays unmounted.
  const bare = await createApp({ checkReadiness: async () => true, identity, admissions });
  try {
    const response = await bare.inject({
      url: "/api/v1/admin/invitations",
      headers: { cookie: cookies.director as string },
    });
    expect(response.statusCode).toBe(404);
  } finally {
    await bare.close();
  }
  const [rows] = await control.query<RowDataPacket[]>(
    "SELECT COUNT(*) n FROM admissions_invitations",
  );
  expect(Number(rows[0]?.n)).toBe(9);
});
