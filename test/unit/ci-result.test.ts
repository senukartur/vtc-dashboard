import { expect, test } from "vitest";
import {
  collectEvents,
  eventLine,
  fileTimingLine,
  fileTimingPrefix,
  qualityReport,
  requiredCi,
  safeEvent,
} from "../../scripts/ci-result.mjs";

test("required aggregate accepts only explicit success and rejects every other result", () => {
  const valid = {
    quality: "success",
    scope: "success",
    rehearsal: "true",
    deployment: "success",
    artifact: "skipped",
    event: "schedule",
    ref: "refs/heads/main",
  };
  expect(requiredCi(valid)).toBe(0);
  expect(requiredCi({ ...valid, event: "workflow_dispatch" })).toBe(0);
  expect(requiredCi({ ...valid, event: "pull_request" })).toBe(0);
  for (const field of ["quality", "scope", "rehearsal", "deployment", "event", "ref"])
    for (const value of ["failure", "cancelled", "skipped", "unknown", undefined])
      expect(requiredCi({ ...valid, [field]: value })).toBe(1);
  for (const artifact of ["success", "failure", "cancelled", undefined])
    expect(requiredCi({ ...valid, artifact })).toBe(1);
  expect(requiredCi({ ...valid, event: "pull_request", artifact: "success" })).toBe(1);
  // A scheduled or dispatched run must be the full rehearsal on main.
  expect(requiredCi({ ...valid, ref: "refs/heads/feature" })).toBe(1);
  expect(requiredCi({ ...valid, rehearsal: "false", deployment: "skipped" })).toBe(1);
});

test("a main push skips the rehearsal and must publish the artifact", () => {
  const push = {
    quality: "success",
    scope: "success",
    rehearsal: "false",
    deployment: "skipped",
    artifact: "success",
    event: "push",
    ref: "refs/heads/main",
  };
  expect(requiredCi(push)).toBe(0);
  for (const artifact of ["skipped", "failure", "cancelled", undefined])
    expect(requiredCi({ ...push, artifact })).toBe(1);
  for (const deployment of ["success", "failure", "cancelled", undefined])
    expect(requiredCi({ ...push, deployment })).toBe(1);
  expect(requiredCi({ ...push, rehearsal: "true", deployment: "success" })).toBe(1);
  expect(requiredCi({ ...push, ref: "refs/heads/feature" })).toBe(1);
});

test("the rehearsal may be skipped only by the path rule on a pull request", () => {
  const pull = {
    quality: "success",
    scope: "success",
    rehearsal: "false",
    deployment: "skipped",
    artifact: "skipped",
    event: "pull_request",
  };
  expect(requiredCi(pull)).toBe(0);
  // A rehearsal that ran anyway, or one that the rule required, must succeed explicitly.
  for (const deployment of ["success", "failure", "cancelled", undefined])
    expect(requiredCi({ ...pull, deployment })).toBe(1);
  for (const deployment of ["skipped", "failure", "cancelled", undefined])
    expect(requiredCi({ ...pull, rehearsal: "true", deployment })).toBe(1);
  // A failed scope job never authorizes a skip, and the schedule never skips.
  for (const scope of ["failure", "cancelled", "skipped", undefined])
    expect(requiredCi({ ...pull, scope })).toBe(1);
  for (const rehearsal of ["", "TRUE", "0", true, false, undefined])
    expect(requiredCi({ ...pull, rehearsal })).toBe(1);
  expect(requiredCi({ ...pull, event: "schedule", ref: "refs/heads/main" })).toBe(1);
  for (const quality of ["failure", "cancelled", "skipped", "", "unknown", undefined, null, true])
    expect(requiredCi({ quality })).toBe(1);
  for (const missing of [undefined, null, {}, []]) expect(requiredCi(missing)).toBe(1);
});

test("public diagnostics discard arbitrary exceptions, secret-shaped output and extra fields", () => {
  const privateOutput = "SYNTHETIC_PRIVATE_PASSWORD=do-not-publish";
  const collector = collectEvents();
  collector.push(`${privateOutput}\nError: ${privateOutput}\n${"x".repeat(4000)}\n`);
  collector.push(
    `VTC_CI_EVENT ${JSON.stringify({ stage: privateOutput, status: "failure", exitCode: 1, durationMs: 1 })}\n`,
  );
  collector.push(
    `VTC_CI_EVENT ${JSON.stringify({ stage: "check", status: "failure", exitCode: 1, durationMs: 1, message: privateOutput, config: privateOutput })}\n`,
  );
  const line = eventLine("cleanup", 0, 20);
  collector.push(line.slice(0, 11));
  collector.push(`${line.slice(11)}\n`);
  expect(collector.events).toHaveLength(2);
  expect(JSON.stringify(qualityReport(1, 50, collector.events))).not.toContain(privateOutput);
  expect(
    safeEvent({ stage: "check", status: "success", exitCode: 1, durationMs: 1 }),
  ).toBeUndefined();
  expect(
    safeEvent({ stage: "check", status: "failure", exitCode: 1, durationMs: -1 }),
  ).toBeUndefined();
});

test("diagnostic volume is bounded and actual probe failures reject the aggregate", () => {
  const collector = collectEvents();
  for (let i = 0; i < 200; i++) collector.push(`${eventLine("unit", 1, 2)}\n`);
  expect(collector.events).toHaveLength(64);
  for (const lane of ["unit", "integration", "e2e"]) {
    const event = safeEvent({ stage: lane, status: "failure", exitCode: 1, durationMs: 2 });
    if (!event) throw new Error("SAFE_EVENT_MISSING");
    const report = qualityReport(1, 10, [event], lane);
    expect(report).toMatchObject({
      status: "failure",
      category: "deliberate-assertion",
      probeIdentity: `VTC008_${lane.toUpperCase()}_ASSERTION_PROBE`,
      exitCode: 1,
    });
    expect(requiredCi({ quality: "failure" })).toBe(1);
    expect(qualityReport(1, 10, [], lane)).toMatchObject({ category: "probe-not-reached" });
  }
});

test("file timings keep only committed sharded-lane files and bounded durations", () => {
  const integration = {
    lane: "integration",
    file: "test/integration/trips.test.ts",
    durationMs: 1234,
  };
  const browser = { lane: "e2e", file: "test/e2e/trips-list.spec.ts", durationMs: 0 };
  const collector = collectEvents();
  collector.push(
    [
      fileTimingLine(integration),
      fileTimingLine(browser),
      `${fileTimingPrefix}${JSON.stringify({ ...integration, secret: "private" })}`,
      `${fileTimingPrefix}${JSON.stringify({ ...integration, lane: "unit" })}`,
      `${fileTimingPrefix}${JSON.stringify({ ...integration, file: "test/e2e/trips.spec.ts" })}`,
      `${fileTimingPrefix}${JSON.stringify({ ...integration, file: "/etc/passwd" })}`,
      `${fileTimingPrefix}${JSON.stringify({ ...integration, file: "test/probes/integration.test.ts" })}`,
      `${fileTimingPrefix}${JSON.stringify({ ...integration, durationMs: 1.5 })}`,
      `${fileTimingPrefix}${JSON.stringify({ ...integration, durationMs: -1 })}`,
      `${fileTimingPrefix}${JSON.stringify({ ...integration, durationMs: 86400001 })}`,
      `${fileTimingPrefix}not json`,
      "",
    ].join("\n"),
  );
  expect(collector.fileTimings).toEqual([integration, browser]);
  expect(qualityReport(0, 1, [], undefined, [], [], collector.fileTimings)).toMatchObject({
    fileTimings: [integration, browser],
  });
  expect(qualityReport(0, 1, [], undefined, [], [], [{ ...browser, extra: 1 }])).toMatchObject({
    fileTimings: [],
  });
  expect(() => fileTimingLine({ ...browser, file: "test/e2e/support/server.ts" })).toThrow(
    "INVALID_FILE_TIMING",
  );
});
