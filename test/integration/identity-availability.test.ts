import { randomBytes } from "node:crypto";
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
import { sql, user } from "@vtc/db/identity-schema";
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
let control: Connection;
let unit: UnitOfWork;

beforeAll(async () => {
  control = await testConnection();
  await reset(control);
  await runMigrations(guardedSettings());
  await control.query(
    "CREATE TABLE synthetic_availability_events (id VARCHAR(36) PRIMARY KEY) ENGINE=InnoDB",
  );
  unit = createUnitOfWork(guardedSettings());
  try {
    await createIdentity(unit, config, {
      accessEvents: {
        append: async (tx, event) => {
          await unit
            .client(tx)
            .execute(sql`INSERT INTO synthetic_availability_events VALUES (${event.eventId})`);
        },
      },
    }).bootstrap({ ...credential, name: "Synthetic Availability Member" });
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
