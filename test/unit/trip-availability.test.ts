import { randomBytes } from "node:crypto";
import {
  newId,
  TransactionCommitOutcomeUnknownError,
  type TxContext,
  type UnitOfWork,
} from "@vtc/db";
import { expect, test, vi } from "vitest";
import { createApp } from "../../apps/api/src/app.ts";
import { createIdentity, identityError } from "../../apps/api/src/modules/identity/service.ts";
import { createTrips } from "../../apps/api/src/modules/trips/service.ts";

async function fixture() {
  let failure: unknown,
    phase: "transaction" | "query" = "transaction";
  const select = vi.fn(() => {
    throw failure;
  });
  const run = vi.fn();
  const unit: UnitOfWork = {
    async run(command) {
      run();
      if (phase === "transaction") throw failure;
      return command({} as TxContext);
    },
    client: () => ({ select }) as never,
    close: async () => {},
  };
  const identity = createIdentity(unit, {
    origin: "http://127.0.0.1:4173",
    secret: randomBytes(32).toString("hex"),
    production: false,
  });
  const actor = {
    userId: newId(),
    sessionId: newId(),
    accessEpoch: 1,
    credentialEpoch: 1,
    capabilities: ["company.read"],
  };
  const authenticated = vi.spyOn(identity, "authenticate").mockResolvedValue(actor);
  const authorized = vi
    .spyOn(identity, "authorizeInTransaction")
    .mockResolvedValue({ ...actor, locale: "en" });
  vi.spyOn(identity, "rateLimit").mockResolvedValue(undefined);
  const service = createTrips(unit, { cursorKey: randomBytes(32).toString("hex") }, { identity });
  const app = await createApp({ identity, trips: service, checkReadiness: async () => true });
  return {
    app,
    actor,
    service,
    run,
    select,
    authenticated,
    authorized,
    fail(error: unknown, at: typeof phase) {
      failure = error;
      phase = at;
      run.mockClear();
      select.mockClear();
      authenticated.mockClear();
      authorized.mockClear();
    },
  };
}
const databaseFailure = (code: string) =>
  Object.assign(new Error("SYNTHETIC_PRIVATE_DATABASE_DIAGNOSTIC"), { code });

test.each(["/api/v1/trips", `/api/v1/trips/${newId()}`, "/api/v1/me/trip-status-summary"])(
  "authenticated trip read %s returns safe retryable 503 for known database availability failures",
  async (url) => {
    const f = await fixture();
    const logs = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const [failure, phase, attempts] of [
        [new Error("No connections available."), "transaction", 1],
        [new Error("Pool is closed."), "transaction", 1],
        [
          new Error("SYNTHETIC_PRIVATE_QUERY", { cause: databaseFailure("ECONNREFUSED") }),
          "transaction",
          1,
        ],
        [
          new Error("SYNTHETIC_PRIVATE_QUERY", {
            cause: databaseFailure("PROTOCOL_SEQUENCE_TIMEOUT"),
          }),
          "query",
          1,
        ],
        [databaseFailure("ER_CON_COUNT_ERROR"), "query", 1],
        [new Error("TRANSACTION_CONTROL_TIMEOUT"), "transaction", 1],
        [databaseFailure("ER_LOCK_WAIT_TIMEOUT"), "query", 3],
      ] as const) {
        f.fail(failure, phase);
        logs.mockClear();
        const response = await f.app.inject({ method: "GET", url });
        expect(f.authenticated).toHaveBeenCalledOnce();
        expect(f.run).toHaveBeenCalledTimes(attempts);
        expect(f.authorized).toHaveBeenCalledTimes(phase === "query" ? attempts : 0);
        expect(f.select).toHaveBeenCalledTimes(phase === "query" ? attempts : 0);
        expect(response.statusCode).toBe(503);
        expect(response.json().error).toEqual({
          code: "SERVICE_UNAVAILABLE",
          messageKey: "errors.service_unavailable",
          retryable: true,
        });
        expect(response.headers["cache-control"]).toBe("no-store");
        for (const output of [response.body, JSON.stringify(logs.mock.calls)]) {
          expect(output).not.toContain("SYNTHETIC_PRIVATE");
          expect(output).not.toContain("No connections available.");
          expect(output).not.toContain("PROTOCOL_SEQUENCE_TIMEOUT");
        }
      }
    } finally {
      await f.app.close();
    }
  },
);

test("trip reads preserve domain errors and unexpected failures instead of classifying every failure as unavailable", async () => {
  const f = await fixture();
  const logs = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const denied = Object.assign(identityError(403), { cause: databaseFailure("ECONNRESET") });
    for (const [failure, status, code] of [
      [denied, 403, "FORBIDDEN"],
      [identityError(404), 404, "NOT_FOUND"],
      [new TypeError("SYNTHETIC_PRIVATE_PROGRAMMER_ERROR"), 500, "INTERNAL_ERROR"],
      [databaseFailure("ER_BAD_FIELD_ERROR"), 500, "INTERNAL_ERROR"],
    ] as const) {
      f.fail(failure, "query");
      await expect(f.service.detail(f.actor, newId())).rejects.toBe(failure);
      f.fail(failure, "query");
      logs.mockClear();
      const response = await f.app.inject(`/api/v1/trips/${newId()}`);
      expect(f.authenticated).toHaveBeenCalledOnce();
      expect(f.authorized).toHaveBeenCalledOnce();
      expect(f.run).toHaveBeenCalledOnce();
      expect(response.statusCode).toBe(status);
      expect(response.json().error).toEqual({
        code,
        messageKey: `errors.${code.toLowerCase()}`,
        retryable: false,
      });
      expect(response.body + JSON.stringify(logs.mock.calls)).not.toContain("SYNTHETIC_PRIVATE");
    }
  } finally {
    await f.app.close();
  }
});

test("nested unknown COMMIT takes precedence over availability and transient causes without replay or 503 conversion", async () => {
  const f = await fixture();
  const logs = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const uncertain = new TransactionCommitOutcomeUnknownError(
      databaseFailure("ER_LOCK_WAIT_TIMEOUT"),
    );
    const wrapped = new Error("SYNTHETIC_PRIVATE_REPOSITORY_WRAPPER", { cause: uncertain });
    f.fail(wrapped, "transaction");
    await expect(f.service.status(f.actor)).rejects.toBe(wrapped);
    expect(f.run).toHaveBeenCalledOnce();
    f.fail(wrapped, "transaction");
    const response = await f.app.inject("/api/v1/me/trip-status-summary");
    expect(f.authenticated).toHaveBeenCalledOnce();
    expect(f.run).toHaveBeenCalledOnce();
    expect(response.statusCode).toBe(500);
    expect(response.json().error).toMatchObject({ code: "INTERNAL_ERROR", retryable: false });
    expect(response.body + JSON.stringify(logs.mock.calls)).not.toContain("SYNTHETIC_PRIVATE");
  } finally {
    await f.app.close();
  }
});
