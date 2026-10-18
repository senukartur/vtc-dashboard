import { identityDiagnostics } from "../support/identity-diagnostics.ts";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import {
  createUnitOfWork,
  dedicatedConnection,
  runMigrations,
  type TransactionClient,
  TransactionCommitOutcomeUnknownError,
  type TxContext,
  type UnitOfWork,
} from "@vtc/db";
import { session, sql, user } from "@vtc/db/identity-schema";
import type { Connection } from "mysql2/promise";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { createApp } from "../../apps/api/src/app.ts";
import * as engineModule from "../../apps/api/src/modules/identity/engine.ts";
import { createIdentity } from "../../apps/api/src/modules/identity/service.ts";
import { guardedSettings, reset, testConnection } from "../persistence/support.ts";
import { bounded, deferred } from "../support/concurrency.ts";

const config = {
  secret: randomBytes(32).toString("hex"),
  origin: "http://127.0.0.1:4173",
  production: false,
};
const credential = {
  email: "availability@example.invalid",
  password: randomBytes(24).toString("base64url"),
};
const diagnostic = identityDiagnostics("availability");
let control: Connection;
let unit: UnitOfWork;

beforeAll(async () => {
  control = await diagnostic.phase("connection", () => testConnection());
  await diagnostic.phase("reset", () => reset(control));
  await diagnostic.phase("migrations", () => runMigrations(guardedSettings()));
  await diagnostic.phase("synthetic_ddl", () =>
    control.query(
      "CREATE TABLE synthetic_availability_events (id VARCHAR(36) PRIMARY KEY) ENGINE=InnoDB",
    ),
  );
  unit = diagnostic.unit(createUnitOfWork(guardedSettings()), control);
  try {
    await diagnostic.phase("bootstrap", () =>
      createIdentity(unit, config, {
        accessEvents: {
          append: async (tx, event) => {
            await unit
              .client(tx)
              .execute(sql`INSERT INTO synthetic_availability_events VALUES (${event.eventId})`);
          },
        },
      }).bootstrap({ ...credential, name: "Synthetic Availability Member" }),
    );
  } catch {
    throw new Error("SYNTHETIC_AVAILABILITY_SETUP_FAILED");
  }
});
afterAll(async () => {
  await unit?.close();
  await control?.end();
});

function failingUnit(error: unknown): { unit: UnitOfWork; calls: () => number } {
  let count = 0;
  return {
    calls: () => count,
    unit: {
      async run<T>(): Promise<T> {
        count++;
        throw error;
      },
      client: (tx) => unit.client(tx),
      close: async () => {},
    },
  };
}
async function assertCsrfFailure(subject: UnitOfWork, status: 500 | 503) {
  const logs: string[] = [];
  const output = vi.spyOn(console, "error").mockImplementation((value: unknown) => {
    logs.push(String(value));
  });
  const app = await createApp({
    checkReadiness: async () => true,
    identity: createIdentity(subject, config),
  });
  try {
    const result = await app.inject({ url: "/api/v1/auth/csrf" });
    expect(result.statusCode).toBe(status);
    expect(result.json().error).toEqual({
      code: status === 503 ? "SERVICE_UNAVAILABLE" : "INTERNAL_ERROR",
      messageKey: status === 503 ? "errors.service_unavailable" : "errors.internal_error",
      retryable: status === 503,
    });
    expect(result.body.includes("SYNTHETIC_PRIVATE")).toBe(false);
    expect(logs.join("").includes("SYNTHETIC_PRIVATE")).toBe(false);
    expect(logs.join("").includes("SLEEP(")).toBe(false);
  } finally {
    await app.close();
    output.mockRestore();
  }
}

test("API maps a real refused MySQL connection to retryable 503", async () => {
  const listener = createServer();
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const address = listener.address();
  if (!address || typeof address === "string") throw new Error("SYNTHETIC_PORT_REQUIRED");
  await new Promise<void>((resolve, reject) =>
    listener.close((error) => (error ? reject(error) : resolve())),
  );
  const refused = createUnitOfWork({ ...guardedSettings(), host: "127.0.0.1", port: address.port });
  try {
    await assertCsrfFailure(refused, 503);
  } finally {
    await refused.close();
  }
});

test("API maps the pinned driver's actual stalled-handshake acquisition timeout to 503 without extending its deadline", async () => {
  const sockets = new Set<import("node:net").Socket>();
  const listener = createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const address = listener.address();
  if (!address || typeof address === "string") throw new Error("SYNTHETIC_PORT_REQUIRED");
  const stalled = createUnitOfWork({ ...guardedSettings(), host: "127.0.0.1", port: address.port });
  try {
    await assertCsrfFailure(stalled, 503);
  } finally {
    await stalled.close();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) =>
      listener.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("API fails fast with 503 when all five real transaction connections are held, then recovers", async () => {
  const ready = deferred<void>(),
    release = deferred<void>();
  let held = 0;
  const holders = Array.from({ length: 5 }, () =>
    unit.run(async () => {
      if (++held === 5) ready.resolve();
      await bounded(release.promise, "availability_release", 5000);
    }),
  );
  try {
    await bounded(ready.promise, "availability_ready", 5000);
    await assertCsrfFailure(unit, 503);
  } finally {
    release.resolve();
    await Promise.all(holders);
  }
  const app = await createApp({
    checkReadiness: async () => true,
    identity: createIdentity(unit, config),
  });
  try {
    expect((await app.inject({ url: "/api/v1/auth/csrf" })).statusCode).toBe(200);
  } finally {
    await app.close();
  }
});

async function queryTimeout(): Promise<unknown> {
  const connection = await dedicatedConnection(guardedSettings());
  try {
    await connection.query({ sql: "SELECT SLEEP(0.2)", timeout: 25 });
    throw new Error("SYNTHETIC_EXPECTED_QUERY_TIMEOUT");
  } catch (error) {
    if (
      !error ||
      typeof error !== "object" ||
      !("code" in error) ||
      error.code !== "PROTOCOL_SEQUENCE_TIMEOUT"
    )
      throw new Error("SYNTHETIC_QUERY_TIMEOUT_NOT_OBSERVED");
    return error;
  } finally {
    connection.destroy();
    (
      connection as unknown as { connection: { stream: { destroy(): void } } }
    ).connection.stream.destroy();
  }
}

test("API recognizes a real mysql2 query timeout through repository causes and does not retry availability failures", async () => {
  const timeout = await queryTimeout();
  const failed = failingUnit(
    new Error("SYNTHETIC_PRIVATE_REPOSITORY_DIAGNOSTIC", { cause: timeout }),
  );
  await assertCsrfFailure(failed.unit, 503);
  expect(failed.calls()).toBe(1);
});

test("API recognizes temporary Node DNS/reachability codes through causes without retrying", async () => {
  // Node 24 net forwards lookup/connect errors; mysql2 forwards their original codes.
  for (const code of ["EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH"]) {
    const failed = failingUnit(
      new Error("SYNTHETIC_PRIVATE_REPOSITORY_DIAGNOSTIC", {
        cause: Object.assign(new Error("SYNTHETIC_PRIVATE_TRANSPORT_DIAGNOSTIC"), { code }),
      }),
    );
    await bounded(assertCsrfFailure(failed.unit, 503), "temporary_transport");
    expect(failed.calls()).toBe(1);
  }
});

test("permanent DNS and SQL errors remain nonretryable 500", async () => {
  for (const code of ["ENOTFOUND", "ER_BAD_FIELD_ERROR"]) {
    const failed = failingUnit(
      Object.assign(new Error("SYNTHETIC_PRIVATE_CONFIGURATION_DIAGNOSTIC"), { code }),
    );
    await bounded(assertCsrfFailure(failed.unit, 500), "permanent_failure");
    expect(failed.calls()).toBe(1);
  }
});

test("uncertain COMMIT remains nonretryable 500, including a wrapper containing a recognized timeout cause", async () => {
  const timeout = await queryTimeout();
  for (const wrap of [false, true]) {
    const uncertain = new TransactionCommitOutcomeUnknownError(timeout);
    const failure = failingUnit(
      wrap ? new Error("SYNTHETIC_PRIVATE_WRAPPER", { cause: uncertain }) : uncertain,
    );
    await assertCsrfFailure(failure.unit, 500);
    expect(failure.calls()).toBe(1);
  }
});

function withUserReadFailure(error: unknown): UnitOfWork {
  return {
    run: (command) => unit.run(command),
    close: async () => {},
    client(tx: TxContext): TransactionClient {
      const client = unit.client(tx);
      return new Proxy(client, {
        get(target, key, receiver) {
          const value: unknown = Reflect.get(target, key, receiver);
          if (key !== "select") return value;
          return (...args: unknown[]) => {
            const builder = Reflect.apply(value as (...args: unknown[]) => object, target, args);
            return new Proxy(builder, {
              get(query, method, queryReceiver) {
                const original: unknown = Reflect.get(query, method, queryReceiver);
                if (method !== "from") return original;
                return (table: unknown) => {
                  if (table === user) throw error;
                  return Reflect.apply(original as (table: unknown) => unknown, query, [table]);
                };
              },
            });
          };
        },
      });
    },
  };
}
async function loginRequest(subject: UnitOfWork, input = credential) {
  const app = await createApp({
    checkReadiness: async () => true,
    identity: createIdentity(subject, config),
  });
  try {
    const pre = await app.inject({ url: "/api/v1/auth/csrf" });
    if (pre.statusCode !== 200) throw new Error("SYNTHETIC_CSRF_SETUP_FAILED");
    return await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: {
        origin: config.origin,
        cookie: pre.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; "),
        "x-csrf-token": pre.json().data.token as string,
      },
      payload: input,
    });
  } finally {
    await app.close();
  }
}

test("real InnoDB company lock timeout returns API 503 once, rolls back writes, releases and recovers", async () => {
  const holder = await dedicatedConnection(guardedSettings());
  const failedMarkers: string[] = [];
  const observedCodes: unknown[] = [];
  const subject: UnitOfWork = {
    client: (tx) => unit.client(tx),
    close: async () => {},
    run: (command) =>
      unit.run(async (tx) => {
        await unit.client(tx).execute(sql`SET SESSION innodb_lock_wait_timeout = 1`);
        const marker = randomUUID();
        await unit
          .client(tx)
          .execute(sql`INSERT INTO synthetic_availability_events VALUES (${marker})`);
        try {
          return await command(tx);
        } catch (error) {
          failedMarkers.push(marker);
          let cause = error;
          for (let depth = 0; depth < 8 && cause && typeof cause === "object"; depth++) {
            if ("code" in cause) observedCodes.push(cause.code);
            cause = "cause" in cause ? cause.cause : null;
          }
          throw error;
        }
      }),
  };
  const output = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await holder.beginTransaction();
    await bounded(
      holder.query("SELECT singleton FROM identity_company WHERE singleton = 1 FOR UPDATE"),
      "company_lock_acquired",
    );
    // CSRF also authenticates an optional session through the company locking read.
    await bounded(assertCsrfFailure(subject, 503), "company_lock_timeout", 5000);
    expect(failedMarkers).toHaveLength(1);
    expect(observedCodes).toContain("ER_LOCK_WAIT_TIMEOUT");
    const [rows] = await control.query(
      "SELECT id FROM synthetic_availability_events WHERE id = ?",
      [failedMarkers[0]],
    );
    expect(rows).toEqual([]);
    await holder.rollback();
    expect((await bounded(loginRequest(unit), "company_lock_recovered", 5000)).statusCode).toBe(
      200,
    );
    expect(failedMarkers).toHaveLength(1);
  } finally {
    await holder.rollback();
    await holder.end();
    output.mockRestore();
  }
});

test("native engine database failures stay 503 while unrelated application errors remain nonretryable 500", async () => {
  const output = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const unavailable = await loginRequest(
      withUserReadFailure(
        new Error("SYNTHETIC_PRIVATE_REPOSITORY_DIAGNOSTIC", { cause: await queryTimeout() }),
      ),
    );
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json().error.retryable).toBe(true);
    const bug = await loginRequest(
      withUserReadFailure(new Error("SYNTHETIC_PRIVATE_APPLICATION_DIAGNOSTIC")),
    );
    expect(bug.statusCode).toBe(500);
    expect(bug.json().error.retryable).toBe(false);
    expect(unavailable.body.includes("SYNTHETIC_PRIVATE")).toBe(false);
    expect(bug.body.includes("SYNTHETIC_PRIVATE")).toBe(false);
  } finally {
    output.mockRestore();
  }
});

test("native engine 5xx response is unavailable rather than invalid credentials", async () => {
  const original = engineModule.engine;
  const mocked = vi.spyOn(engineModule, "engine").mockImplementation((client, settings) => {
    const actual = original(client, settings);
    return new Proxy(actual, {
      get(target, key, receiver) {
        if (key !== "api") return Reflect.get(target, key, receiver);
        return new Proxy(target.api, {
          get(api, method, apiReceiver) {
            if (method === "signInEmail") return async () => new Response(null, { status: 503 });
            return Reflect.get(api, method, apiReceiver);
          },
        });
      },
    });
  });
  const output = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    expect((await loginRequest(unit)).statusCode).toBe(503);
  } finally {
    mocked.mockRestore();
    output.mockRestore();
  }
});

test("healthy native sign-in succeeds; wrong and absent credentials retain the same generic 401", async () => {
  const valid = await loginRequest(unit);
  expect(valid.statusCode).toBe(200);
  const invalid = await loginRequest(unit, {
    ...credential,
    password: "Synthetic-invalid-passphrase",
  });
  const absent = await loginRequest(unit, { ...credential, email: "absent@example.invalid" });
  expect(invalid.statusCode).toBe(401);
  expect(absent.statusCode).toBe(401);
  expect(invalid.json().error).toEqual(absent.json().error);
  expect(invalid.json().error.retryable).toBe(false);
});

test("logout never acknowledges a swallowed nonfatal native delete failure; owned revocation rolls back then succeeds", async () => {
  const signedIn = await loginRequest(unit);
  const cookie = signedIn.cookies.map((item) => `${item.name}=${item.value}`).join("; ");
  const sessionValue = signedIn.cookies.find((item) => item.name === "vtc_dev_session")?.value;
  const decoratedCookie = `${cookie}; vtc_dev_session =${sessionValue}; VTC_DEV_SESSION=synthetic; better-auth.session_data.0=synthetic; better-auth.session_data.1=synthetic`;
  const other = await loginRequest(unit);
  const otherCookie = other.cookies.map((item) => `${item.name}=${item.value}`).join("; ");
  const failedWrites: string[] = [];
  const failures: string[] = [];
  const contexts = new WeakMap<TxContext, { revocation: boolean }>();
  let afterRevocationCalls = 0;
  let faultEnabled = true;
  const faultClient = (tx: TxContext): TransactionClient =>
    new Proxy(unit.client(tx), {
      get(target, key, receiver) {
        const original: unknown = Reflect.get(target, key, receiver);
        if (key !== "delete") return original;
        return (table: unknown) => {
          if (faultEnabled && table === session)
            return {
              // A real nonfatal MySQL statement error on this caller connection;
              // no triggers, elevated grants or global server settings required.
              where: () =>
                unit
                  .client(tx)
                  .execute(
                    sql`DELETE FROM identity_sessions WHERE synthetic_private_missing_column = 1`,
                  ),
            };
          return Reflect.apply(original as (table: unknown) => unknown, target, [table]);
        };
      },
    });
  const subject: UnitOfWork = {
    close: async () => {},
    run: (command) =>
      unit.run(async (tx) => {
        contexts.set(tx, { revocation: false });
        const marker = randomUUID();
        await unit
          .client(tx)
          .execute(sql`INSERT INTO synthetic_availability_events VALUES (${marker})`);
        try {
          return await command(tx);
        } catch (error) {
          let cause = error;
          for (let depth = 0; depth < 8 && cause && typeof cause === "object"; depth++) {
            if ("code" in cause && cause.code === "ER_BAD_FIELD_ERROR") {
              failures.push(cause.code);
              failedWrites.push(marker);
            }
            cause = "cause" in cause ? cause.cause : null;
          }
          throw error;
        }
      }),
    client(tx) {
      const target = faultClient(tx);
      return new Proxy(target, {
        get(client, key, receiver) {
          const original: unknown = Reflect.get(client, key, receiver);
          if (!["select", "insert", "update", "delete", "execute"].includes(String(key)))
            return original;
          return (...args: unknown[]) => {
            const state = contexts.get(tx);
            if (state?.revocation) {
              afterRevocationCalls++;
              throw new Error("SYNTHETIC_POST_REVOCATION_DATABASE_ACCESS");
            }
            if (key === "delete" && args[0] === session && state) state.revocation = true;
            return Reflect.apply(original as (...input: unknown[]) => unknown, client, args);
          };
        },
      });
    },
  };
  const app = await createApp({
    checkReadiness: async () => true,
    identity: createIdentity(subject, config),
  });
  const logs: string[] = [];
  const output = vi.spyOn(console, "error").mockImplementation((value: unknown) => {
    logs.push(String(value));
  });
  try {
    // The real pinned native endpoint swallows the real statement failure and
    // commits a usable transaction without revoking this captured session.
    const native = await unit.run(async (tx) => {
      const response = await engineModule.engine(faultClient(tx), config).api.signOut({
        headers: new Headers({ cookie }),
        asResponse: true,
      });
      // The same transaction is still usable after the swallowed SQL error.
      await unit.client(tx).execute(sql`SELECT 1`);
      return response;
    });
    expect(native.status).toBe(200);
    const me = (value: string) => app.inject({ url: "/api/v1/me", headers: { cookie: value } });
    expect((await me(cookie)).statusCode).toBe(200);
    const csrf = await app.inject({ url: "/api/v1/auth/csrf", headers: { cookie } });
    expect(csrf.statusCode).toBe(200);
    const logout = () =>
      app.inject({
        method: "POST",
        url: "/api/v1/auth/logout",
        headers: {
          CoOkIe: decoratedCookie,
          origin: config.origin,
          "x-csrf-token": csrf.json().data.token,
        },
      });
    const denied = await logout();
    expect(denied.statusCode).toBe(500);
    expect(denied.json().error).toEqual({
      code: "INTERNAL_ERROR",
      messageKey: "errors.internal_error",
      retryable: false,
    });
    expect(denied.headers["set-cookie"]).toBeUndefined();
    expect(failures).toEqual(["ER_BAD_FIELD_ERROR"]);
    const [rolledBack] = await control.query(
      "SELECT id FROM synthetic_availability_events WHERE id = ?",
      [failedWrites[0]],
    );
    expect(rolledBack).toEqual([]);
    expect((await me(cookie)).statusCode).toBe(200);
    faultEnabled = false;
    const revoked = await logout();
    expect(revoked.statusCode).toBe(200);
    expect(Array.isArray(revoked.headers["set-cookie"])).toBe(true);
    expect(
      revoked.cookies.some((item) => item.name === "vtc_dev_session" && item.value === ""),
    ).toBe(true);
    for (const chunk of ["better-auth.session_data.0", "better-auth.session_data.1"])
      expect(revoked.cookies.some((item) => item.name === chunk && item.value === "")).toBe(true);
    expect((await me(cookie)).statusCode).toBe(401);
    expect((await me(otherCookie)).statusCode).toBe(200);
    expect(afterRevocationCalls).toBe(0);
    expect(logs.join("").includes("SYNTHETIC_PRIVATE")).toBe(false);
    expect(denied.body.includes("SYNTHETIC_PRIVATE")).toBe(false);
  } finally {
    await app.close();
    output.mockRestore();
  }
});

test("owned logout retains exact native production host-cookie expiry", async () => {
  const production = createIdentity(unit, {
    ...config,
    origin: "https://company.example.invalid",
    production: true,
  });
  const logged = await production.login(credential.email, credential.password);
  const cookie = logged.cookies.map((item) => item.split(";", 1)[0]).join("; ");
  const headers = new Headers({ COOKIE: cookie });
  const actor = await production.authenticate(headers);
  const result = await production.logout(actor, headers);
  const expired = result.cookies.find((item) => item.startsWith("__Host-vtc_session="));
  expect(expired?.includes("Max-Age=0")).toBe(true);
  expect(expired?.includes("HttpOnly")).toBe(true);
  expect(expired?.includes("Secure")).toBe(true);
  expect(expired?.includes("Path=/")).toBe(true);
  expect(expired?.includes("SameSite=Lax")).toBe(true);
  expect(expired?.includes("Domain=")).toBe(false);
  await expect(production.authenticate(headers)).rejects.toMatchObject({ statusCode: 401 });
});
