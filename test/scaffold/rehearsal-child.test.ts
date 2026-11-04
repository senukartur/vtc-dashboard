import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  rehearsalPlan,
  rehearsalTiming,
  retainRehearsalEvidence,
  runRehearsalChild,
  windowShards,
} from "../../deploy/development/rehearsal-child.mjs";
const stdio = "ignore";
test("rehearsal child retains completed and failed native outcomes", async () => {
  for (const code of [0, 7]) {
    const result = await runRehearsalChild(process.execPath, ["-e", `process.exit(${code})`], {
      stdio,
      timeout: 5000,
    });
    assert.equal(result.exitCode, code);
    assert.equal(result.nativeExitCode, code);
    assert.equal(result.category, code === 0 ? "completed" : "nonzero-exit");
    assert.equal(result.spawned, true);
    assert.equal(result.settledByClose, true);
    assert.equal(result.deadlineExceeded, false);
  }
});
test("rehearsal deadline records termination and settles only after close", async () => {
  const result = await runRehearsalChild(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
    stdio,
    timeout: 50,
  });
  assert.equal(result.category, "deadline");
  assert.equal(result.exitCode, 1);
  assert.equal(result.deadlineExceeded, true);
  assert.equal(result.settledByClose, true);
  assert.ok(result.elapsedMs >= 40 && result.elapsedMs < 5000);
});
test("rehearsal spawn failures are classified without leaking the command", async () => {
  const result = await runRehearsalChild(
    "synthetic-missing-rehearsal-command",
    ["private-argument"],
    { stdio, timeout: 5000 },
  );
  assert.equal(result.category, "spawn-error");
  assert.equal(result.errorCategory, "ENOENT");
  assert.equal(result.spawned, false);
  assert.equal(result.settledByClose, true);
  assert.ok(!JSON.stringify(result).includes("private-argument"));
});
test("rehearsal error and signal metadata are closed categories and await log settlement", async () => {
  const child = new EventEmitter() as EventEmitter & { kill: () => boolean };
  child.kill = () => true;
  let settled = false;
  const pending = runRehearsalChild("private-command", ["private-argument"], {
    stdio,
    timeout: 5000,
    spawnChild: () => child,
  }).then((result) => {
    settled = true;
    return result;
  });
  child.emit(
    "error",
    Object.assign(new Error("private-error-message"), { code: "private-error-code" }),
  );
  await Promise.resolve();
  assert.equal(settled, false);
  child.emit("close", null, "private-signal");
  const result = await pending;
  assert.equal(result.category, "spawn-error");
  assert.equal(result.errorCategory, "other");
  assert.equal(result.signal, "other");
  assert.equal(result.settledByClose, true);
  assert.ok(!JSON.stringify(result).includes("private-"));
});
test("rehearsal synchronous spawn exceptions and nonportable statuses fail safely", async () => {
  const thrown = await runRehearsalChild("synthetic", [], {
    stdio,
    timeout: 5000,
    spawnChild: () => {
      throw Error("private-error");
    },
  });
  assert.equal(thrown.errorCategory, "synchronous-spawn");
  assert.equal(thrown.settledByClose, false);
  const child = new EventEmitter() as EventEmitter & { kill: () => boolean };
  child.kill = () => true;
  const pending = runRehearsalChild("synthetic", [], {
    stdio,
    timeout: 5000,
    spawnChild: () => child,
  });
  child.emit("close", 3221225786, null);
  const result = await pending;
  assert.equal(result.exitCode, 1);
  assert.equal(result.nativeExitCode, 3221225786);
});
test("rehearsal escalates an uncooperative child and confirms its eventual close", async () => {
  const child = new EventEmitter() as EventEmitter & {
    kill: (signal?: number | string) => boolean;
  };
  const signals: string[] = [];
  child.kill = (signal) => {
    signals.push(String(signal));
    if (signal === "SIGKILL") setImmediate(() => child.emit("close", null, "SIGKILL"));
    return true;
  };
  const result = await runRehearsalChild("synthetic", [], {
    stdio,
    timeout: 10,
    spawnChild: () => child,
  });
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
  assert.equal(result.category, "deadline");
  assert.equal(result.escalationRequested, true);
  assert.equal(result.settledByClose, true);
});
test("rehearsal bounds kill errors and absent close without inventing settlement", async () => {
  const child = new EventEmitter() as EventEmitter & { kill: () => boolean; unref: () => void };
  let referenced = true;
  child.unref = () => {
    referenced = false;
  };
  child.kill = () => {
    throw Error("private-native-kill-error");
  };
  const result = await runRehearsalChild("synthetic", [], {
    stdio,
    timeout: 10,
    spawnChild: () => child,
  });
  assert.equal(result.category, "deadline");
  assert.equal(result.terminationError, true);
  assert.equal(result.settledByClose, false);
  assert.equal(result.unrefAttempted, true);
  assert.equal(result.unrefSucceeded, true);
  assert.equal(referenced, false);
  assert.ok(result.elapsedMs >= 2000 && result.elapsedMs < 5000);
  assert.ok(!JSON.stringify(result).includes("private-"));
  child.emit("close", 0, null);
  assert.equal(result.settledByClose, false);
});
test("rehearsal error without close still observes the bounded cleanup deadline", async () => {
  const child = new EventEmitter() as EventEmitter & { kill: () => boolean };
  child.kill = () => false;
  const pending = runRehearsalChild("synthetic", [], {
    stdio,
    timeout: 10,
    spawnChild: () => child,
  });
  child.emit("error", Object.assign(Error("private-error"), { code: "EPERM" }));
  const result = await pending;
  assert.equal(result.category, "deadline");
  assert.equal(result.errorCategory, "EPERM");
  assert.equal(result.terminationError, true);
  assert.equal(result.settledByClose, false);
});
test("rehearsal handles repeated TERM and KILL errors through unconfirmed settlement", async () => {
  const child = new EventEmitter() as EventEmitter & { kill: () => boolean; unref: () => void };
  let errors = 0,
    unrefs = 0;
  child.kill = () => {
    errors++;
    child.emit("error", Object.assign(Error("private-kill-error"), { code: "EPERM" }));
    return false;
  };
  child.unref = () => {
    unrefs++;
  };
  const result = await runRehearsalChild("synthetic", [], {
    stdio,
    timeout: 10,
    spawnChild: () => child,
  });
  assert.equal(errors, 2);
  assert.equal(unrefs, 1);
  assert.equal(result.category, "deadline");
  assert.equal(result.errorCategory, "EPERM");
  assert.equal(result.terminationError, true);
  assert.equal(result.settledByClose, false);
  assert.equal(result.unrefSucceeded, true);
  child.emit("error", Error("private-late-error"));
  child.emit("close", 0, null);
  assert.equal(result.settledByClose, false);
  assert.ok(!JSON.stringify(result).includes("private-"));
});
test("rehearsal timing publishes only fixed numeric window fields", () => {
  const secret = "SYNTHETIC_PRIVATE_VALUE";
  const scenario = (ordinal: number) => ({
    ordinal,
    status: "pass",
    startedUtc: `2026-11-04T04:0${ordinal}:00.000Z`,
    finishedUtc: secret,
    durationMs: ordinal * 1000,
    samplesMs: [secret],
  });
  const bundle = (scenarios: unknown[], ticks: unknown = []) => ({
    files: {
      "notifications-acceptance-evidence.json": {
        runId: secret,
        ticks,
        fixture: { runId: secret, startedUtc: "2026-11-04T04:00:30.000Z", scenarios },
      },
    },
  });
  const ticks = [
    { startedUtc: 100, finishedUtc: 103, worker: secret },
    { startedUtc: 160, finishedUtc: 170 },
    { startedUtc: 220, finishedUtc: secret },
    { startedUtc: 280, finishedUtc: 1000 },
  ];
  const timing = rehearsalTiming(bundle([1, 2, 3].map(scenario), ticks));
  assert.deepEqual(timing, {
    event: "deployment_rehearsal_timing",
    scenarios: [
      { ordinal: 1, startOffsetMs: 30000, durationMs: 1000 },
      { ordinal: 2, startOffsetMs: 90000, durationMs: 2000 },
      { ordinal: 3, startOffsetMs: 150000, durationMs: 3000 },
    ],
    ticks: { count: 4, busySeconds: 13 },
  });
  assert.ok(!JSON.stringify(timing).includes(secret));
  // Every window shard is an ascending subset of 1..9 and publishes its own ordinals.
  for (const shard of windowShards)
    assert.deepEqual(
      rehearsalTiming(bundle(shard.map(scenario)))?.scenarios.map((row) => row.ordinal),
      shard,
    );
  // Repeated, descending or foreign ordinals, malformed instants and unbounded durations
  // publish nothing.
  for (const rows of [
    [scenario(2), scenario(2)],
    [scenario(3), scenario(2)],
    [scenario(0)],
    [{ ...scenario(9), ordinal: 10 }],
    [{ ...scenario(1), ordinal: "1" }],
    [{ ...scenario(1), startedUtc: secret }],
    [{ ...scenario(1), startedUtc: "2026-11-04T03:59:00.000Z" }],
    [{ ...scenario(1), durationMs: -1 }],
    [{ ...scenario(1), durationMs: 1.5 }],
    [{ ...scenario(1), durationMs: 7_200_001 }],
    [null],
  ])
    assert.equal(rehearsalTiming(bundle(rows)), null);
  for (const missing of [undefined, null, {}, { files: {} }, bundle(secret as never)])
    assert.equal(rehearsalTiming(missing), null);
  assert.deepEqual(rehearsalTiming(bundle([])), {
    event: "deployment_rehearsal_timing",
    scenarios: [],
    ticks: { count: 0, busySeconds: 0 },
  });
});
test("window shards cover every scenario once in the original order", () => {
  assert.deepEqual(windowShards.flat().sort(), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  for (const shard of windowShards) assert.deepEqual([...shard].sort(), shard);
  // Scenario 1 reads the whole feed from an empty cursor, so it must lead its shard.
  assert.equal(windowShards.find((shard) => shard.includes(1))?.[0], 1);
  for (const [index, shard] of windowShards.entries())
    assert.deepEqual(rehearsalPlan(["--window-shard", `${index + 1}/${windowShards.length}`]), {
      mode: "full",
      groups: ["core", "window"],
      requireWindow: true,
      fullCoverage: false,
      scenarios: shard,
    });
  for (const value of ["0/3", "4/3", "1/2", "1/3x", " 1/3", ""])
    assert.throws(() => rehearsalPlan(["--window-shard", value]), /REHEARSAL_MODE_INVALID/);
  assert.throws(() => rehearsalPlan(["--window-shard"]), /REHEARSAL_MODE_INVALID/);
  assert.deepEqual(rehearsalPlan([]).scenarios, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
});
test("shard evidence must name exactly the requested scenarios", async () => {
  const root = await mkdtemp(join(tmpdir(), "vtc-shard-evidence-"));
  try {
    const digest = "c".repeat(64),
      runId = "12345678-1234-4123-8123-123456789abc",
      binding = {
        sourceSha: "a".repeat(40),
        sourceFingerprint: "b".repeat(64),
        revision: "d".repeat(40),
        project: "vtc011-0123456789abcdef",
        volume: "vtc011-0123456789abcdef-config",
      },
      expectedImageId: string = `sha256:${digest}`;
    const bundle = (ran: number[], receipt = ran, last = ran.at(-1)) => {
      const files = {
        "rehearsal-core.json": { binding },
        "rehearsal-window.json": { binding, scenarios: receipt },
        "notifications-acceptance-last.json": {
          result: "cleaned",
          scenario: last,
          sharedGrantsUnchanged: true,
          sharedFilesUnchanged: true,
          evidenceSha256: digest,
        },
        "notifications-acceptance-evidence.json": {
          runId,
          revision: binding.revision,
          imageId: expectedImageId,
          fixture: {
            runId,
            status: "pass",
            scenarios: ran.map((ordinal) => ({ ordinal, status: "pass" })),
          },
        },
      };
      const digests = Object.fromEntries(Object.keys(files).map((name) => [name, digest]));
      return Buffer.from(JSON.stringify({ version: 1, windowFenced: false, files, digests }));
    };
    const defaults = {
      ...binding,
      expectedImageId,
      requireWindow: true,
      requiredGroups: ["core", "window"],
    };
    const options = { ...defaults, scenarios: [4, 6, 9] };
    assert.equal(
      await retainRehearsalEvidence(bundle([4, 6, 9]), join(root, "ok.json"), options),
      4,
    );
    for (const [name, bytes, error] of [
      ["all", bundle([1, 2, 3, 4, 5, 6, 7, 8, 9]), /REHEARSAL_WINDOW_EVIDENCE_MISSING/],
      ["fewer", bundle([4, 6]), /REHEARSAL_WINDOW_EVIDENCE_MISSING/],
      ["last", bundle([4, 6, 9], [4, 6, 9], 8), /REHEARSAL_WINDOW_EVIDENCE_MISSING/],
      ["receipt", bundle([4, 6, 9], [1, 7, 8]), /REHEARSAL_GROUP_EVIDENCE_BINDING_INVALID/],
    ] as const)
      await assert.rejects(
        retainRehearsalEvidence(bytes, join(root, `${name}.json`), options),
        error,
      );
    // The default plan still requires all nine scenarios in one window.
    await assert.rejects(
      retainRehearsalEvidence(bundle([4, 6, 9]), join(root, "default.json"), defaults),
      /REHEARSAL_WINDOW_EVIDENCE_MISSING/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
