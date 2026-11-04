import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { rehearsalTiming, runRehearsalChild } from "../../deploy/development/rehearsal-child.mjs";
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
  // Gaps, foreign ordinals, malformed instants and unbounded durations publish nothing.
  for (const rows of [
    [scenario(2)],
    [scenario(1), scenario(3)],
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
