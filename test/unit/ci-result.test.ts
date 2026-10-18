import { expect, test } from "vitest";
import {
  collectEvents,
  eventLine,
  qualityReport,
  requiredCi,
  safeEvent,
} from "../../scripts/ci-result.mjs";

test("required aggregate accepts only explicit success and rejects every other result", () => {
  const valid = {
    quality: "success",
    deployment: "success",
    artifact: "success",
    event: "push",
    ref: "refs/heads/main",
  };
  expect(requiredCi(valid)).toBe(0);
  expect(requiredCi({ ...valid, event: "pull_request", artifact: "skipped" })).toBe(0);
  for (const field of ["quality", "deployment", "artifact", "event", "ref"])
    for (const value of ["failure", "cancelled", "skipped", "unknown", undefined])
      expect(requiredCi({ ...valid, [field]: value })).toBe(1);
  expect(requiredCi({ ...valid, event: "pull_request", artifact: "success" })).toBe(1);
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
