import { expect, test, vi } from "vitest";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  acceptanceInterruptionHandshake,
  interruptionStartupAck,
  interruptionStopAck,
  writeAcceptanceSignal,
} from "../../apps/api/src/notifications-acceptance-handshake.ts";

test("uncontended private signal replacements succeed on every platform", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vtc-acceptance-signal-")),
    file = join(directory, "signal.json");
  try {
    for (let version = 0; version <= 20; version++) {
      await writeAcceptanceSignal(file, { version });
      expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ version });
      if (process.platform !== "win32") expect((await stat(file)).mode & 0o777).toBe(0o600);
    }
    expect(await readdir(directory)).toEqual(["signal.json"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("polling readers observe only complete old-or-new JSON; Linux completes every replacement", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vtc-acceptance-signal-"));
  const file = join(directory, "signal.json"),
    unrelated = join(directory, "unrelated.txt"),
    body = "fictional".repeat(8192);
  let writer: Promise<{ error: unknown }> | undefined;
  try {
    await writeAcceptanceSignal(file, { version: 0, body });
    await writeFile(unrelated, "fictional unrelated file", { flag: "wx" });
    let done = false,
      acknowledged = 0;
    writer = (async () => {
      for (let version = 1; version <= 20; version++) {
        await writeAcceptanceSignal(file, { version, body });
        acknowledged = version;
      }
    })().then(
      () => ({ error: null }),
      (error: unknown) => ({ error }),
    );
    void writer.then(() => {
      done = true;
    });
    let reads = 0;
    while (!done) {
      const value = JSON.parse(await readFile(file, "utf8"));
      expect(value.body).toBe(body);
      expect(Number.isInteger(value.version) && value.version >= 0 && value.version <= 20).toBe(
        true,
      );
      reads++;
    }
    const outcome = await writer,
      final = JSON.parse(await readFile(file, "utf8"));
    expect(reads).toBeGreaterThan(0);
    expect(final.body).toBe(body);
    if (outcome.error) {
      // Windows may refuse replacement while a reader holds the target open. The caller still fails.
      expect(process.platform).toBe("win32");
      expect(outcome.error).toMatchObject({ code: "EPERM", syscall: "rename" });
      expect([acknowledged, acknowledged + 1]).toContain(final.version);
    } else {
      expect(acknowledged).toBe(20);
      expect(final.version).toBe(20);
    }
    if (process.platform !== "win32") {
      expect(outcome.error).toBeNull();
      expect(acknowledged).toBe(20);
    }
    expect(await readFile(unrelated, "utf8")).toBe("fictional unrelated file");
    expect((await readdir(directory)).sort()).toEqual(["signal.json", "unrelated.txt"]);
    console.log(
      JSON.stringify({
        event: "acceptance_atomic_signal_test",
        platform: process.platform,
        acknowledged,
        completeReads: reads,
        renameRejected: outcome.error !== null,
      }),
    );
  } finally {
    await writer;
    await rm(directory, { recursive: true, force: true });
  }
});

test("an exclusive temporary collision preserves both existing target and unrelated temporary file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vtc-acceptance-signal-")),
    file = join(directory, "signal.json");
  const nonce = "00000000-0000-4000-8000-000000000001",
    temporary = file + "." + nonce + ".tmp";
  await writeFile(file, '{"old":true}', { flag: "wx" });
  await writeFile(temporary, "fictional pre-existing collision", { flag: "wx" });
  vi.resetModules();
  vi.doMock("node:crypto", () => ({ randomUUID: () => nonce }));
  try {
    const { writeAcceptanceSignal: write } = await import(
      "../../apps/api/src/notifications-acceptance-handshake.ts"
    );
    await expect(write(file, { old: false })).rejects.toMatchObject({ code: "EEXIST" });
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ old: true });
    expect(await readFile(temporary, "utf8")).toBe("fictional pre-existing collision");
  } finally {
    vi.doUnmock("node:crypto");
    vi.resetModules();
    await rm(directory, { recursive: true, force: true });
  }
});

test("signal write or rename failure remains primary when cleanup also fails", async () => {
  const renameFailure = new Error("fictional rename failure"),
    cleanupFailure = new Error("fictional unlink failure"),
    unknownWrite = new Error("fictional unknown write");
  const write = vi.fn().mockResolvedValue(undefined),
    rename = vi.fn().mockRejectedValue(renameFailure),
    unlink = vi.fn().mockRejectedValue(cleanupFailure);
  vi.resetModules();
  vi.doMock("node:fs/promises", () => ({ writeFile: write, rename, unlink }));
  try {
    const { writeAcceptanceSignal: save } = await import(
      "../../apps/api/src/notifications-acceptance-handshake.ts"
    );
    await expect(save("/acceptance/signal.json", {})).rejects.toBe(renameFailure);
    expect(unlink).toHaveBeenCalledOnce();
    rename.mockClear();
    unlink.mockClear();
    write.mockRejectedValueOnce(unknownWrite);
    await expect(save("/acceptance/signal.json", {})).rejects.toBe(unknownWrite);
    expect(rename).not.toHaveBeenCalled();
    expect(unlink).not.toHaveBeenCalled();
  } finally {
    vi.doUnmock("node:fs/promises");
    vi.resetModules();
  }
});

test("recipient is held independently before producer commit and armed only after known commit", async () => {
  const calls: string[] = [],
    target = {},
    ready = {};
  await acceptanceInterruptionHandshake({
    producer: async (prepared) => {
      calls.push("company_x");
      await prepared(target);
      calls.push("commit_known");
      return target;
    },
    startup: async () => {
      calls.push("startup_ready");
      return ready;
    },
    recipient: async (body) => {
      try {
        await body({});
        calls.push("recipient_commit");
      } catch (e) {
        calls.push("recipient_rollback");
        throw e;
      }
    },
    lockRecipient: async () => {
      calls.push("recipient_x");
    },
    afterCommit: async (_tx, t, r) => {
      expect(t).toBe(target);
      expect(r).toBe(ready);
      calls.push("armed_claim_ack");
    },
    secondary: () => {
      throw Error("unexpected secondary");
    },
  });
  expect(calls).toEqual([
    "company_x",
    "startup_ready",
    "recipient_x",
    "commit_known",
    "armed_claim_ack",
    "recipient_commit",
  ]);
});

test("unknown producer commit never arms and awaits recipient rollback without masking primary", async () => {
  const primary = new Error("TRANSACTION_COMMIT_OUTCOME_UNKNOWN"),
    secondary = new Error("fictional rollback failure");
  const calls: string[] = [];
  await expect(
    acceptanceInterruptionHandshake({
      producer: async (prepared) => {
        await prepared({});
        throw primary;
      },
      startup: async () => ({}),
      recipient: async (body) => {
        try {
          await body({});
        } catch {
          calls.push("rollback_awaited");
          throw secondary;
        }
      },
      lockRecipient: async () => {},
      afterCommit: async () => {
        calls.push("incorrect_arm");
      },
      secondary: (e) => {
        expect(e).toBe(secondary);
        calls.push("secondary_retained");
      },
    }),
  ).rejects.toBe(primary);
  expect(calls).toEqual(["rollback_awaited", "secondary_retained"]);
});

test("recipient lock failure rolls producer back and never arms", async () => {
  const failure = new Error("fictional SQL lock timeout"),
    calls: string[] = [];
  await expect(
    acceptanceInterruptionHandshake({
      producer: async (prepared) => {
        try {
          const t = {};
          await prepared(t);
          return t;
        } catch (e) {
          calls.push("producer_rollback");
          throw e;
        }
      },
      startup: async () => ({}),
      recipient: async (body) => {
        await body({});
      },
      lockRecipient: async () => {
        throw failure;
      },
      afterCommit: async () => {
        calls.push("incorrect_arm");
      },
      secondary: () => {},
    }),
  ).rejects.toBe(failure);
  expect(calls).toEqual(["producer_rollback"]);
});

test("startup failure and changed commit target cannot arm or leave a recipient promise behind", async () => {
  const startupExit = new Error("fictional worker exit");
  let recipientStarted = false;
  await expect(
    acceptanceInterruptionHandshake({
      producer: async (prepared) => {
        const value = {};
        await prepared(value);
        return value;
      },
      startup: async () => {
        throw startupExit;
      },
      recipient: async (body) => {
        recipientStarted = true;
        await body({});
      },
      lockRecipient: async () => {},
      afterCommit: async () => {
        throw Error("incorrect arm");
      },
      secondary: () => {},
    }),
  ).rejects.toBe(startupExit);
  expect(recipientStarted).toBe(false);
  let rolledBack = false,
    armed = false;
  await expect(
    acceptanceInterruptionHandshake({
      producer: async (prepared) => {
        await prepared({});
        return {};
      },
      startup: async () => ({}),
      recipient: async (body) => {
        try {
          await body({});
        } catch (e) {
          rolledBack = true;
          throw e;
        }
      },
      lockRecipient: async () => {},
      afterCommit: async () => {
        armed = true;
      },
      secondary: () => {},
    }),
  ).rejects.toThrow("ACCEPTANCE_COMMIT_TARGET_CHANGED");
  expect(rolledBack).toBe(true);
  expect(armed).toBe(false);
});

test("the original company-lock SQL failure is preserved before startup", async () => {
  const failure = new Error("fictional company SQL timeout");
  let startupCalled = false;
  await expect(
    acceptanceInterruptionHandshake({
      producer: async () => {
        throw failure;
      },
      startup: async () => {
        startupCalled = true;
        return {};
      },
      recipient: async (body) => {
        await body({});
      },
      lockRecipient: async () => {},
      afterCommit: async () => {},
      secondary: () => {},
    }),
  ).rejects.toBe(failure);
  expect(startupCalled).toBe(false);
});

const target = {
  runId: "run",
  requestId: "request",
  tripId: "trip",
  sourceRecordId: "source",
  eventId: "event",
};
test("startup and stop acknowledgements reject stale request, worker, target and expired/retried jobs", () => {
  const start = { ...target, workerId: "a".repeat(64), phase: "startup_ready" };
  const bound = interruptionStartupAck(start, target);
  for (const key of Object.keys(target))
    expect(() => interruptionStartupAck({ ...start, [key]: "stale" }, target)).toThrow();
  expect(() => interruptionStartupAck({ ...start, phase: "stopped" }, target)).toThrow();
  const stop = {
    ...bound,
    phase: "stopped",
    jobIdHex: Buffer.from("12345678-1234-4123-8123-123456789abc").toString("hex"),
    processAbsent: true,
    lease: {
      state: "running",
      attempts: 1,
      leaseUntilUtc: "2026-10-28T00:01:00.000Z",
      observedUtc: "2026-10-28T00:00:00.000Z",
      unexpired: 1,
      completedAt: null,
    },
  };
  expect(interruptionStopAck(stop, bound).lease.attempts).toBe(1);
  for (const change of [
    { workerId: "c".repeat(64) },
    { requestId: "stale" },
    { eventId: "unrelated" },
    { processAbsent: false },
    { jobIdHex: "b".repeat(32) },
    { jobIdHex: "b".repeat(64) },
    { lease: { ...stop.lease, state: "ready" } },
    { lease: { ...stop.lease, unexpired: 0 } },
    { lease: { ...stop.lease, leaseUntilUtc: stop.lease.observedUtc } },
    { lease: { ...stop.lease, completedAt: stop.lease.observedUtc } },
  ])
    expect(() => interruptionStopAck({ ...stop, ...change }, bound)).toThrow();
});
