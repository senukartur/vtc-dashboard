import { resolve } from "node:path";
import type { FullResult, TestCase, TestResult } from "@playwright/test/reporter";
import { expect, test, vi } from "vitest";
import {
  browserFailureLine,
  browserFailurePrefix,
  browserPreparationLine,
  browserPreparationPrefix,
  browserProjects,
  safeBrowserFailure,
  safeBrowserPreparation,
} from "../../scripts/browser-diagnostics.mjs";
import { collectEvents, qualityReport, safeEvent } from "../../scripts/ci-result.mjs";
import { browserFailureProof } from "../support/browser-failure-proof.ts";
import SafeBrowserReporter from "../support/safe-browser-reporter.ts";

const valid = {
  kind: "test",
  file: "landing",
  project: "desktop-chromium",
  line: 12,
  status: "failed",
};
const privateText = "SYNTHETIC_PRIVATE_TOKEN=never-publish";
test("catalog browser failures retain only allowlisted file identifiers", () => {
  for (const file of [
    "catalogs",
    "catalogs-real",
    "administration-real",
    "events",
    "events-real",
    "dashboard",
  ]) {
    expect(safeBrowserFailure({ ...valid, file })).toEqual({ ...valid, file });
  }
});
function record(value: unknown) {
  return `${browserFailurePrefix}${JSON.stringify(value)}\n`;
}

test("browser diagnostics reject malformed and extra fields at collection and report boundaries", () => {
  const invalid: unknown[] = [
    null,
    [],
    privateText,
    ...["file", "project", "status", "kind", "line"].map((field) => ({
      ...valid,
      [field]: privateText,
    })),
    ...[0, -1, 1.5, 100001, null].map((line) => ({ ...valid, line })),
    ...["title", "error", "headers", "payload", "path", "__proto__"].map((field) => ({
      ...valid,
      [field]: privateText,
    })),
    { kind: "global", status: "failed", category: privateText },
    { kind: "global", status: "failed", category: "runner-error", message: privateText },
  ];
  const collector = collectEvents();
  for (const value of invalid) {
    expect(safeBrowserFailure(value)).toBeUndefined();
    expect(() => browserFailureLine(value)).toThrow("INVALID_BROWSER_FAILURE");
    collector.push(record(value));
  }
  expect(collector.browserFailures).toEqual([]);
  expect(qualityReport(1, 2, [], undefined, invalid)).toMatchObject({ browserFailures: [] });
  expect(JSON.stringify(qualityReport(1, 2, [], undefined, invalid))).not.toContain(privateText);
});

test("browser collector handles chunks and oversized lines, bounds records and keeps stage verdicts", () => {
  const collector = collectEvents();
  collector.push(`${browserFailurePrefix}${"x".repeat(2000)}\n`);
  const line = browserFailureLine(valid);
  collector.push(line.slice(0, 8));
  collector.push(`${line.slice(8)}\n`);
  for (let index = 0; index < 100; index++) collector.push(`${line}\n`);
  expect(collector.browserFailures).toHaveLength(32);
  expect(qualityReport(0, 2, [], undefined, collector.browserFailures)).toMatchObject({
    status: "success",
    exitCode: 0,
    browserFailures: Array(32).fill(valid),
  });
  const event = safeEvent({ stage: "e2e", status: "failure", exitCode: 1, durationMs: 2 });
  if (!event) throw new Error("MISSING_EVENT");
  expect(qualityReport(1, 2, [event])).toMatchObject({
    status: "failure",
    browserFailures: [{ kind: "global", category: "unreported-runner-failure", status: "failed" }],
  });
});

test("reporter reads locations and status without touching titles, errors or attachments", () => {
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  const reporter = new SafeBrowserReporter();
  const forbidden = () => {
    throw new Error("PRIVATE_FIELD_READ");
  };
  const testcase = {
    location: { file: resolve("test/e2e/landing.spec.ts"), line: 12 },
    parent: { project: () => ({ name: "desktop-chromium" }) },
    get title() {
      return forbidden();
    },
  } as unknown as TestCase;
  const result = {
    status: "failed",
    get errors() {
      return forbidden();
    },
    get attachments() {
      return forbidden();
    },
  } as unknown as TestResult;
  reporter.onTestBegin();
  reporter.onTestEnd(testcase, result);
  reporter.onTestEnd(testcase, result);
  const collector = collectEvents();
  for (const [line] of output.mock.calls) collector.push(`${line}\n`);
  expect(collector.browserFailures).toEqual([valid]);
  expect(output).toHaveBeenCalledTimes(1);
});

test("unmapped locations and startup errors produce only coarse categories", () => {
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  const reporter = new SafeBrowserReporter();
  reporter.onError();
  reporter.onTestEnd(
    {
      location: { file: privateText, line: 12 },
      parent: { project: () => ({ name: privateText }) },
    } as unknown as TestCase,
    { status: "timedOut" } as TestResult,
  );
  reporter.onEnd({ status: "timedout" } as FullResult);
  const collector = collectEvents();
  for (const [line] of output.mock.calls) collector.push(`${line}\n`);
  expect(collector.browserFailures).toEqual([
    { kind: "global", category: "runner-error", status: "failed" },
    { kind: "global", category: "unmapped-test", status: "timedOut" },
    { kind: "global", category: "no-tests-started", status: "timedOut" },
  ]);
  expect(JSON.stringify(output.mock.calls)).not.toContain(privateText);
});

test("failure proof requires safe assertion records from every configured browser project", () => {
  const output = browserProjects
    .map((project) => record({ ...valid, file: "assertion-probe", project }))
    .join("");
  expect(browserFailureProof(`${privateText}\n${output}`)).toHaveLength(3);
  expect(() => browserFailureProof(output.replaceAll("assertion-probe", "landing"))).toThrow(
    "FAILURE_PROBE_BROWSER_DIAGNOSTICS_INVALID",
  );
  expect(() =>
    browserFailureProof(record({ ...valid, file: "assertion-probe" }).repeat(3)),
  ).toThrow("FAILURE_PROBE_BROWSER_DIAGNOSTICS_INVALID");
});

test("preparation wrapper diagnostics retain each actual category and explicit fixture bound", () => {
  for (const category of [
    "completed",
    "nonzero-exit",
    "signal-exit",
    "spawn-error",
    "pipe-error",
    "deadline",
  ]) {
    const value = {
      kind: "wrapper",
      state: category === "completed" ? "success" : "failed",
      category,
      configuredTimeoutMs: 60000,
      durationMs: 30091,
    };
    expect(safeBrowserPreparation(value)).toEqual(value);
    expect(browserPreparationLine(value)).toBe(
      `${browserPreparationPrefix}${JSON.stringify(value)}`,
    );
    expect(safeBrowserFailure(value)).toBeUndefined();
    const collector = collectEvents();
    collector.push(`${browserPreparationLine(value)}\n${browserFailureLine(valid)}\n`);
    expect(collector.browserFailures).toEqual([valid]);
  }
  expect(
    safeBrowserPreparation({
      kind: "wrapper",
      state: "failed",
      category: "completed",
      configuredTimeoutMs: 30000,
      durationMs: 2,
    }),
  ).toMatchObject({ state: "failed", configuredTimeoutMs: 30000 });
});

test("preparation phases expose only finite progress and existing database side metadata", () => {
  const value = {
    kind: "phase",
    phase: "migrations",
    state: "started",
    durationMs: 0,
    totalDurationMs: 10,
  };
  for (const phase of [
    "ownership",
    "synthetic_ddl",
    "ownership_close",
    "migrations",
    "bootstrap",
    "credential_hash",
    "credential_insert",
    "unit_close",
  ])
    for (const state of ["started", "success", "failed"])
      expect(safeBrowserPreparation({ ...value, phase, state })).toEqual({
        ...value,
        phase,
        state,
      });
  for (const credential of [1, 2, 3])
    expect(safeBrowserPreparation({ ...value, phase: "credential_hash", credential })).toEqual({
      ...value,
      phase: "credential_hash",
      credential,
    });
  // Counts come from the real migrator; diagnostics do not freeze the migration-chain size.
  expect(safeBrowserPreparation({ ...value, state: "success", applied: 13 })).toEqual({
    ...value,
    state: "success",
    applied: 13,
  });
  const failure = {
    ...value,
    state: "failed",
    databaseOperation: {
      operation: "migration_journal_finalize",
      wireDeadlineMs: 5000,
      elapsedMs: 5001,
    },
  };
  expect(safeBrowserPreparation(failure)).toEqual(failure);
  const reconstructed = safeBrowserPreparation(failure);
  expect(reconstructed).not.toBe(failure);
  if (reconstructed?.kind !== "phase") throw new Error("MISSING_PREPARATION_PHASE");
  expect(reconstructed.databaseOperation).not.toBe(failure.databaseOperation);
});

test("preparation diagnostics reject private fields and malformed progress without reading errors", () => {
  const value = {
    kind: "phase",
    phase: "migrations",
    state: "failed",
    durationMs: 1,
    totalDurationMs: 2,
  };
  const wrapper = {
    kind: "wrapper",
    state: "failed",
    category: "deadline",
    configuredTimeoutMs: 60000,
    durationMs: 60001,
  };
  const invalid: unknown[] = [
    null,
    [],
    privateText,
    ...["message", "error", "stack", "cause", "settings", "token", "path", "sql"].map((key) => ({
      ...value,
      [key]: privateText,
    })),
    { ...value, phase: privateText },
    { ...value, state: privateText },
    { ...value, applied: 12 },
    { ...value, phase: "bootstrap", state: "success", applied: 1 },
    { ...value, credential: 1 },
    ...[0, 4, 1.5, privateText].map((credential) => ({
      ...value,
      phase: "credential_insert",
      credential,
    })),
    ...[-1, 0.1, Number.NaN, Number.POSITIVE_INFINITY, 86400001, privateText].flatMap((n) => [
      { ...value, durationMs: n },
      { ...value, totalDurationMs: n },
      { ...wrapper, configuredTimeoutMs: n },
    ]),
    ...[-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, privateText].map((applied) => ({
      ...value,
      state: "success",
      applied,
    })),
    { ...wrapper, configuredTimeoutMs: 0 },
    { ...wrapper, state: "success" },
    { ...wrapper, category: privateText },
    { ...wrapper, message: privateText },
    {
      ...value,
      databaseOperation: {
        operation: "migration_statement",
        wireDeadlineMs: 30000,
        elapsedMs: 3,
        sql: privateText,
      },
    },
    ...[privateText, {}, { operation: privateText, wireDeadlineMs: 1, elapsedMs: 1 }].map(
      (databaseOperation) => ({ ...value, databaseOperation }),
    ),
    {
      ...value,
      get error() {
        throw new Error("PRIVATE_FIELD_READ");
      },
    },
  ];
  for (const item of invalid) {
    expect(safeBrowserPreparation(item)).toBeUndefined();
    expect(() => browserPreparationLine(item)).toThrow("INVALID_BROWSER_PREPARATION");
  }
  expect(browserPreparationLine(wrapper)).not.toContain(privateText);
  expect(safeBrowserPreparation(valid)).toBeUndefined();
});
