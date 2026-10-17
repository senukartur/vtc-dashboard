import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { applicationId, type TxContext } from "@vtc/db";
import { describe, expect, test, vi } from "vitest";
import { clock, idGenerator, memberFixture, telemetryFixture } from "../support/builders.ts";
import { barrier, bounded, deferred, transaction, until } from "../support/concurrency.ts";
import { BlobFake, IdentityFake, MailFake, ProviderFake } from "../support/doubles.ts";
import {
  assertLocalOrigin,
  guardedAllocation,
  safeChildEnvironment,
} from "../support/environment.ts";

describe("deterministic independent fixtures", () => {
  test("clock crosses month/expiry boundaries with explicit UTC and rejects ambiguous input", () => {
    const first = clock();
    const second = clock();
    first.advance(1000);
    expect(first.nowUtc()).toBe("2026-02-01T00:00:00.000Z");
    expect(second.nowUtc()).toBe("2026-01-31T23:59:59.000Z");
    first.set("2026-02-01T03:00:00.123+03:00");
    expect(first.nowUtc()).toBe("2026-02-01T00:00:00.123Z");
    expect(() => first.set("2026-02-30T00:00:00Z")).toThrow();
    expect(() => first.set("2026-02-01 00:00:00")).toThrow();
    expect(() => first.advance(0.5)).toThrow();
  });
  test("UUIDv4 generators and nested fixture objects are fresh per instance", () => {
    const a = idGenerator();
    const b = idGenerator();
    const first = a.nextId();
    expect(applicationId(first)).toBe(first);
    expect(b.nextId()).toBe(first);
    expect(a.nextId()).not.toBe(first);
    expect(idGenerator("other").nextId()).not.toBe(first);
    const member = memberFixture();
    member.roles.push("dispatcher");
    expect(memberFixture().roles).toEqual(["driver"]);
    const fixture = telemetryFixture("completed");
    fixture.snapshot = null;
    expect(telemetryFixture("completed").snapshot).not.toBeNull();
  });
});

test("barriers coordinate concurrent work and deadlines reject stalled work", async () => {
  const meet = barrier(2);
  const order: number[] = [];
  await Promise.all(
    [1, 2].map(async (number) => {
      order.push(number);
      await meet();
      expect(order).toHaveLength(2);
    }),
  );
  await expect(meet()).rejects.toThrow("BARRIER_ALREADY_USED");
  await expect(bounded(deferred<void>().promise, "stalled", 10)).rejects.toThrow(
    "TEST_DEADLINE_stalled",
  );
  await expect(until(() => deferred<boolean>().promise, 10)).rejects.toThrow(
    "TEST_DEADLINE_condition",
  );
});

test("whole transaction retry rolls back deadlock only and never retries unknown COMMIT", async () => {
  const client = { beginTransaction: vi.fn(), rollback: vi.fn(), commit: vi.fn() };
  const command = vi
    .fn()
    .mockRejectedValueOnce({ code: "ER_LOCK_DEADLOCK" })
    .mockResolvedValue("saved");
  await expect(transaction(client as never, command)).resolves.toBe("saved");
  expect(client.rollback).toHaveBeenCalledTimes(1);
  expect(command).toHaveBeenCalledTimes(2);
  client.commit.mockRejectedValueOnce({ code: "ER_LOCK_DEADLOCK" });
  const uncertain = vi.fn().mockResolvedValue("uncertain");
  await expect(transaction(client as never, uncertain)).rejects.toEqual({
    code: "ER_LOCK_DEADLOCK",
  });
  expect(uncertain).toHaveBeenCalledTimes(1);
  const arbitrary = vi.fn().mockRejectedValue(new Error("validation"));
  await expect(transaction(client as never, arbitrary)).rejects.toThrow("validation");
  expect(arbitrary).toHaveBeenCalledTimes(1);
  const exhausted = vi.fn().mockRejectedValue({ code: "ER_LOCK_DEADLOCK" });
  await expect(transaction(client as never, exhausted, 2)).rejects.toEqual({
    code: "ER_LOCK_DEADLOCK",
  });
  expect(exhausted).toHaveBeenCalledTimes(2);
});

test("mail fake captures only reference input, deterministic receipt, failure and reset", async () => {
  const mail = new MailFake();
  const input = {
    deliveryId: "synthetic-delivery",
    recipientRef: "synthetic-recipient",
    template: "fixture",
    privatePayloadRef: "synthetic-payload",
  };
  expect(await mail.deliver(input)).toEqual({ providerReceipt: "synthetic:synthetic-delivery" });
  input.template = "changed";
  expect(mail.deliveries[0]?.template).toBe("fixture");
  mail.deliveries.length = 0;
  expect(mail.deliveries).toHaveLength(1);
  mail.failNext("deliver");
  await expect(mail.deliver(input)).rejects.toThrow("SYNTHETIC_deliver_FAILURE");
  expect(mail.deliveries).toHaveLength(1);
  mail.reset();
  expect(mail.deliveries).toEqual([]);
});

test("private blob fake copies async bytes, checks integrity and supports failures/read/removal/reset", async () => {
  const blobs = new BlobFake();
  const bytes = Buffer.from("synthetic bytes");
  const stream = async function* () {
    yield bytes.subarray(0, 4);
    yield bytes.subarray(4);
  };
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  expect(
    await blobs.putPrivate({
      objectId: "fixture",
      bytes: stream(),
      contentType: "application/octet-stream",
      expectedSha256: sha256,
    }),
  ).toEqual({ sha256, byteLength: 15 });
  bytes.fill(0);
  const read = async () => {
    const chunks = [];
    for await (const chunk of await blobs.readPrivate("fixture")) chunks.push(chunk);
    return Buffer.concat(chunks);
  };
  expect((await read()).toString()).toBe("synthetic bytes");
  (await read()).fill(0);
  expect((await read()).toString()).toBe("synthetic bytes");
  await expect(
    blobs.putPrivate({
      objectId: "bad",
      bytes: stream(),
      contentType: "test",
      expectedSha256: "bad",
    }),
  ).rejects.toThrow("CHECKSUM");
  await expect(blobs.readPrivate("bad")).rejects.toThrow("MISSING");
  blobs.failNext("read");
  await expect(read()).rejects.toThrow("SYNTHETIC_read_FAILURE");
  await blobs.removeUnreferenced("fixture");
  await expect(read()).rejects.toThrow("MISSING");
  blobs.reset();
});

test("identity and provider doubles are local captured sketches with explicit unavailable/ambiguous states", async () => {
  const identity = new IdentityFake();
  const tx = {} as TxContext;
  const credential = await identity.prepareCredential("NONFUNCTIONAL_TEST_INPUT");
  await identity.insertWithCredential(tx, {
    userId: idGenerator().nextId(),
    email: "fictional@example.invalid",
    name: "Synthetic",
    ...credential,
  });
  expect(identity.inserts[0]?.tx).toBe(tx);
  expect(identity.inserts[0]?.input.passwordHash).toBe("NONFUNCTIONAL_SYNTHETIC_CREDENTIAL");
  identity.failNext("insert");
  await expect(
    identity.insertWithCredential(tx, {
      userId: idGenerator().nextId(),
      email: "fictional@example.invalid",
      name: "Synthetic",
      ...credential,
    }),
  ).rejects.toThrow("FAILURE");
  identity.reset();
  expect(identity.inserts).toEqual([]);
  const provider = new ProviderFake();
  expect(await provider.lookup()).toEqual({
    status: "unavailable",
    reasonCode: "synthetic_unavailable",
  });
  provider.set({ status: "known", externalId: "synthetic" });
  expect(await provider.lookup()).toEqual({ status: "known", externalId: "synthetic" });
  provider.set({ status: "ambiguous", candidates: ["one", "two"] });
  const result = await provider.lookup();
  if (result.status === "ambiguous") result.candidates.pop();
  expect(await provider.lookup()).toEqual({ status: "ambiguous", candidates: ["one", "two"] });
  provider.failNext("lookup");
  await expect(provider.lookup()).rejects.toThrow("FAILURE");
  provider.reset();
  expect((await provider.lookup()).status).toBe("unavailable");
});

test("environment and endpoint guards reject production settings before contact", async () => {
  vi.stubEnv("SMTP_PASSWORD", "NONFUNCTIONAL_TEST_VALUE");
  vi.stubEnv("VTC_TEST_ROOT_PASSWORD", "NONFUNCTIONAL_TEST_VALUE");
  expect(safeChildEnvironment()).not.toHaveProperty("SMTP_PASSWORD");
  expect(safeChildEnvironment()).not.toHaveProperty("VTC_TEST_ROOT_PASSWORD");
  expect(() => guardedAllocation()).toThrow("LAUNCHER_ALLOCATION_REQUIRED");
  assertLocalOrigin("http://127.0.0.1:4173/health/ready");
  for (const url of [
    "https://example.invalid",
    "http://localhost:4173",
    "http://127.0.0.1:3000",
    "http://name:password@127.0.0.1:4173",
  ])
    expect(() => assertLocalOrigin(url)).toThrow();
  await expect(fetch("https://example.invalid")).rejects.toThrow("UNEXPECTED_TEST_NETWORK_REQUEST");
});

test("allocation guard rejects missing acknowledgment and mismatched schema/host/credentials", async () => {
  await mkdir(resolve(".local/testing"), { recursive: true });
  const directory = await mkdtemp(resolve(".local/testing/guard-"));
  const path = join(directory, "allocation.json");
  const settings = {
    host: "127.0.0.1",
    port: 3306,
    database: "vtc_test_0000000000000000_unit",
    user: "synthetic",
    password: "NONFUNCTIONAL_SYNTHETIC_VALUE",
  };
  await writeFile(
    path,
    JSON.stringify({
      run: "0000000000000000",
      lane: "unit",
      token: "0".repeat(32),
      ownerConnectionId: 1,
      settings,
    }),
  );
  try {
    for (const [key, value] of Object.entries({
      VTC_TEST_CONFIG: path,
      NODE_ENV: "test",
      DB_TEST_RESET_ACK: "synthetic-only",
      MYSQL_HOST: settings.host,
      MYSQL_PORT: "3306",
      MYSQL_DATABASE: settings.database,
      MYSQL_USER: settings.user,
      MYSQL_PASSWORD: settings.password,
    }))
      vi.stubEnv(key, value);
    expect(guardedAllocation().settings.database).toBe(settings.database);
    for (const [key, invalid] of [
      ["DB_TEST_RESET_ACK", ""],
      ["NODE_ENV", "production"],
      ["MYSQL_DATABASE", "vtc_production"],
      ["MYSQL_HOST", "example.invalid"],
      ["MYSQL_PASSWORD", "OTHER_NONFUNCTIONAL_VALUE"],
    ] as const) {
      const original = process.env[key];
      vi.stubEnv(key, invalid);
      expect(() => guardedAllocation()).toThrow("LAUNCHER_ALLOCATION_MISMATCH");
      vi.stubEnv(key, original);
    }
  } finally {
    await rm(directory, { recursive: true });
  }
});
