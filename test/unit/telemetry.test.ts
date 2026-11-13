import { newId, TransactionCommitOutcomeUnknownError, type UnitOfWork } from "@vtc/db";
import { expect, test } from "vitest";
import { createExternalIdentities } from "../../apps/api/src/modules/external-identities/service.ts";
import { createIdentity } from "../../apps/api/src/modules/identity/service.ts";
import {
  event,
  eventVersionAdvertisement,
  parseJson,
} from "../../apps/api/src/modules/telemetry/parser.ts";
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
    { contract: { major: 1, minor: 3 } },
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

test("event parsing classifies unsupported versions separately from invalid supported shapes", () => {
  const audited = telemetryFixture("haulmp-audited");
  expect(event(audited).contract).toEqual({ major: 1, minor: 1 });
  expect(() => event({ ...audited, contract: { major: 1, minor: 3 } })).toThrow(
    expect.objectContaining({ statusCode: 422, publicCode: "UNSUPPORTED_CONTRACT" }),
  );
  expect(() => event({ ...audited, contract: { major: 1, minor: 0 } })).toThrow(
    expect.objectContaining({ statusCode: 400, publicCode: "INVALID_PAYLOAD" }),
  );
  const legacy = telemetryFixture("completed");
  expect(() => event({ ...legacy, contract: { major: 1, minor: 1 } })).toThrow(
    expect.objectContaining({ statusCode: 400, publicCode: "INVALID_PAYLOAD" }),
  );
});

test("event v1.2 requires its closed accounting status and keeps earlier versions unchanged", () => {
  const accounting = telemetryFixture("accounting");
  expect(event(parseJson(Buffer.from(JSON.stringify(accounting)))).contract).toEqual({
    major: 1,
    minor: 2,
  });
  const snapshot = accounting.snapshot as Record<string, unknown>;
  const invalid = (change: (s: Record<string, unknown>) => void, base = accounting) => {
    const p = structuredClone(base);
    change(p.snapshot as Record<string, unknown>);
    return p;
  };
  for (const p of [
    invalid((s) => {
      delete s.accounting;
    }),
    invalid((s) => {
      delete s.hardModeResult;
    }),
    invalid((s) => {
      s.accounting = { ...(snapshot.accounting as object), extra: "fictional" };
    }),
    invalid((s) => {
      s.accounting = { distance: "total", fuel: "partial" };
    }),
    invalid((s) => {
      s.accounting = { distance: "complete", fuel: "complete" };
    }, telemetryFixture("completed")),
    invalid((s) => {
      s.accounting = { distance: "complete", fuel: "complete" };
    }, telemetryFixture("haulmp-audited")),
  ])
    expect(() => event(p)).toThrow(
      expect.objectContaining({ statusCode: 400, publicCode: "INVALID_PAYLOAD" }),
    );
  expect(() => event({ ...accounting, contract: { major: 1, minor: 3 } })).toThrow(
    expect.objectContaining({ statusCode: 422, publicCode: "UNSUPPORTED_CONTRACT" }),
  );
  expect(event(telemetryFixture("completed")).contract).toEqual({ major: 1, minor: 0 });
  expect(event(telemetryFixture("haulmp-audited")).contract).toEqual({ major: 1, minor: 1 });
  expect(eventVersionAdvertisement).toBe("1.0, 1.1, 1.2");
});
