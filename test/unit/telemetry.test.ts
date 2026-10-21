import { newId, TransactionCommitOutcomeUnknownError, type UnitOfWork } from "@vtc/db";
import { expect, test } from "vitest";
import { createExternalIdentities } from "../../apps/api/src/modules/external-identities/service.ts";
import { createIdentity } from "../../apps/api/src/modules/identity/service.ts";
import { event, parseJson } from "../../apps/api/src/modules/telemetry/parser.ts";
import { createTelemetry } from "../../apps/api/src/modules/telemetry/service.ts";
import { createTrips } from "../../apps/api/src/modules/trips/service.ts";
import { telemetryFixture } from "../support/builders.ts";

test("raw telemetry parser rejects nested/escaped duplicate keys, invalid UTF8, unsafe numbers, depth and whitespace over the raw bound", () => {
  for (const input of [
    '{"a":{"x":1,"\\u0078":2}}',
    '{"a":1,"a":1}',
    "9007199254740992",
    "1e999",
    '{"a":1,}',
    "\ufeff{}",
    `${"[".repeat(18)}0${"]".repeat(18)}`,
  ])
    expect(() => parseJson(Buffer.from(input))).toThrow();
  expect(() => parseJson(Buffer.from([0xc3, 0x28]))).toThrow();
  expect(() => parseJson(Buffer.from(`${" ".repeat(65536)}{}`))).toThrow();
  expect(parseJson(Buffer.from('{"a":0,"b":null,"c":[1.5,true,false]}'))).toEqual({
    a: 0,
    b: null,
    c: [1.5, true, false],
  });
});
test("telemetry commands classify unavailable and unknown COMMIT safely without replaying an ambiguous transaction", async () => {
  for (const failure of [
    Object.assign(new Error("PRIVATE_DATABASE_DETAILS"), { code: "ECONNRESET" }),
    new TransactionCommitOutcomeUnknownError(
      Object.assign(new Error("PRIVATE_DATABASE_DETAILS"), { code: "ER_DUP_ENTRY" }),
    ),
  ]) {
    let calls = 0;
    const unit: UnitOfWork = {
      run: async () => {
        calls++;
        throw failure;
      },
      client: () => {
        throw new Error("UNREACHABLE");
      },
      close: async () => {},
    };
    const identity = createIdentity(unit, {
      secret: "nonfunctional-synthetic-identity-secret-42",
      origin: "http://127.0.0.1:4173",
      production: false,
    });
    const service = createTelemetry(
      unit,
      { cursorKey: "a".repeat(64), ipPerMinute: 600, globalPerMinute: 6000 },
      {
        identity,
        external: createExternalIdentities(unit, identity),
        trips: createTrips(unit, { cursorKey: "b".repeat(64) }, { identity }),
      },
    );
    await expect(
      service.issue(
        {
          userId: newId(),
          sessionId: newId(),
          accessEpoch: 1,
          credentialEpoch: 1,
          capabilities: [],
        },
        newId(),
        { label: "Fictional" },
      ),
    ).rejects.toMatchObject({ statusCode: 503 });
    expect(calls).toBe(1);
  }
});
test("frozen event boundary preserves exact values and rejects unsupported versions, ownership and SDK types", () => {
  const p = telemetryFixture("completed");
  expect(event(parseJson(Buffer.from(JSON.stringify(p)))).eventId).toBe(p.eventId);
  for (const change of [
    { contract: { major: 1, minor: 1 } },
    { userId: "forged" },
    { producer: { application: "export", version: "1" } },
  ])
    expect(() => event({ ...p, ...change })).toThrow();
  const amount = structuredClone(p) as { snapshot: { expectedIncome: unknown } };
  amount.snapshot.expectedIncome = {
    available: true,
    value: { raw: "18446744073709551616", sdkType: "u64", currency: { status: "unknown" } },
  };
  expect(() => event(amount)).toThrow();
});
