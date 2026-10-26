import { randomBytes } from "node:crypto";
import { createUnitOfWork, newId, runMigrations, type UnitOfWork } from "@vtc/db";
import { membership } from "@vtc/db/identity-schema";
import { eq } from "drizzle-orm";
import type { Connection } from "mysql2/promise";
import { expect, test, afterAll as vitestAfterAll, beforeAll as vitestBeforeAll } from "vitest";
import { createApp } from "../../apps/api/src/app.ts";
import { createIdentity, type Identity } from "../../apps/api/src/modules/identity/service.ts";
import { createQualificationInitialization } from "../../apps/api/src/modules/qualifications/initialization.ts";
import { identityAccessEvents } from "../../apps/api/src/platform/outbox/events.ts";
import {
  guardedSettings,
  reset,
  SCHEMA_SETUP_TIMEOUT_MS,
  testConnection,
} from "../persistence/support.ts";
import { schemaLifecycleHooks } from "../support/schema-lifecycle.ts";

const { beforeAll, afterAll } = schemaLifecycleHooks(vitestBeforeAll, vitestAfterAll);

let control: Connection;
let unit: UnitOfWork;
let identity: Identity;
let app: Awaited<ReturnType<typeof createApp>>;

let directorCookie: string;
let driver1Id: string;
let driver1Cookie: string;
let driver2Id: string;
let formerDriverId: string;

const password = "Fictional-members-password-42";

async function registerMember(
  name: string,
  roles: ("driver" | "trainee" | "dispatcher" | "deputy_director")[] = ["driver"],
) {
  const userId = newId();
  const email = `${userId}@example.invalid`;
  const credential = await identity.prepareCredential(password);
  await unit.run((tx) =>
    identity.insertWithCredential(tx, {
      userId,
      email,
      name,
      ...credential,
      roles,
    }),
  );
  const login = await identity.login(email, password);
  const cookie = login.cookies.map((v) => v.split(";", 1)[0]).join("; ");
  const actor = await identity.authenticate(new Headers({ cookie }));
  return { userId, actor, cookie };
}

beforeAll(async () => {
  control = await testConnection();
  unit = createUnitOfWork(guardedSettings());
  await reset(control);
  await runMigrations(guardedSettings());

  const init = createQualificationInitialization(unit);

  identity = createIdentity(
    unit,
    {
      secret: randomBytes(32).toString("hex"),
      origin: "http://127.0.0.1:4173",
      production: false,
    },
    {
      qualificationsLifecycle: init,
      accessEvents: identityAccessEvents(unit),
    },
  );

  // Bootstrap director
  await identity.bootstrap({
    email: "members-director@example.invalid",
    name: "Members Director",
    password,
  });
  const dirLogin = await identity.login("members-director@example.invalid", password);
  directorCookie = dirLogin.cookies.map((v) => v.split(";", 1)[0]).join("; ");

  // Register Driver 1 and initialize qualifications
  const d1 = await registerMember("Driver Alpha", ["driver"]);
  driver1Id = d1.userId;
  driver1Cookie = d1.cookie;

  const now = "2026-10-01T10:00:00.000Z";
  await unit.run(async (tx) => {
    await init.initialize(tx, {
      userId: driver1Id,
      games: ["ets2", "ats"],
      assignedAt: now,
    });
  });

  // Register Driver 2
  const d2 = await registerMember("Driver Beta", ["driver", "dispatcher"]);
  driver2Id = d2.userId;

  // Register Former Driver and set status = 'inactive'
  const d3 = await registerMember("Driver Gamma Former", ["trainee"]);
  formerDriverId = d3.userId;
  await unit.run(async (tx) => {
    await unit
      .client(tx)
      .update(membership)
      .set({ status: "inactive" })
      .where(eq(membership.userId, formerDriverId));
  });

  app = await createApp({
    checkReadiness: async () => true,
    identity,
  });
}, SCHEMA_SETUP_TIMEOUT_MS);

afterAll(async () => {
  if (app) await app.close();
  await unit?.close();
  await control?.end();
});

test("GET /api/v1/members requires authentication", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/api/v1/members",
  });
  expect(res.statusCode).toBe(401);
});

test("GET /api/v1/members returns paginated member list with roles and membership state", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/api/v1/members",
    headers: { cookie: driver1Cookie },
  });

  expect(res.statusCode).toBe(200);
  const body = res.json().data;
  expect(body).toHaveProperty("items");
  expect(Array.isArray(body.items)).toBe(true);
  expect(body.items.length).toBeGreaterThanOrEqual(4); // director + 3 drivers

  // Verify fields on members
  const d1 = body.items.find((m: { id: string }) => m.id === driver1Id);
  expect(d1).toBeDefined();
  expect(d1.nickname).toBe("Driver Alpha");
  expect(d1.roles).toContain("driver");
  expect(d1.formerMember).toBe(false);

  const d2 = body.items.find((m: { id: string }) => m.id === driver2Id);
  expect(d2).toBeDefined();
  expect(d2.nickname).toBe("Driver Beta");
  expect(d2.roles).toContain("dispatcher");

  // Verify former member
  const former = body.items.find((m: { id: string }) => m.id === formerDriverId);
  expect(former).toBeDefined();
  expect(former.nickname).toBe("Driver Gamma Former");
  expect(former.formerMember).toBe(true);

  // Privacy check on member list: no email or credential fields
  for (const item of body.items) {
    expect(item).not.toHaveProperty("email");
    expect(item).not.toHaveProperty("password");
    expect(item).not.toHaveProperty("credentialHash");
    expect(item).not.toHaveProperty("passwordHash");
  }
  expect(res.body).not.toContain("@example.invalid");
});

test("GET /api/v1/members supports pagination limit and cursor", async () => {
  const page1Res = await app.inject({
    method: "GET",
    url: "/api/v1/members?limit=2",
    headers: { cookie: directorCookie },
  });

  expect(page1Res.statusCode).toBe(200);
  const page1 = page1Res.json().data;
  expect(page1.items.length).toBe(2);
  expect(page1.nextCursor).toBeTruthy();

  const page2Res = await app.inject({
    method: "GET",
    url: `/api/v1/members?limit=2&cursor=${encodeURIComponent(page1.nextCursor)}`,
    headers: { cookie: directorCookie },
  });

  expect(page2Res.statusCode).toBe(200);
  const page2 = page2Res.json().data;
  expect(page2.items.length).toBeGreaterThanOrEqual(1);

  // Ensure items across pages are distinct
  const page1Ids = page1.items.map((m: { id: string }) => m.id);
  const page2Ids = page2.items.map((m: { id: string }) => m.id);
  for (const id of page2Ids) {
    expect(page1Ids).not.toContain(id);
  }
});

test("GET /api/v1/members/:memberId requires authentication", async () => {
  const res = await app.inject({
    method: "GET",
    url: `/api/v1/members/${driver1Id}`,
  });
  expect(res.statusCode).toBe(401);
});

test("GET /api/v1/members/:memberId returns 404 for unknown member", async () => {
  const unknownId = newId();
  const res = await app.inject({
    method: "GET",
    url: `/api/v1/members/${unknownId}`,
    headers: { cookie: driver1Cookie },
  });
  expect(res.statusCode).toBe(404);
});

test("GET /api/v1/members/:memberId returns driver profile and active qualifications", async () => {
  const res = await app.inject({
    method: "GET",
    url: `/api/v1/members/${driver1Id}`,
    headers: { cookie: driver1Cookie },
  });

  expect(res.statusCode).toBe(200);
  const body = res.json().data;
  expect(body).toHaveProperty("member");
  expect(body).toHaveProperty("qualifications");

  expect(body.member.id).toBe(driver1Id);
  expect(body.member.nickname).toBe("Driver Alpha");
  expect(body.member.roles).toContain("driver");
  expect(body.member.formerMember).toBe(false);

  // Qualifications check
  expect(Array.isArray(body.qualifications)).toBe(true);
  expect(body.qualifications.length).toBe(2);
  const games = body.qualifications.map((q: { game: string }) => q.game);
  expect(games).toContain("ets2");
  expect(games).toContain("ats");

  // Privacy verification: absolutely no email, salt, hash, token in body
  expect(body.member).not.toHaveProperty("email");
  expect(body).not.toHaveProperty("email");
  expect(res.body).not.toContain("@example.invalid");
  expect(res.body).not.toContain("password");
  expect(res.body).not.toContain("credential");
});

test("GET /api/v1/members/:memberId returns profile for former member", async () => {
  const res = await app.inject({
    method: "GET",
    url: `/api/v1/members/${formerDriverId}`,
    headers: { cookie: directorCookie },
  });

  expect(res.statusCode).toBe(200);
  const body = res.json().data;
  expect(body.member.id).toBe(formerDriverId);
  expect(body.member.formerMember).toBe(true);
  expect(body.qualifications).toEqual([]);
});
